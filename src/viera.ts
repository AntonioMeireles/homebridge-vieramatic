import crypto from 'crypto'
import { Logger } from 'homebridge'
import http from 'http'
import net from 'net'
import { URL } from 'url'

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { decodeXML } from 'entities'
import parser from 'fast-xml-parser'
import { Address4 } from 'ip-address'
import UPnPsub from 'node-upnp-subscription'
import * as readlineSync from 'readline-sync'

import { isEmpty, html } from './helpers'
import VieramaticPlatform from './platform'

// helpers and default settings
const API_ENDPOINT = 55000
const curl: AxiosInstance = axios.create({ timeout: 3500 })
const AudioChannel = '<InstanceID>0</InstanceID><Channel>Master</Channel>'

type VieraSpecs =
  | {
      friendlyName: string
      modelName: string
      modelNumber: string
      manufacturer: string
      serialNumber: string
      requiresEncryption: boolean
    }
  | Record<string, never>

interface VieraApp {
  name: string
  id: string
}
export type VieraApps = VieraApp[]

type RequestType = 'command' | 'render'

enum AlwaysInPlainText {
  X_GetEncryptSessionId = 'X_GetEncryptSessionId',
  X_DisplayPinCode = 'X_DisplayPinCode',
  X_RequestAuth = 'X_RequestAuth'
}

type VieraAuthSession =
  | {
      iv: Buffer
      key: Buffer
      hmacKey: Buffer
      challenge: Buffer
      seqNum: number
      id: number
    }
  | Record<string, never>

type VieraAuth =
  | Record<string, never>
  | {
      appId: string
      key: string
    }

export interface Outcome<T> {
  error?: Error
  value?: T
}

const getKey = (key: string, xml: string): Outcome<string> => {
  const fn = (object, k: string): string => {
    let objects: string[] = []
    for (const i in object) {
      if (!Object.prototype.hasOwnProperty.call(object, i)) {
        continue
      }
      if (typeof object[i] === 'object') {
        objects = objects.concat(fn(object[i], k))
      } else if (i === k) {
        objects.push(object[i])
      }
    }
    return objects[0]
  }
  let result: string
  try {
    /*
     * FIXME: we should do some fine grained error handling here, sadly the
     *        obvious one can't be done as we 'd get ...
     *          Error: Multiple possible root nodes found.
     *        which of all things breaks pairing (#34)
     */
    result = fn(parser.parse(xml), key)
  } catch (error) {
    return { error }
  }
  return { value: result }
}

export class VieraTV implements VieraTV {
  readonly address: string

  readonly mac: string | undefined

  readonly port = API_ENDPOINT

  readonly baseURL: string

  readonly log: Logger | Console

  auth: VieraAuth

  session: VieraAuthSession

  specs: VieraSpecs

  constructor(ip: Address4, log: Logger | Console, mac?: string) {
    this.address = ip.address
    this.baseURL = `http://${this.address}:${this.port}`

    this.log = log
    this.mac = mac

    this.auth = {}
    this.session = {}
    this.specs = {}
  }

  public static async livenessProbe(
    tv: Address4,
    port = API_ENDPOINT,
    timeout = 2000
  ): Promise<boolean> {
    const probe = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket()

      const onError = (error: Error): void => {
        socket.destroy()
        reject(error)
      }

      socket
        .setTimeout(timeout)
        .on('error', onError)
        .on('timeout', onError)
        .connect(port, tv.address, () => {
          socket.end()
          resolve()
        })
    })

    try {
      await probe
      return true
    } catch {
      return false
    }
  }

  async isTurnedOn(): Promise<boolean> {
    // eslint-disable-next-line  promise/param-names
    const status = await new Promise((resolve, _reject) => {
      const watcher = new UPnPsub(this.address, API_ENDPOINT, '/nrc/event_0')
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      setTimeout(watcher.unsubscribe, 1500)
      watcher.once('message', (message): void => {
        const properties = message.body['e:propertyset']['e:property']
        if ({}.toString.call(properties) !== '[object Array]') {
          this.log.error('Unsuccessful (!) communication with TV.')
          resolve(false)
        } else {
          const match = properties.filter((prop) =>
            ['on', 'off'].includes(prop.X_ScreenState)
          )
          /*
           * TODO: FIXME:
           *
           * if we do not get a match, we assume that we're facing an older TV set
           * which may only reply when it is ON (which is what we want to spot after all)
           *
           * heuristic bellow is likely not enough to cover all angles as it seems
           * that there are old models which shutdown the wifi interface when in
           * standby but not the wired one i.e the exact same model may behave
           * differently depending on how it is connected to the network
           *
           */
          match.length > 0
            ? resolve(match[0].X_ScreenState === 'on')
            : resolve(true)
        }
      })
      watcher.on('error', () => resolve(false))
    })
    return status as boolean
  }

  async needsCrypto(): Promise<boolean> {
    return await curl
      .get(`${this.baseURL}/nrc/sdd_0.xml`)
      .then((reply) => {
        return !!(reply.data.match(/X_GetEncryptSessionId/u) as boolean)
      })
      .catch(() => {
        return false
      })
  }

  async requestSessionId<T>(): Promise<Outcome<T>> {
    const appId = `<X_ApplicationId>${this.auth.appId}</X_ApplicationId>`

    const outcome = this.encryptPayload(appId)

    if (outcome.error != null) {
      return outcome as T
    }

    const encinfo = outcome.value
    const parameters = `<X_ApplicationId>${
      this.auth.appId
    }</X_ApplicationId> <X_EncInfo>${encinfo as string}</X_EncInfo>`

    const callback = (data: string): Outcome<T> => {
      const error = new Error(
        'abnormal result from TV - session ID is not (!) an integer'
      )
      this.session.seqNum = 1
      const number = getKey('X_SessionId', data)

      if (number.error != null) {
        this.log.error(number.error.message)
        return { error }
      }

      if (Number.isInteger(number.value)) {
        this.session.id = Number.parseInt(number.value as string, 10)
        return {}
      }

      return { error }
    }

    return this.sendRequest<T>(
      'command',
      'X_GetEncryptSessionId',
      parameters,
      callback
    )
  }

  deriveSessionKey(key: string): [Buffer, Buffer] {
    let [i, j]: number[] = []
    const iv = Buffer.from(key, 'base64')

    this.session.iv = iv

    const keyVals = Buffer.alloc(16)
    for (i = j = 0; j < 16; i = j += 4) {
      keyVals[i] = iv[i + 2]
      keyVals[i + 1] = iv[i + 3]
      keyVals[i + 2] = iv[i]
      keyVals[i + 3] = iv[i + 1]
    }
    return [Buffer.from(keyVals), Buffer.concat([iv, iv])]
  }

  private decryptPayload(
    payload: string,
    key = this.session.key,
    iv = this.session.iv
  ): string {
    const decipher = crypto
      .createDecipheriv('aes-128-cbc', key, iv)
      .setAutoPadding(false)

    const decrypted = Buffer.concat([
      decipher.update(payload, 'base64'),
      decipher.final()
    ]).slice(16)

    const zero = decrypted.indexOf(0)
    let clean = zero > -1 ? decrypted.slice(0, zero - 1) : decrypted

    const finalizer = '</X_OriginalResult>'
    const junk = clean.lastIndexOf(finalizer)
    clean = junk > -1 ? clean.slice(0, junk + finalizer.length) : clean

    return clean.toString('binary')
  }

  private encryptPayload(
    original: string,
    key = this.session.key,
    iv = this.session.iv,
    hmacKey = this.session.hmacKey
  ): Outcome<string> {
    const pad = (unpadded: Buffer): Buffer => {
      const blockSize = 16
      const extra = Buffer.alloc(blockSize - (unpadded.length % blockSize))
      return Buffer.concat([unpadded, extra])
    }
    let ciphered: Buffer
    let sig: Buffer

    try {
      const data = Buffer.from(original)
      const headerPrefix = Buffer.from(
        [...new Array(12)].map(() => Math.round(Math.random() * 255))
      )

      const headerSufix = Buffer.alloc(4)
      headerSufix.writeIntBE(data.length, 0, 4)
      const header = Buffer.concat([headerPrefix, headerSufix])
      const payload = pad(Buffer.concat([header, data]))
      const cipher = crypto
        .createCipheriv('aes-128-cbc', key, iv)
        .setAutoPadding(false)
      ciphered = Buffer.concat([cipher.update(payload), cipher.final()])
      const hmac = crypto.createHmac('sha256', hmacKey)
      sig = hmac.update(ciphered).digest()
    } catch (error) {
      return { error }
    }
    return { value: Buffer.concat([ciphered, sig]).toString('base64') }
  }

  /*
   * Returns the TV specs
   */
  async getSpecs(): Promise<VieraSpecs> {
    return await curl
      .get(`${this.baseURL}/nrc/ddd.xml`)
      .then(
        async (raw): Promise<VieraSpecs> => {
          const jsonObject = parser.parse(raw.data)
          const { device } = jsonObject.root
          const specs: VieraSpecs = {
            friendlyName:
              device.friendlyName.length > 0
                ? device.friendlyName
                : device.modelName,
            modelName: device.modelName,
            modelNumber: device.modelNumber,
            manufacturer: device.manufacturer,
            serialNumber: device.UDN.slice(5),
            requiresEncryption: await this.needsCrypto()
          }

          this.log.info(
            "found a '%s' TV (%s) at '%s' %s.\n",
            specs.modelName,
            specs.modelNumber,
            this.address,
            specs.requiresEncryption ? '(requires crypto for comunication)' : ''
          )
          return specs
        }
      )
      .catch((error) => {
        this.log.debug('getSpecs:', error)
        return {}
      })
  }

  private renderEncryptedRequest(
    action: string,
    urn: string,
    parameters: string
  ): Outcome<string[]> {
    this.session.seqNum += 1
    const encCommand =
      `<X_SessionId>${this.session.id}</X_SessionId>` +
      `<X_SequenceNumber>${`00000000${this.session.seqNum}`.slice(
        -8
      )}</X_SequenceNumber>` +
      `<X_OriginalCommand> <u:${action} xmlns:u="urn:${urn}">${parameters}</u:${action}> </X_OriginalCommand>`
    const outcome = this.encryptPayload(encCommand)
    if (outcome.error != null) return (outcome as unknown) as Outcome<string[]>

    return {
      value: [
        'X_EncryptedCommand',
        `<X_ApplicationId>${this.auth.appId}</X_ApplicationId> <X_EncInfo>${
          outcome.value as string
        }</X_EncInfo>`
      ]
    }
  }

  private renderRequest(
    action: string,
    urn: string,
    parameters: string
  ): AxiosRequestConfig {
    // let [data, method, responseType]: string[] = []
    const method: AxiosRequestConfig['method'] = 'POST'
    const responseType: AxiosRequestConfig['responseType'] = 'text'
    const headers = {
      Host: `${this.address}:${this.port}`,
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:${urn}#${action}"`,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Accept: 'text/xml'
    }
    const data =
      '<?xml version="1.0" encoding="utf-8"?> ' +
      ' <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"> ' +
      `<s:Body> <u:${action} xmlns:u="urn:${urn}"> ${parameters} </u:${action}> </s:Body> </s:Envelope>`
    const payload: AxiosRequestConfig = { method, headers, data, responseType }
    return payload
  }

  public async sendRequest<T>(
    requestType: RequestType,
    realAction: string,
    realParameters = 'None',
    callback?: (...unknown) => Outcome<T>
  ): Promise<Outcome<T>> {
    let [urL, urn, action, parameters]: string[] = []

    if (requestType === 'command') {
      urL = '/nrc/control_0'
      urn = 'panasonic-com:service:p00NetworkControl:1'
    } else {
      urL = '/dmr/control_0'
      urn = 'schemas-upnp-org:service:RenderingControl:1'
    }

    if (
      this.specs.requiresEncryption &&
      requestType === 'command' &&
      !(realAction in AlwaysInPlainText)
    ) {
      const outcome = this.renderEncryptedRequest(
        realAction,
        urn,
        realParameters
      )
      if (outcome.error != null) return outcome as T
      ;[action, parameters] = outcome.value as string[]
    } else {
      ;[action, parameters] = [realAction, realParameters]
    }

    const postRequest = this.renderRequest(action, urn, parameters)
    const payload = await curl(`${this.baseURL}${urL}`, postRequest)
      .then((r) => {
        let output: Outcome<T>
        if (
          action === 'X_GetEncryptSessionId' ||
          action === 'X_EncryptedCommand'
        ) {
          const extracted = getKey('X_EncResult', r.data)
          if (extracted.error != null) return extracted

          const clean = this.decryptPayload(extracted.value as string)
          output = {
            value: (clean as unknown) as T
          }
        } else {
          output = { value: r.data }
        }
        return output
      })
      .catch((error: Error) => {
        return {
          error,
          value: undefined
        }
      })

    if (payload.error != null) {
      return payload as T
    }

    if (callback != null) {
      return callback(payload.value)
    }

    return payload as T
  }

  private async requestPinCode<T>(): Promise<Outcome<T>> {
    const parameters = '<X_DeviceName>MyRemote</X_DeviceName>'
    const callback = (data: string): Outcome<T> => {
      const match = /<X_ChallengeKey>(\S*)<\/X_ChallengeKey>/gmu.exec(data)
      if (match === null) {
        return {
          error: new Error(
            'unexpected reply from TV when requesting challenge key'
          )
        }
      }
      this.session.challenge = Buffer.from(match[1], 'base64')
      return {}
    }
    return this.sendRequest<T>(
      'command',
      'X_DisplayPinCode',
      parameters,
      callback
    )
  }

  private async authorizePinCode(pin: string): Promise<Outcome<VieraAuth>> {
    const [iv, key, hmacKey] = [
      this.session.challenge,
      Buffer.alloc(16),
      Buffer.alloc(32)
    ]
    let [i, j, l, k]: number[] = []
    for (i = k = 0; k < 16; i = k += 4) {
      key[i] = ~iv[i + 3] & 0xff
      key[i + 1] = ~iv[i + 2] & 0xff
      key[i + 2] = ~iv[i + 1] & 0xff
      key[i + 3] = ~iv[i] & 0xff
    }
    // Derive HMAC key from IV & HMAC key mask (taken from libtvconnect.so)
    const hmacKeyMaskVals = [
      0x15,
      0xc9,
      0x5a,
      0xc2,
      0xb0,
      0x8a,
      0xa7,
      0xeb,
      0x4e,
      0x22,
      0x8f,
      0x81,
      0x1e,
      0x34,
      0xd0,
      0x4f,
      0xa5,
      0x4b,
      0xa7,
      0xdc,
      0xac,
      0x98,
      0x79,
      0xfa,
      0x8a,
      0xcd,
      0xa3,
      0xfc,
      0x24,
      0x4f,
      0x38,
      0x54
    ]
    for (j = l = 0; l < 32; j = l += 4) {
      hmacKey[j] = hmacKeyMaskVals[j] ^ iv[(j + 2) & 0xf]
      hmacKey[j + 1] = hmacKeyMaskVals[j + 1] ^ iv[(j + 3) & 0xf]
      hmacKey[j + 2] = hmacKeyMaskVals[j + 2] ^ iv[j & 0xf]
      hmacKey[j + 3] = hmacKeyMaskVals[j + 3] ^ iv[(j + 1) & 0xf]
    }
    const data = `<X_PinCode>${pin}</X_PinCode>`
    const outcome = this.encryptPayload(data, key, iv, hmacKey)
    if (outcome.error != null) return { error: outcome.error }

    const parameters = `<X_AuthInfo>${outcome.value as string}</X_AuthInfo>`

    const callback = (r: string): Outcome<VieraAuth> => {
      const raw = getKey('X_AuthResult', r)
      if (raw.error != null) return { error: raw.error }

      const authResultDecrypted = this.decryptPayload(
        raw.value as string,
        key,
        iv
      )

      const appId = getKey('X_ApplicationId', authResultDecrypted)
      if (appId.error != null) return { error: appId.error }

      const keyy = getKey('X_Keyword', authResultDecrypted)
      if (keyy.error != null) return { error: keyy.error }

      const value = ({
        appId: appId.value,
        key: keyy.value
      } as unknown) as VieraAuth

      return {
        value
      }
    }
    return this.sendRequest('command', 'X_RequestAuth', parameters, callback)
  }

  private renderSampleConfig(): void {
    const sample = {
      platform: 'PanasonicVieraTV',
      tvs: [
        {
          encKey: this.auth?.key ?? undefined,
          appId: this.auth?.appId ?? undefined,
          hdmiInputs: []
        }
      ]
    }

    console.info(
      '\n',
      "Please add, as a starting point, the snippet bellow inside the'",
      "'platforms' array of your homebridge's 'config.json'\n--x--"
    )

    console.group()
    console.log(JSON.stringify(sample, undefined, 4))
    console.groupEnd()
    console.log('--x--')
  }

  public static async webSetup(ctx: VieramaticPlatform): Promise<void> {
    const server = http.createServer(async (request, response) => {
      let ip: string | null
      let tv: VieraTV
      const urlObject = new URL(
        request.url ?? '',
        `http://${request.headers.host as string}`
      )
      ctx.log.debug((urlObject as unknown) as string)
      let returnCode = 200
      let body = 'nothing to see here - move on'

      if (urlObject.searchParams.get('pin') != null) {
        if (urlObject.searchParams.get('tv') != null) {
          const ip = urlObject.searchParams.get('tv')
          const pin = urlObject.searchParams.get('pin')
          ctx.log.debug((urlObject as unknown) as string)

          if (Address4.isValid(ip as string)) {
            const address = new Address4(ip as string)
            if (await VieraTV.livenessProbe(address)) {
              tv = new VieraTV(address, ctx.log)
              const specs = await tv.getSpecs()
              tv.specs = specs
              if (
                specs?.requiresEncryption &&
                urlObject.searchParams.get('challenge') != null
              ) {
                tv.session.challenge = Buffer.from(
                  urlObject.searchParams.get('challenge') as string,
                  'base64'
                )
                const result = await tv.authorizePinCode(pin as string)
                if (result.error != null) {
                  ;[returnCode, body] = [500, 'Wrong Pin code...']
                } else {
                  if (result.value != null) {
                    tv.auth = result.value

                    body = html`
                      Paired with your TV sucessfully!.
                      <br />
                      <b>Encryption Key</b>: <b>${tv.auth.key}</b>
                      <br />
                      <b>AppId</b>: <b>${tv.auth.appId}</b>
                      <br />
                    `
                  }
                }
              }
            }
          }
        }
      } else if ((ip = urlObject.searchParams.get('ip')) != null) {
        if (!Address4.isValid(ip)) {
          returnCode = 500
          body = html`the supplied TV ip address ('${ip}') is NOT a valid IPv4
          address...`
        } else {
          const address = new Address4(ip)
          if (!(await VieraTV.livenessProbe(address))) {
            body = html`the supplied TV ip address '${ip}' is unreachable...`
          } else {
            tv = new VieraTV(address, ctx.log)
            const specs = await tv.getSpecs()
            tv.specs = specs
            if (isEmpty(specs)) {
              returnCode = 500
              body = html`
                An unexpected error occurred:
                <br />
                Unable to fetch specs from the TV (with ip address ${ip}).
              `
            } else if (!specs.requiresEncryption) {
              returnCode = 500
              body = html`
                Found a <b>${specs.modelNumber}</b> on ip address ${ip}!
                <br />
                It's just that
                <b>this specific model does not require encryption</b>!
              `
            } else if (!(await tv.isTurnedOn())) {
              returnCode = 500
              body = html`
                Found a <b>${specs.modelNumber}</b>, on ip address ${ip}, which
                requires encryption.
                <br />
                Unfortunatelly the TV seems to be in standby.
                <b>Please turn it ON</b> and try again.
              `
            } else {
              const newRequest = await tv.requestPinCode()
              if (newRequest.error != null) {
                returnCode = 500
                body = html`
                  Found a <b>${specs.modelNumber}</b>, on ip address ${ip},
                  which requires encryption.
                  <br />
                  Sadly an unexpected error ocurred while attempting to request
                  a pin code from the TV. Please make sure that the TV is
                  powered ON (and NOT in standby).
                `
              } else {
                body = html`
                  Found a <b>${specs.modelNumber}</b>, on ip address ${ip},
                  which requires encryption.
                  <br />
                  <form action="/">
                    <label for="pin">
                      Please enter the PIN just displayed in Panasonic™ Viera™
                      TV:
                    </label>
                    <br /><input type="text" id="pin" name="pin" />
                    <input type="hidden" value=${ip} name="tv" />
                    <input
                      type="hidden"
                      value=${tv.session.challenge.toString('base64')}
                      name="challenge"
                    />
                    <input type="submit" value="Submit" />
                  </form>
                `
              }
            }
          }
        }
      } else {
        body = html`
          <form action="/">
            <label for="ip">
              Please enter your Panasonic™ Viera™ (2018 or later model) IP
              address:
            </label>
            <br />
            <input type="text" id="ip" name="ip" />
            <input type="submit" value="Submit" />
          </form>
        `
      }

      response.writeHead(returnCode, {
        'Content-Type': 'text/html; charset=utf-8'
      })
      response.write(
        html`<!DOCTYPE html>
          <html>
            <body>
              ${body}
            </body>
          </html>`
      )
      response.end()
    })

    server.on('clientError', (error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      ctx.log.error(error)
    })

    ctx.log.info('launching encryption helper endpoint on :8973')
    server.listen(8973)
  }

  public static async setup(target: string): Promise<void> {
    if (!Address4.isValid(target)) {
      throw new Error('Please introduce a valid ip address!')
    }
    const ip = new Address4(target)
    if (!(await this.livenessProbe(ip))) {
      throw new Error('The IP you provided is unreachable.')
    }
    const tv = new VieraTV(ip, console)
    const specs = await tv.getSpecs()

    if (isEmpty(specs)) {
      throw new Error(
        'An unexpected error occurred - Unable to fetch specs from the TV.'
      )
    }
    tv.specs = specs
    if (tv.specs.requiresEncryption) {
      if (!(await tv.isTurnedOn())) {
        throw new Error(
          'Unable to proceed further as the TV seems to be in standby; Please turn it ON!'
        )
      }
      const request = await tv.requestPinCode()
      if (request.error != null) {
        throw new Error(
          `\nAn unexpected error occurred while attempting to request a pin code from the TV.
           \nPlease make sure that the TV is powered ON (and NOT in standby).`
        )
      }
      const pin = readlineSync.question('Enter the displayed pin code: ')
      const outcome = await tv.authorizePinCode(pin)
      if (outcome.error != null) {
        throw new Error('Wrong pin code...')
      }
      if (outcome.value != null) {
        tv.auth = outcome.value
      }
    }
    tv.renderSampleConfig()
  }

  /**
   * Sends a command to the TV
   */
  public async sendCommand<T>(cmd: string): Promise<Outcome<T>> {
    const parameters = `<X_KeyEvent>NRC_${cmd.toUpperCase()}-ONOFF</X_KeyEvent>`

    return await this.sendRequest<T>('command', 'X_SendKey', parameters)
  }

  /**
   * Send a change HDMI input to the TV
   */
  public async sendHDMICommand<T>(hdmiInput: string): Promise<Outcome<T>> {
    const parameters = `<X_KeyEvent>NRC_HDMI${hdmiInput}-ONOFF</X_KeyEvent>`

    return await this.sendRequest<T>('command', 'X_SendKey', parameters)
  }

  /**
   * Send command to open app on the TV
   */
  public async sendAppCommand<T>(appId: string): Promise<Outcome<T>> {
    const cmd =
      `${appId}`.length === 16 ? `product_id=${appId}` : `resource_id=${appId}`
    const parameters = `<X_AppType>vc_app</X_AppType><X_LaunchKeyword>${cmd}</X_LaunchKeyword>`

    return await this.sendRequest<T>('command', 'X_LaunchApp', parameters)
  }

  /**
   * Get volume from TV
   */
  public async getVolume(): Promise<Outcome<string>> {
    const callback = (data: string): Outcome<string> => {
      const match = /<CurrentVolume>(\d*)<\/CurrentVolume>/gmu.exec(data)
      if (match != null) {
        return { value: match[1] }
      }

      return { value: '0' }
    }
    const parameters = AudioChannel

    return this.sendRequest<string>('render', 'GetVolume', parameters, callback)
  }

  /**
   * Set Volume
   */
  public async setVolume<T>(volume: string): Promise<Outcome<T>> {
    const parameters = `${AudioChannel}<DesiredVolume>${volume}</DesiredVolume>`
    return await this.sendRequest<T>('render', 'SetVolume', parameters)
  }

  /**
   * Get the current mute setting
   */
  public async getMute(): Promise<Outcome<boolean>> {
    const callback = (data: string): Outcome<boolean> => {
      const regex = /<CurrentMute>([0-1])<\/CurrentMute>/gmu
      const match = regex.exec(data)
      if (match != null) {
        return { value: match[1] === '1' }
      }
      return { value: true }
    }

    return this.sendRequest<boolean>(
      'render',
      'GetMute',
      AudioChannel,
      callback
    )
  }

  /**
   * Set mute to on/off
   */
  public async setMute<T>(enable: boolean): Promise<Outcome<T>> {
    const mute = enable ? '1' : '0'
    const parameters = `${AudioChannel}<DesiredMute>${mute}</DesiredMute>`

    return await this.sendRequest<T>('render', 'SetMute', parameters)
  }

  /**
   * Returns the list of apps on the TV
   */
  public async getApps<T>(): Promise<Outcome<T>> {
    const callback = (data: string): Outcome<T> => {
      const raw = getKey('X_AppList', data)
      if (raw.error != null) {
        this.log.error('X_AppList returned originally', data)
        return { error: raw.error }
      }
      const decoded = decodeXML(raw.value as string)
      const re = /'product_id=(?<id>(\d|[A-Z])+)'(?<appName>([^'])+)/gmu
      let i
      const apps: VieraApps = []
      while ((i = re.exec(decoded)) != null) {
        apps.push({ name: i.groups.appName, id: i.groups.id })
      }
      if (apps.length === 0) {
        return { error: new Error('The TV is in standby!') }
      }
      return { value: (apps as unknown) as T }
    }
    return this.sendRequest<T>('command', 'X_GetAppList', undefined, callback)
  }
}
