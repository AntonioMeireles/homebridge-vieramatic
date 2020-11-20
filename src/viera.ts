/* eslint-disable no-multi-assign */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { decodeXML } from 'entities';
import parser from 'fast-xml-parser';
import http from 'http';
import { Address4 } from 'ip-address';
import net from 'net';
import UPnPsub from 'node-upnp-subscription';
import * as readlineSync from 'readline-sync';
import { URL } from 'url';

// helpers and default settings
const API_ENDPOINT = 55000;
const curl: AxiosInstance = axios.create({ timeout: 3500 });
const AudioChannel = '<InstanceID>0</InstanceID><Channel>Master</Channel>';

interface VieraSpecs {
  friendlyName: string;
  modelName: string;
  modelNumber: string;
  manufacturer: string;
  serialNumber: string;
  requiresEncryption: boolean;
}

interface VieraApp {
  name: string;
  id: string;
}
export type VieraApps = VieraApp[];

type RequestType = 'command' | 'render';
/* eslint-disable-next-line no-shadow */
enum AlwaysInPlainText {
  /* eslint-disable camelcase */
  X_GetEncryptSessionId = 'X_GetEncryptSessionId',
  X_DisplayPinCode = 'X_DisplayPinCode',
  X_RequestAuth = 'X_RequestAuth'
}
interface VieraAuthSession {
  iv: Buffer;
  key: Buffer;
  hmacKey: Buffer;
  challenge: Buffer;
  seqNum: number;
  id: number;
}

interface VieraAuth {
  appId: string;
  key: string;
}

export interface Outcome<T> {
  error?: unknown;
  value?: T;
}

const getKey = (key: string, xml: string): Outcome<string> => {
  /* eslint-disable no-restricted-syntax, no-continue, no-prototype-builtins */
  const fn = (object, k: string): string => {
    let objects: string[] = [];
    for (const i in object) {
      if (!object.hasOwnProperty(i)) {
        continue;
      }
      if (typeof object[i] == 'object') {
        objects = objects.concat(fn(object[i], k));
      } else if (i === k) {
        objects.push(object[i]);
      }
    }
    return objects[0];
  };
  let result: string;
  try {
    /*
     * FIXME: we should do some fine grained error handling here, sadly the
     *        obvious one can't be done as we 'd get ...
     *          Error: Multiple possible root nodes found.
     *        which of all things breaks pairing (#34)
     */
    result = fn(parser.parse(xml), key);
  } catch (error: unknown) {
    return { error };
  }
  return { value: result };
};

export class VieraTV implements VieraTV {
  readonly address: string;

  readonly port = API_ENDPOINT;

  readonly baseURL: string;

  readonly log: Console;

  auth: VieraAuth;

  session: VieraAuthSession;

  specs: VieraSpecs;

  constructor(ip: Address4, log: Console = console, auth = {} as VieraAuth) {
    this.address = ip.address;
    this.baseURL = `http://${this.address}:${this.port}`;
    this.log = log;
    this.auth = auth;
    this.session = {} as VieraAuthSession;
    this.specs = (undefined as unknown) as VieraSpecs;
  }

  public static async livenessProbe(
    tv: Address4,
    port = API_ENDPOINT,
    timeout = 2000
  ): Promise<boolean> {
    const probe = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();

      const onError = (): void => {
        socket.destroy();
        reject();
      };

      socket
        .setTimeout(timeout)
        .on('error', onError)
        .on('timeout', onError)
        .connect(port, tv.address, () => {
          socket.end();
          resolve();
        });
    });

    try {
      await probe;
      return true;
    } catch {
      return false;
    }
  }

  async isTurnedOn(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, promise/param-names
    const status = await new Promise((res, _rej) => {
      const watcher = new UPnPsub(this.address, API_ENDPOINT, '/nrc/event_0');
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      setTimeout(watcher.unsubscribe, 1500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      watcher.once('message', (message: any): void => {
        const properties = message.body['e:propertyset']['e:property'];
        if ({}.toString.call(properties) !== '[object Array]') {
          this.log.error('Unsuccessful (!) communication with TV.');
          res(false);
        }
        const match = properties.filter((prop) =>
          ['on', 'off'].includes(prop.X_ScreenState)
        );
        match !== [] ? res(match[0].X_ScreenState === 'on') : res(false);
      });
      watcher.on('error', () => res(false));
    });
    return status as boolean;
  }

  async needsCrypto(): Promise<boolean> {
    return curl
      .get(`${this.baseURL}/nrc/sdd_0.xml`)
      .then((reply) => {
        return !!reply.data.match(/X_GetEncryptSessionId/u);
      })
      .catch(() => {
        return false;
      });
  }

  async requestSessionId<T>(): Promise<Outcome<T>> {
    const appId = `<X_ApplicationId>${this.auth.appId}</X_ApplicationId>`;

    const outcome = this.encryptPayload(appId);
    if (outcome.error) {
      return { error: outcome.error };
    }
    const encinfo = outcome.value;
    const parameters = `<X_ApplicationId>${this.auth.appId}</X_ApplicationId> <X_EncInfo>${encinfo}</X_EncInfo>`;

    const callback = (data: string): Outcome<T> => {
      this.session.seqNum = 1;
      const number = getKey('X_SessionId', data);
      if (number.error) {
        return { error: number.error };
      }
      if (Number.isInteger(number.value)) {
        this.session.id = Number.parseInt(number.value as string, 10);
        return {};
      }
      const error = new Error(
        'abnormal result from TV - session ID is not (!) an integer'
      );
      return { error };
    };

    return this.sendRequest<T>(
      'command',
      'X_GetEncryptSessionId',
      parameters,
      callback
    );
  }

  deriveSessionKey(key: string): [Buffer, Buffer] {
    let [i, j]: number[] = [];
    const iv = Buffer.from(key, 'base64');

    this.session.iv = iv;

    const keyVals = Buffer.alloc(16);
    for (i = j = 0; j < 16; i = j += 4) {
      keyVals[i] = iv[i + 2];
      keyVals[i + 1] = iv[i + 3];
      keyVals[i + 2] = iv[i];
      keyVals[i + 3] = iv[i + 1];
    }
    return [Buffer.from(keyVals), Buffer.concat([iv, iv])];
  }

  private decryptPayload(
    payload: string,
    key = this.session.key,
    iv = this.session.iv
  ): string {
    const decipher = crypto
      .createDecipheriv('aes-128-cbc', key, iv)
      .setAutoPadding(false);

    const decrypted = Buffer.concat([
      decipher.update(payload, 'base64'),
      decipher.final()
    ]).slice(16);

    const zero = decrypted.indexOf(0);
    let clean = zero > -1 ? decrypted.slice(0, zero - 1) : decrypted;

    const finalizer = '</X_OriginalResult>';
    const junk = clean.lastIndexOf(finalizer);
    clean = junk > -1 ? clean.slice(0, junk + finalizer.length) : clean;

    return clean.toString('binary');
  }

  private encryptPayload(
    original: string,
    key = this.session.key,
    iv = this.session.iv,
    hmacKey = this.session.hmacKey
  ): Outcome<string> {
    const pad = (unpadded: Buffer): Buffer => {
      const blockSize = 16;
      const extra = Buffer.alloc(blockSize - (unpadded.length % blockSize));
      return Buffer.concat([unpadded, extra]);
    };
    let ciphered: Buffer;
    let sig: Buffer;

    try {
      const data = Buffer.from(original);
      const headerPrefix = Buffer.from(
        [...new Array(12)].map(() => Math.round(Math.random() * 255))
      );

      const headerSufix = Buffer.alloc(4);
      headerSufix.writeIntBE(data.length, 0, 4);
      const header = Buffer.concat([headerPrefix, headerSufix]);
      const payload = pad(Buffer.concat([header, data]));
      const cipher = crypto
        .createCipheriv('aes-128-cbc', key, iv)
        .setAutoPadding(false);
      ciphered = Buffer.concat([cipher.update(payload), cipher.final()]);
      const hmac = crypto.createHmac('sha256', hmacKey);
      sig = hmac.update(ciphered).digest();
    } catch (error: unknown) {
      return { error };
    }
    return { value: Buffer.concat([ciphered, sig]).toString('base64') };
  }

  /*
   * Returns the TV specs
   */
  async getSpecs(): Promise<VieraSpecs> {
    return curl
      .get(`${this.baseURL}/nrc/ddd.xml`)
      .then(
        async (raw): Promise<VieraSpecs> => {
          const jsonObject = parser.parse(raw.data);
          const { device } = jsonObject.root;
          const specs = <VieraSpecs>{
            friendlyName:
              device.friendlyName.length > 0
                ? device.friendlyName
                : device.modelName,
            modelName: device.modelName,
            modelNumber: device.modelNumber,
            manufacturer: device.manufacturer,
            serialNumber: device.UDN.slice(5),
            requiresEncryption: await this.needsCrypto()
          };

          this.log.info(
            "found a '%s' TV (%s) at '%s' %s.\n",
            specs.modelName,
            specs.modelNumber,
            this.address,
            specs.requiresEncryption ? '(requires crypto for comunication)' : ''
          );
          return specs;
        }
      )
      .catch((error) => {
        this.log.error('getSpecs:', error);
        return (undefined as unknown) as VieraSpecs;
      });
  }

  private renderEncryptedRequest(
    action: string,
    urn: string,
    parameters: string
  ): Outcome<string[]> {
    this.session.seqNum += 1;
    const encCommand =
      `<X_SessionId>${this.session.id}</X_SessionId>` +
      `<X_SequenceNumber>${`00000000${this.session.seqNum}`.slice(
        -8
      )}</X_SequenceNumber>` +
      `<X_OriginalCommand> <u:${action} xmlns:u="urn:${urn}">${parameters}</u:${action}> </X_OriginalCommand>`;
    const outcome = this.encryptPayload(encCommand);
    if (outcome.error) {
      return { error: outcome.error };
    }
    return {
      value: [
        'X_EncryptedCommand',
        `<X_ApplicationId>${this.auth.appId}</X_ApplicationId> <X_EncInfo>${outcome.value}</X_EncInfo>`
      ]
    };
  }

  private renderRequest(
    action: string,
    urn: string,
    parameters: string
  ): AxiosRequestConfig {
    let [data, method, responseType]: string[] = [];
    method = 'POST';
    responseType = 'text';
    const headers = {
      Host: `${this.address}:${this.port}`,
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:${urn}#${action}"`,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Accept: 'text/xml'
    };
    data =
      '<?xml version="1.0" encoding="utf-8"?> ' +
      ' <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"> ' +
      `<s:Body> <u:${action} xmlns:u="urn:${urn}"> ${parameters} </u:${action}> </s:Body> </s:Envelope>`;

    return { method, headers, data, responseType } as AxiosRequestConfig;
  }

  public async sendRequest<T>(
    requestType: RequestType,
    realAction: string,
    realParameters = 'None',
    callback?: (...unknown) => Outcome<T>
  ): Promise<Outcome<T>> {
    let [urL, urn, action, parameters]: string[] = [];

    if (requestType === 'command') {
      urL = '/nrc/control_0';
      urn = 'panasonic-com:service:p00NetworkControl:1';
    } else {
      urL = '/dmr/control_0';
      urn = 'schemas-upnp-org:service:RenderingControl:1';
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
      );
      if (outcome.error) {
        return { error: outcome.error };
      }
      [action, parameters] = outcome.value as string[];
    } else {
      [action, parameters] = [realAction, realParameters];
    }

    const postRequest = this.renderRequest(action, urn, parameters);
    const payload = await curl(`${this.baseURL}${urL}`, postRequest)
      .then((r) => {
        let output: Outcome<T>;
        if (
          action === 'X_GetEncryptSessionId' ||
          action === 'X_EncryptedCommand'
        ) {
          const extracted = getKey('X_EncResult', r.data);
          if (extracted.error) {
            return extracted;
          }
          const clean = this.decryptPayload(extracted.value as string);
          output = {
            value: <T>(clean as unknown)
          };
        } else {
          output = { value: r.data };
        }
        return output;
      })
      .catch((error: unknown) => {
        return {
          error,
          value: undefined
        };
      });

    if (payload.error) {
      return { error: payload.error };
    }
    if (callback) {
      return callback(payload.value) as Outcome<T>;
    }
    return <T>payload;
  }

  private async requestPinCode<T>(): Promise<Outcome<T>> {
    const parameters = '<X_DeviceName>MyRemote</X_DeviceName>';
    const callback = (data: string): Outcome<T> => {
      const match = /<X_ChallengeKey>(\S*)<\/X_ChallengeKey>/gmu.exec(data);
      if (match === null) {
        return {
          error: new Error(
            'unexpected reply from TV when requesting challenge key'
          )
        };
      }
      this.session.challenge = Buffer.from(match[1], 'base64');
      return {};
    };
    return this.sendRequest<T>(
      'command',
      'X_DisplayPinCode',
      parameters,
      callback
    );
  }

  private async authorizePinCode<T>(pin: string): Promise<Outcome<T>> {
    /* eslint-disable no-bitwise */
    const [iv, key, hmacKey] = [
      this.session.challenge,
      Buffer.alloc(16),
      Buffer.alloc(32)
    ];
    let [i, j, l, k]: number[] = [];
    for (i = k = 0; k < 16; i = k += 4) {
      key[i] = ~iv[i + 3] & 0xff;
      key[i + 1] = ~iv[i + 2] & 0xff;
      key[i + 2] = ~iv[i + 1] & 0xff;
      key[i + 3] = ~iv[i] & 0xff;
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
    ];
    for (j = l = 0; l < 32; j = l += 4) {
      hmacKey[j] = hmacKeyMaskVals[j] ^ iv[(j + 2) & 0xf];
      hmacKey[j + 1] = hmacKeyMaskVals[j + 1] ^ iv[(j + 3) & 0xf];
      hmacKey[j + 2] = hmacKeyMaskVals[j + 2] ^ iv[j & 0xf];
      hmacKey[j + 3] = hmacKeyMaskVals[j + 3] ^ iv[(j + 1) & 0xf];
    }
    const data = `<X_PinCode>${pin}</X_PinCode>`;
    const outcome = this.encryptPayload(data, key, iv, hmacKey);
    if (outcome.error) {
      return { error: outcome.error };
    }
    const parameters = `<X_AuthInfo>${outcome.value}</X_AuthInfo>`;

    const callback = (r: string): Outcome<T> => {
      const raw = getKey('X_AuthResult', r);
      if (raw.error) {
        return { error: raw.error };
      }

      const authResultDecrypted = this.decryptPayload(
        raw.value as string,
        key,
        iv
      );

      const appId = getKey('X_ApplicationId', authResultDecrypted);
      if (appId.error) {
        return { error: appId.error };
      }
      const keyy = getKey('X_Keyword', authResultDecrypted);
      if (keyy.error) {
        return { error: keyy.error };
      }

      [this.auth.key, this.auth.appId] = [keyy.value, appId.value] as string[];

      // TODO: Proper error handling
      return {};
    };
    return this.sendRequest<T>(
      'command',
      'X_RequestAuth',
      parameters,
      callback
    );
  }

  private renderSampleConfig(): void {
    /* eslint-disable no-console */
    const sample = {
      platform: 'PanasonicVieraTV',
      tvs: [
        {
          encKey: this.auth?.key ? this.auth.key : undefined,
          appId: this.auth?.appId ? this.auth.appId : undefined,
          hdmiInputs: []
        }
      ]
    };

    console.info(
      '\n',
      "Please add, as a starting point, the snippet bellow inside the'",
      "'platforms' array of your homebridge's 'config.json'\n--x--"
    );

    console.group();
    console.log(JSON.stringify(sample, undefined, 4));
    console.groupEnd();
    console.log('--x--');
  }

  public static async webSetup(): Promise<void> {
    const server = http.createServer(async (request, response) => {
      let tv: VieraTV;
      const urlObject = new URL(
        request.url || '',
        `http://${request.headers.host}`
      );
      console.log(urlObject);
      let returnCode = 200;
      let body = 'nothing to see here - move on';

      if (urlObject.searchParams.get('pin')) {
        if (urlObject.searchParams.get('tv')) {
          const ip = urlObject.searchParams.get('tv');
          const pin = urlObject.searchParams.get('pin');
          console.log(urlObject);

          if (Address4.isValid(ip as string) === true) {
            const address = new Address4(ip as string);
            if ((await VieraTV.livenessProbe(address)) === true) {
              tv = new VieraTV(address);
              const specs = await tv.getSpecs();
              if (specs !== undefined) {
                if (specs.requiresEncryption === true) {
                  if (urlObject.searchParams.get('challenge')) {
                    tv.session.challenge = Buffer.from(
                      urlObject.searchParams.get('challenge') as string,
                      'base64'
                    );
                    const result = await tv.authorizePinCode(pin as string);
                    if (result.error) {
                      [returnCode, body] = [500, 'Wrong Pin code...'];
                    } else {
                      body = `
                      Paired with your TV sucessfully!.
                      <br />
                        <b>Encryption Key</b>: <b>${tv.auth.key}</b>
                      <br />
                        <b>AppId</b>: <b>${tv.auth.appId}</b>
                      <br />
                    `;
                    }
                  }
                }
              }
            }
          }
        }
      } else if (urlObject.searchParams.get('ip')) {
        const ip = urlObject.searchParams.get('ip');
        // const address = new Address4(ip as string);

        if (Address4.isValid(ip as string) !== true) {
          returnCode = 500;
          body = `the supplied TV ip address ('${ip}') is NOT a valid IPv4 address...`;
        } else {
          const address = new Address4(ip as string);
          if ((await VieraTV.livenessProbe(address)) === false) {
            body = `the supplied TV ip address '${ip}' is unreachable...`;
          } else {
            tv = new VieraTV(address);
            const specs = await tv.getSpecs();
            if (specs === undefined) {
              returnCode = 500;
              body = `
              An unexpected error occurred:
              <br />
              Unable to fetch specs from the TV (with ip address ${ip}).
            `;
            } else if (specs.requiresEncryption === false) {
              returnCode = 500;
              body = `
              Found a <b>${specs.modelNumber}</b> on ip address ${ip}!
              <br />
              It's just that <b>this specific model does not require encryption</b>!
            `;
            } else if (!(await tv.isTurnedOn())) {
              returnCode = 500;
              body = `
              Found a <b>${specs.modelNumber}</b>, on ip address ${ip}, which requires encryption.
              <br />
              Unfortunatelly the TV seems to be in standby. <b>Please turn it ON</b> and try again.
            `;
            } else {
              const newRequest = await tv.requestPinCode();
              if (newRequest.error) {
                returnCode = 500;
                body = `
                Found a <b>${specs.modelNumber}</b>, on ip address ${ip}, which requires encryption.
                <br />
                Sadly an unexpected error ocurred while attempting to request a pin code from the TV.
                Please make sure that the TV is powered ON (and NOT in standby).
              `;
              } else {
                /* eslint-disable prettier/prettier */
                body = `
                Found a <b>${specs.modelNumber
}</b>, on ip address ${ip}, which requires encryption.
                <br />
                <form action="/">
                  <label for="pin">
                    Please enter the PIN just displayed in Panasonic™ Viera™ TV:
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
              `;
              }
            }
          }
        }
      } else {
        body = `
          <form action="/">
            <label for="ip">
              Please enter your Panasonic™ Viera™ (2018 or later model) IP address:
            </label>
            <br />
            <input type="text" id="ip" name="ip" />
            <input type="submit" value="Submit" />
          </form>
        `;
      }

      response.writeHead(returnCode, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.write(`<!DOCTYPE html><html><body>${body}</body></html>`);
      response.end();
    });

    server.on('clientError', (error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      console.log(error);
    });
    server.listen(8973);
  }

  public static async setup(target: string): Promise<void> {
    if (Address4.isValid(target) !== true) {
      console.error('Please introduce a valid ip address!');
      process.exitCode = 1;
      return;
    }
    const ip = new Address4(target);
    if ((await this.livenessProbe(ip)) === false) {
      console.error('The IP you provided is unreachable.');
      process.exitCode = 1;
      return;
    }
    const tv = new VieraTV(ip);
    const specs = await tv.getSpecs();

    if (specs === undefined) {
      console.error(
        'An unexpected error occurred - Unable to fetch specs from the TV.'
      );
      process.exitCode = 1;
      return;
    }
    tv.specs = specs;
    if (tv.specs.requiresEncryption) {
      if (!(await tv.isTurnedOn())) {
        console.error(
          'Unable to proceed further as the TV seems to be in standby; Please turn it ON!'
        );
        process.exitCode = 1;
        return;
      }
      const request = await tv.requestPinCode();
      if (request.error) {
        console.error(
          '\nAn unexpected error occurred while attempting to request a pin code from the TV.',
          '\nPlease make sure that the TV is powered ON (and NOT in standby).'
        );
        process.exitCode = 1;
        return;
      }
      const pin = readlineSync.question('Enter the displayed pin code: ');
      const outcome = await tv.authorizePinCode(pin);
      if (outcome.error) {
        console.log('Wrong pin code...');
        process.exitCode = 1;
        return;
      }
    }
    tv.renderSampleConfig();
  }

  /**
   * Sends a command to the TV
   */
  public async sendCommand<T>(cmd: string): Promise<Outcome<T>> {
    const parameters = `<X_KeyEvent>NRC_${cmd.toUpperCase()}-ONOFF</X_KeyEvent>`;

    return this.sendRequest<T>('command', 'X_SendKey', parameters);
  }

  /**
   * Send a change HDMI input to the TV
   */
  public async sendHDMICommand<T>(hdmiInput: string): Promise<Outcome<T>> {
    const parameters = `<X_KeyEvent>NRC_HDMI${hdmiInput}-ONOFF</X_KeyEvent>`;

    return this.sendRequest<T>('command', 'X_SendKey', parameters);
  }

  /**
   * Send command to open app on the TV
   */
  public async sendAppCommand<T>(appId: string): Promise<Outcome<T>> {
    const cmd =
      `${appId}`.length === 16 ? `product_id=${appId}` : `resource_id=${appId}`;
    const parameters = `<X_AppType>vc_app</X_AppType><X_LaunchKeyword>${cmd}</X_LaunchKeyword>`;

    return this.sendRequest<T>('command', 'X_LaunchApp', parameters);
  }

  /**
   * Get volume from TV
   */
  public async getVolume(): Promise<Outcome<string>> {
    const callback = (data: string): Outcome<string> => {
      const match = /<CurrentVolume>(\d*)<\/CurrentVolume>/gmu.exec(data);
      if (match) {
        return { value: match[1] };
      }
      return { value: '0' };
    };
    const parameters = AudioChannel;

    return this.sendRequest<string>(
      'render',
      'GetVolume',
      parameters,
      callback
    );
  }

  /**
   * Set Volume
   */
  public async setVolume<T>(volume: string): Promise<Outcome<T>> {
    const parameters = `${AudioChannel}<DesiredVolume>${volume}</DesiredVolume>`;
    return this.sendRequest<T>('render', 'SetVolume', parameters);
  }

  /**
   * Get the current mute setting
   */
  public async getMute(): Promise<Outcome<boolean>> {
    const callback = (data: string): Outcome<boolean> => {
      const regex = /<CurrentMute>([0-1])<\/CurrentMute>/gmu;
      const match = regex.exec(data);
      if (match) {
        /* eslint-disable-next-line no-constant-condition */
        return { value: true ? match[1] === '1' : false };
      }
      return { value: true };
    };

    return this.sendRequest<boolean>(
      'render',
      'GetMute',
      AudioChannel,
      callback
    );
  }

  /**
   * Set mute to on/off
   */
  public async setMute<T>(enable: boolean): Promise<Outcome<T>> {
    const mute = enable ? '1' : '0';
    const parameters = `${AudioChannel}<DesiredMute>${mute}</DesiredMute>`;

    return this.sendRequest<T>('render', 'SetMute', parameters);
  }

  /**
   * Returns the list of apps on the TV
   */
  public async getApps<T>(): Promise<Outcome<T>> {
    const callback = (data: string): Outcome<T> => {
      const raw = getKey('X_AppList', data);
      if (raw.error) {
        this.log.error('X_AppList returned originally', data);
        return { error: raw.error };
      }
      const decoded = decodeXML(raw.value as string);
      const re = /'product_id=(?<id>(\d|[A-Z])+)'(?<appName>([^'])+)/gmu;
      let i;
      const apps: VieraApps = [];
      /* eslint-disable-next-line no-cond-assign */
      while ((i = re.exec(decoded))) {
        apps.push({ name: i.groups.appName, id: i.groups.id });
      }
      if (apps.length === 0) {
        return { error: new Error('The TV is in standby!') };
      }
      return { value: (apps as unknown) as T };
    };
    return this.sendRequest<T>('command', 'X_GetAppList', undefined, callback);
  }
}
