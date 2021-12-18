import crypto from 'crypto'
import { Logger } from 'homebridge'
import http from 'http'
import net, { isIPv4 } from 'net'
import { URL } from 'url'

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { decode } from 'html-entities'

import { InputVisibility } from './accessory'
import { Abnormal, html, isEmpty, Ok, Outcome, xml2obj, xml } from './helpers'
import VieramaticPlatform from './platform'
import UPnPSubscription from './upnpsub'

// helpers and default settings
const AudioChannel: string = xml({ Channel: 'Master', InstanceID: 0 })
type VieraSpecs =
  | Record<string, never>
  | {
      friendlyName: string
      modelName: string
      modelNumber: string
      manufacturer: string
      serialNumber: string
      requiresEncryption: boolean
    }

interface VieraApp {
  name: string
  id: string
  hidden?: InputVisibility
}
type VieraApps = VieraApp[]

type RequestType = 'command' | 'render'

type VieraSession =
  | Record<string, never>
  | {
      iv: Buffer
      key: Buffer
      hmacKey: Buffer
      challenge: Buffer
      seqNum: number
      id: number
    }

type VieraAuth =
  | Record<string, never>
  | {
      appId: string
      key: string
    }

class VieraTV implements VieraTV {
  private static readonly NRC = '/nrc/control_0'
  private static readonly DMR = '/dmr/control_0'
  private static readonly INFO = '/nrc/ddd.xml'
  private static readonly ACTIONS = '/nrc/sdd_0.xml'

  private static readonly RemoteURN = 'panasonic-com:service:p00NetworkControl:1'
  private static readonly RenderingURN = 'schemas-upnp-org:service:RenderingControl:1'
  private static readonly plainText = ['X_GetEncryptSessionId', 'X_DisplayPinCode', 'X_RequestAuth']

  static readonly port = 55000

  readonly address: string

  readonly mac: string | undefined

  readonly log: Logger | Console

  apps: Outcome<VieraApps> = {}
  auth: VieraAuth = {}
  #client: AxiosInstance
  #session: VieraSession = {}

  specs: VieraSpecs = {}

  private constructor(ip: string, log: Logger | Console, mac?: string) {
    this.address = ip
    this.log = log
    this.mac = mac

    this.#client = axios.create({
      baseURL: `http://${this.address}:${VieraTV.port}`,
      headers: {
        Accept: 'application/xml',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/xml; charset="utf-8"',
        Host: `${this.address}:${VieraTV.port}`,
        Pragma: 'no-cache'
      },
      timeout: 3500
    })
  }

  static async connect(
    ip: string,
    log: Logger | Console,
    settings: { auth?: VieraAuth; bootstrap?: boolean; cached?: VieraSpecs; mac?: string } = {}
  ): Promise<Outcome<VieraTV>> {
    const tv = new VieraTV(ip, log, settings.mac)
    tv.specs = await tv.#getSpecs()
    settings.bootstrap ??= false
    if (!settings.bootstrap) {
      if (isEmpty(tv.specs) && settings?.cached != null) {
        tv.log.warn(`Unable to fetch specs from TV at '${ip}'.`)
        tv.log.warn('Using the previously cached ones:\n\n', JSON.stringify(settings?.cached))
        if (settings?.cached?.requiresEncryption) {
          const err = `IGNORING '${ip}' as we do not support offline initialization, from cache, for models that require encryption.`
          return { error: Error(err) }
        }
        tv.specs ??= settings?.cached
      }

      if (tv.specs.requiresEncryption) {
        const err = `'${ip} ('${tv.specs.modelName}')' ignored, as it is from a Panasonic TV that
        requires  encryption and no working credentials were supplied.`

        if (settings?.auth != null) tv.auth = settings.auth
        if (tv.auth == null) return { error: Error(err) }

        tv.#deriveSessionKey(tv.auth.key)
        const result = await tv.#requestSessionId()

        if (Abnormal(result)) return { error: Error(err) }
      }
    } else if (isEmpty(tv.specs))
      return { error: Error('An unexpected error occurred - Unable to fetch specs from the TV.') }

    tv.apps = await tv.#getApps()

    return { value: tv }
  }

  static probe = async (ip: string, log: Logger | Console = console): Promise<Outcome<VieraTV>> =>
    !isIPv4(ip)
      ? { error: Error('Please introduce a valid ip address!') }
      : !(await VieraTV.livenessProbe(ip))
      ? { error: Error(`The provided IP (${ip}) is unreachable.`) }
      : await this.connect(ip, log, { bootstrap: true })

  static livenessProbe = async (tv: string, timeout = 1500): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      const state = (state = true): void => {
        socket.destroy()
        resolve(state)
      }
      const [isUp, isDown] = [(): void => state(true), (): void => state(false)]

      socket
        .connect(VieraTV.port, tv, isUp)
        .on('error', isDown)
        .setTimeout(timeout)
        .on('timeout', isDown)
    })

  isTurnedOn = async (): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      const watcher = new UPnPSubscription(this.address, VieraTV.port, '/nrc/event_0')
      setTimeout(() => watcher.unsubscribe(), 1500)
      watcher
        .once('message', (message): void => {
          const properties = message.body['e:propertyset']['e:property']
          if (!Array.isArray(properties)) {
            this.log.error('Unsuccessful (!) communication with TV.')
            resolve(false)
          } else {
            const match = properties.filter((prop) => ['on', 'off'].includes(prop.X_ScreenState))
            /* TODO: FIXME
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
            match.length > 0 ? resolve(match[0].X_ScreenState === 'on') : resolve(true)
          }
        })
        .on('error', () => resolve(false))
    })

  #needsCrypto = async (): Promise<boolean> =>
    await this.#client
      .get(VieraTV.ACTIONS)
      // @ts-expect-error (ts2352)
      .then((resp) => !!((resp.data as string).match(/X_GetEncryptSessionId/u) as boolean))
      .catch(() => false)

  #requestSessionId = async (): Promise<Outcome<void>> => {
    let outcome: Outcome<string>
    const callback = (data: string): Outcome<void> => {
      const error = Error('abnormal result from TV - session ID is not (!) an integer')
      const match = /<X_SessionId>(?<sessionId>\d+)<\/X_SessionId>/u.exec(data)
      const number = match?.groups?.sessionId

      if (number == null || Number.isNaN(number)) return { error }

      this.#session.seqNum = 1
      this.#session.id = Number.parseInt(number, 10)
      return {}
    }

    return Ok((outcome = this.#encryptPayload(xml({ X_ApplicationId: this.auth.appId }))))
      ? await this.#postRemote(
          'X_GetEncryptSessionId',
          xml({ X_ApplicationId: this.auth.appId, X_EncInfo: outcome.value }),
          callback
        )
      : outcome
  }

  #deriveSessionKey = (key: string): void => {
    let [i, j]: number[] = []
    const iv = Buffer.from(key, 'base64')
    const keyVals = Buffer.alloc(16)

    for (i = j = 0; j < 16; i = j += 4) {
      keyVals[i] = iv[i + 2]
      keyVals[i + 1] = iv[i + 3]
      keyVals[i + 2] = iv[i]
      keyVals[i + 3] = iv[i + 1]
    }
    this.#session.iv = iv
    this.#session.key = Buffer.from(keyVals)
    this.#session.hmacKey = Buffer.concat([iv, iv])
  }

  #decryptPayload(payload: string, key: Buffer, iv: Buffer): string {
    const aes = crypto.createDecipheriv('aes-128-cbc', key, iv)
    const decrypted = aes.update(Buffer.from(payload, 'base64'))
    return decrypted.toString('utf-8', 16, decrypted.indexOf('\u0000', 16))
  }

  #encryptPayload(
    original: string,
    key: Buffer = this.#session.key,
    iv: Buffer = this.#session.iv,
    hmacKey: Buffer = this.#session.hmacKey
  ): Outcome<string> {
    try {
      const data = Buffer.from(original)
      const headerPrefix = Buffer.from(crypto.randomBytes(12))
      const headerSufix = Buffer.alloc(4)
      headerSufix.writeIntBE(data.length, 0, 4)
      const payload = Buffer.concat([headerPrefix, headerSufix, data])
      const aes = crypto.createCipheriv('aes-128-cbc', key, iv)
      const ciphered = Buffer.concat([aes.update(payload), aes.final()])
      const sig = crypto.createHmac('sha256', hmacKey).update(ciphered).digest()

      return { value: Buffer.concat([ciphered, sig]).toString('base64') }
    } catch (error) {
      return { error: error as Error }
    }
  }

  /*
   * Returns the TV specs
   */
  #getSpecs = async (): Promise<VieraSpecs> => {
    return await this.#client
      .get(VieraTV.INFO)
      .then(async (raw): Promise<VieraSpecs> => {
        const jsonObject = xml2obj(raw.data as string)
        // @ts-expect-error ts(2339)
        const { device } = jsonObject.root
        const specs: VieraSpecs = {
          friendlyName: device.friendlyName.length > 0 ? device.friendlyName : device.modelName,
          manufacturer: device.manufacturer,
          modelName: device.modelName,
          modelNumber: device.modelNumber,
          requiresEncryption: await this.#needsCrypto(),
          serialNumber: device.UDN.slice(5)
        }

        this.log.info(
          "found a '%s' TV (%s) at '%s' %s.\n",
          specs.modelName,
          specs.modelNumber,
          this.address,
          specs.requiresEncryption ? '(requires crypto for communication)' : ''
        )
        return specs
      })
      .catch((error) => {
        this.log.debug('getSpecs:', error)
        return {}
      })
  }

  #renderEncryptedRequest = async (
    action: string,
    urn: string,
    parameters: string
  ): Promise<Outcome<string[]>> => {
    // this.log.debug(`(renderEncryptedRequest) [${action}] urn:[${urn}], parameters: [${parameters}]`)
    this.#session.seqNum += 1

    const encCommand = xml({
      X_OriginalCommand: { [`u:${action}`]: { '#text': parameters, '@_xmlns:u': `urn:${urn}` } },
      X_SequenceNumber: String(this.#session.seqNum + 1).padStart(8, '0'),
      X_SessionId: this.#session.id
    })
    const outcome = this.#encryptPayload(encCommand)

    return Ok(outcome)
      ? {
          value: [
            'X_EncryptedCommand',
            xml({ X_ApplicationId: this.auth.appId, X_EncInfo: outcome.value })
          ]
        }
      : outcome
  }

  #renderRequest = (action: string, urn: string, parameters: string): AxiosRequestConfig => {
    const method: AxiosRequestConfig['method'] = 'POST'
    const responseType: AxiosRequestConfig['responseType'] = 'text'
    const headers = { SOAPACTION: `"urn:${urn}#${action}"` }
    const data = '<?xml version="1.0" encoding="utf-8"?>'.concat(
      xml({
        's:Envelope': {
          '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
          '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
          's:Body': { [`u:${action}`]: { '#text': parameters, '@_xmlns:u': `urn:${urn}` } }
        }
      })
    )

    return { data, headers, method, responseType }
  }

  #post = async <T>(
    requestType: RequestType,
    realAction: string,
    realParameters = 'None',
    closure: (arg: string) => Outcome<T> = (x) => x as unknown as Outcome<T>
  ): Promise<Outcome<T>> => {
    let [action, parameters]: string[] = []
    let payload: Outcome<T>, reset: Outcome<void>
    const [sessionGone, isCommand] = ['No such session', requestType === 'command']
    const [urL, urn] = isCommand
      ? [VieraTV.NRC, VieraTV.RemoteURN]
      : [VieraTV.DMR, VieraTV.RenderingURN]

    const doIt = async (): Promise<Outcome<T>> => {
      if (this.specs.requiresEncryption && isCommand && !VieraTV.plainText.includes(realAction)) {
        const outcome = await this.#renderEncryptedRequest(realAction, urn, realParameters)

        if (Ok(outcome)) [action, parameters] = outcome.value
        else return outcome
      } else [action, parameters] = [realAction, realParameters]

      return await this.#client(urL, this.#renderRequest(action, urn, parameters))
        .then((r) => {
          const replacer = (_match: string, _offset: string, content: string): string =>
            this.#decryptPayload(content, this.#session.key, this.#session.iv)
          const value = r.data.replace(/(<X_EncResult>)(.*)(<\/X_EncResult>)/g, replacer)

          return { value }
        })
        .catch((error) =>
          error.response?.status === 500 && (error.response.data as string)?.includes(sessionGone)
            ? { error: Error(sessionGone) }
            : { error }
        )
    }

    if (Abnormal((payload = await doIt())))
      if (payload.error.message === sessionGone) {
        this.log.warn('Session mismatch found; The session counter was reset in order to move on.')
        if (Abnormal((reset = await this.#requestSessionId()))) return reset
        if (Abnormal((payload = await doIt()))) return payload
      } else return payload

    return closure(payload.value as unknown as string)
  }

  requestPinCode = async (): Promise<Outcome<string>> => {
    const overreachErr = `The ${this.specs.modelNumber} model at ${this.address} doesn't need encryption!`
    const unexpectedErr = `An unexpected error occurred while attempting to request a pin code from the TV.`
    const notReadyErr = `Unable to request pin code as the TV seems to be in standby; Please turn it ON!`

    const parameters = xml({ X_DeviceName: 'MyRemote' })
    const callback = (data: string): Outcome<string> => {
      const match = /<X_ChallengeKey>(?<challenge>\S*)<\/X_ChallengeKey>/u.exec(data)

      if (match?.groups?.challenge == null) return { error: Error(unexpectedErr) }

      this.#session.challenge = Buffer.from(match.groups.challenge, 'base64')
      return { value: match.groups.challenge }
    }

    return !this.specs.requiresEncryption
      ? { error: Error(overreachErr) }
      : !(await this.isTurnedOn())
      ? { error: Error(notReadyErr) }
      : await this.#postRemote('X_DisplayPinCode', parameters, callback)
  }

  #postRemote = async <T>(
    realAction: string,
    realParameters = 'None',
    closure: (arg: string) => Outcome<T> = (x) => x as unknown as Outcome<T>
  ): Promise<Outcome<T>> => await this.#post('command', realAction, realParameters, closure)

  authorizePinCode = async (pin: string, challenge?: string): Promise<Outcome<VieraAuth>> => {
    // injection needed by the ui-server
    if (challenge) this.#session.challenge = Buffer.from(challenge, 'base64')

    let [i, j, l, k]: number[] = []
    let ack: Outcome<VieraAuth>, outcome: Outcome<string>
    const [iv, key, hmacKey] = [this.#session.challenge, Buffer.alloc(16), Buffer.alloc(32)]
    const error = Error('Wrong pin code...')

    for (i = k = 0; k < 16; i = k += 4) {
      key[i] = ~iv[i + 3] & 0xff
      key[i + 1] = ~iv[i + 2] & 0xff
      key[i + 2] = ~iv[i + 1] & 0xff
      key[i + 3] = ~iv[i] & 0xff
    }
    // Derive HMAC key from IV & HMAC key mask (taken from libtvconnect.so)
    const hmacKeyMaskVals = [
      0x15, 0xc9, 0x5a, 0xc2, 0xb0, 0x8a, 0xa7, 0xeb, 0x4e, 0x22, 0x8f, 0x81, 0x1e, 0x34, 0xd0,
      0x4f, 0xa5, 0x4b, 0xa7, 0xdc, 0xac, 0x98, 0x79, 0xfa, 0x8a, 0xcd, 0xa3, 0xfc, 0x24, 0x4f,
      0x38, 0x54
    ]
    for (j = l = 0; l < 32; j = l += 4) {
      hmacKey[j] = hmacKeyMaskVals[j] ^ iv[(j + 2) & 0xf]
      hmacKey[j + 1] = hmacKeyMaskVals[j + 1] ^ iv[(j + 3) & 0xf]
      hmacKey[j + 2] = hmacKeyMaskVals[j + 2] ^ iv[j & 0xf]
      hmacKey[j + 3] = hmacKeyMaskVals[j + 3] ^ iv[(j + 1) & 0xf]
    }
    const callback = (r: string): Outcome<VieraAuth> => {
      const AuthResult = /(<X_AuthResult>)(.*)(<\/X_AuthResult>)/g
      const KeyPair =
        /<X_ApplicationId>(?<appId>\S+)<\/X_ApplicationId>\s+<X_Keyword>(?<key>\S+)<\/X_Keyword>/
      const replacer = (_match: string, _offset: string, content: string): string =>
        this.#decryptPayload(content, key, iv)

      return { value: KeyPair.exec(r.replace(AuthResult, replacer))?.groups as VieraAuth }
    }

    return Abnormal((outcome = this.#encryptPayload(xml({ X_PinCode: pin }), key, iv, hmacKey)))
      ? outcome
      : Ok(
          (ack = await this.#postRemote(
            'X_RequestAuth',
            xml({ X_AuthInfo: outcome.value }),
            callback
          ))
        )
      ? ack
      : { error }
  }

  renderSampleConfig = (): void => {
    const sample = {
      platform: 'PanasonicVieraTV',
      tvs: [
        {
          appId: this.auth?.appId ?? undefined,
          encKey: this.auth?.key ?? undefined,
          hdmiInputs: []
        }
      ]
    }

    console.info(
      '\n',
      'Please add, as a starting point, the snippet bellow inside the ',
      "'platforms' array of your homebridge's 'config.json'\n--x--"
    )

    console.group()
    console.log(JSON.stringify(sample, undefined, 4))
    console.groupEnd()
    console.log('--x--')
  }

  static webSetup = async (ctx: VieramaticPlatform): Promise<void> => {
    const server = http.createServer(async (request, response) => {
      let ip: string, tv: VieraTV
      const urlObj = new URL(request.url ?? '', `http://${request.headers.host as string}`)

      let [returnCode, body] = [200, 'nothing to see here - move on']

      ctx.log.debug(urlObj.toString())

      if (urlObj.searchParams.has('pin')) {
        if (urlObj.searchParams.has('tv')) {
          const ip = urlObj.searchParams.get('tv') as string
          const pin = urlObj.searchParams.get('pin') as string

          ctx.log.debug(urlObj.toString())

          const probe = await VieraTV.probe(ip, ctx.log)
          if (Ok(probe)) {
            tv = probe.value
            if (tv?.specs?.requiresEncryption && urlObj.searchParams.has('challenge')) {
              const challenge = urlObj.searchParams.get('challenge') as string
              tv.#session.challenge = Buffer.from(challenge, 'base64')
              const auth = await tv.authorizePinCode(pin)
              if (Ok(auth)) {
                tv.auth = auth.value
                body = html` Paired with your TV sucessfully!. <br />
                  <b>Encryption Key</b>: <b>${tv.auth.key}</b> <br />
                  <b>AppId</b>: <b>${tv.auth.appId}</b> <br />`
              } else [returnCode, body] = [500, auth.error.message]
            }
          } else [returnCode, body] = [500, probe.error.message]
        }
      } else if ((ip = urlObj.searchParams.get('ip') as string) != null) {
        const probe = await VieraTV.probe(ip, ctx.log)
        if (Ok(probe)) {
          tv = probe.value
          if (isEmpty(tv.specs)) {
            returnCode = 500
            body = html` An unexpected error occurred: <br />
              Unable to fetch specs from the TV (at ${ip}).`
          } else {
            const challenge = await tv.requestPinCode()
            if (Ok(challenge)) {
              body = html` Found a <b>${tv.specs.modelNumber}</b>, on ${ip}, which requires
                encryption. <br />
                <form action="/">
                  <label for="pin">
                    Please enter the PIN just displayed in Panasonic™ Viera™ TV:
                  </label>
                  <br /><input type="text" id="pin" name="pin" />
                  <input type="hidden" value=${ip} name="tv" />
                  <input
                    type="hidden"
                    value=${tv.#session.challenge.toString('base64')}
                    name="challenge"
                  />
                  <input type="submit" value="Submit" />
                </form>`
            } else [returnCode, body] = [500, challenge.error.message]
          }
        } else [returnCode, body] = [500, probe.error.message]
      } else {
        body = html` <form action="/">
          <label for="ip">
            Please enter your Panasonic™ Viera™ (2018 or later model) IP address:
          </label>
          <br />
          <input type="text" id="ip" name="ip" />
          <input type="submit" value="Submit" />
        </form>`
      }

      response.writeHead(returnCode, { 'Content-Type': 'text/html; charset=utf-8' })
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
      ctx.log.error(error.message)
    })

    ctx.log.info('launching encryption helper endpoint on :8973')
    server.listen(8973)
  }

  /**
   * Sends a (command) Key to the TV
   */
  sendKey = async <T>(cmd: string): Promise<Outcome<T>> =>
    await this.#postRemote('X_SendKey', xml({ X_KeyEvent: `NRC_${cmd.toUpperCase()}-ONOFF` }))

  /**
   * Send a change HDMI input to the TV
   */
  switchToHDMI = async <T>(hdmiInput: string): Promise<Outcome<T>> =>
    await this.#postRemote('X_SendKey', xml({ X_KeyEvent: `NRC_HDMI${hdmiInput}-ONOFF` }))

  /**
   * Send command to open app on the TV
   */
  launchApp = async <T>(appId: string): Promise<Outcome<T>> =>
    await this.#postRemote(
      'X_LaunchApp',
      xml({
        X_AppType: 'vc_app',
        X_LaunchKeyword: appId.length === 16 ? `product_id=${appId}` : `resource_id=${appId}`
      })
    )

  /**
   * Get volume from TV
   */
  getVolume = async (): Promise<Outcome<string>> => {
    const callback = (data: string): Outcome<string> => {
      const match = /<CurrentVolume>(?<volume>\d*)<\/CurrentVolume>/u.exec(data)
      return match?.groups?.volume != null ? { value: match.groups.volume } : { value: '0' }
    }
    return await this.#post('render', 'GetVolume', AudioChannel, callback)
  }

  /**
   * Set Volume
   */
  setVolume = async (volume: string): Promise<Outcome<void>> =>
    await this.#post('render', 'SetVolume', AudioChannel.concat(xml({ DesiredVolume: volume })))

  /**
   * Gets the current mute setting
   * @returns true for mute
   */
  getMute = async (): Promise<Outcome<boolean>> => {
    const callback = (data: string): Outcome<boolean> => {
      const match = /<CurrentMute>(?<mute>[01])<\/CurrentMute>/u.exec(data)

      return match?.groups?.mute != null ? { value: match.groups.mute === '1' } : { value: true }
    }

    return await this.#post('render', 'GetMute', AudioChannel, callback)
  }

  /**
   * Set mute to on/off
   */
  setMute = async (d: boolean): Promise<Outcome<void>> =>
    await this.#post('render', 'SetMute', AudioChannel.concat(xml({ DesiredMute: d ? '1' : '0' })))

  /**
   * Returns the list of apps on the TV
   */
  #getApps = async (): Promise<Outcome<VieraApps>> => {
    const callback = (data: string): Outcome<VieraApps> => {
      const value: VieraApps = []
      const raw = /<X_AppList>(?<appList>.*)<\/X_AppList>/u.exec(data)?.groups?.appList

      if (raw == null) return { error: Error('X_AppList returned originally:\n'.concat(data)) }

      for (const i of decode(raw).matchAll(/'product_id=(?<id>[\dA-Z]+)'(?<name>[^']+)/gu))
        i.groups != null && value.push(i.groups as unknown as VieraApp)

      return value.length === 0 ? { error: Error('The TV is in standby!') } : { value }
    }
    return await this.#postRemote('X_GetAppList', undefined, callback)
  }
}

export { VieraApp, VieraApps, VieraAuth, VieraSpecs, VieraTV }
