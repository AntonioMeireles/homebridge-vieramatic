/* eslint-disable unicorn/number-literal-case */
/* eslint-disable no-bitwise */
/* eslint-disable no-multi-assign */

import { Address4 } from 'ip-address';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import parser from 'fast-xml-parser';
import net from 'net';
import crypto from 'crypto';
import * as readlineSync from 'readline-sync';
import { decodeXML } from 'entities';
import http from 'http';
import url from 'url';

// helpers and default settings
const curl: AxiosInstance = axios.create({ timeout: 2000 });
const defaultAudioChannel =
  '<InstanceID>0</InstanceID><Channel>Master</Channel>';

interface VieraSpecs {
  friendlyName: string;
  modelName: string;
  modelNumber: string;
  manufacturer: string;
  serialNumber: string;
  requiresEncryption: boolean;
}

type RequestType = 'command' | 'render';
// eslint-disable-next-line no-shadow
enum AlwaysInPlainText {
  // eslint-disable-next-line camelcase
  X_GetEncryptSessionId = 'X_GetEncryptSessionId',
  // eslint-disable-next-line camelcase
  X_DisplayPinCode = 'X_DisplayPinCode',
  // eslint-disable-next-line camelcase
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

interface ApiCallResult {
  error?: Error;
  value?: string | string[];
}

const getKey = (key: string, xml: string): string => {
  /* eslint-disable no-restricted-syntax, no-continue, no-prototype-builtins */
  const fn = (object, k: string) => {
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
  return fn(parser.parse(xml), key);
};

class VieraTV implements VieraTV {
  readonly address: string;

  readonly port = 55000;

  readonly baseURL: string;

  readonly log: Console;

  auth: Partial<VieraAuth>;

  session: VieraAuthSession;

  specs: Partial<VieraSpecs>;

  constructor(ip: Address4, log: Console = console, auth = {}) {
    this.address = ip.address;
    this.baseURL = `http://${this.address}:${this.port}`;
    this.log = log;
    this.auth = auth;
    this.session = {
      id: -1,
      seqNum: 1,
      challenge: Buffer.alloc(0),
      key: Buffer.alloc(0),
      hmacKey: Buffer.alloc(0),
      iv: Buffer.alloc(0)
    };
    this.specs = {};
  }

  // eslint-disable-next-line class-methods-use-this
  public static async livenessProbe(
    tv: Address4,
    port = 55000,
    timeout = 2000
  ): Promise<boolean> {
    const probe = new Promise((resolve, reject) => {
      const socket = new net.Socket();

      const onError = () => {
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
    // this endpoint is only available if the TV is turned ON, otherwise we'll get a 400...
    return curl
      .get(`${this.baseURL}/pac/ddd.xml`)
      .then(() => {
        return true;
      })
      .catch(() => {
        return false;
      });
  }

  async needsCrypto(): Promise<boolean> {
    return curl
      .get(`${this.baseURL}/nrc/sdd_0.xml`)
      .then(reply => {
        if (reply.data.match(/X_GetEncryptSessionId/u)) {
          return true;
        }
        return false;
      })
      .catch(() => {
        return false;
      });
  }

  async requestSessionId(): Promise<ApiCallResult> {
    const appId = `<X_ApplicationId>${this.auth.appId}</X_ApplicationId>`;

    const outcome = this.encryptPayload(appId);
    if (outcome.error) {
      return { error: outcome.error };
    }
    const encinfo = outcome.value;
    const parameters = `<X_ApplicationId>${this.auth.appId}</X_ApplicationId> <X_EncInfo>${encinfo}</X_EncInfo>`;

    const callback = (data: string): ApiCallResult => {
      this.session.seqNum = 1;
      const number = Number(getKey('X_SessionId', data));
      if (Number.isInteger(number)) {
        this.session.id = number;
        return {};
      }
      const error = new Error(
        'abnormal result from TV - session ID is not (!) an integer'
      );
      return { error };
    };

    return this.sendRequest(
      'command',
      'X_GetEncryptSessionId',
      parameters,
      callback
    );
  }

  deriveSessionKey(key: string): [Buffer, Buffer] {
    /* eslint-disable prefer-const */
    let [i, j]: number[] = [];
    const iv = Buffer.from(key, 'base64');

    this.session.iv = iv;

    let keyVals = Buffer.alloc(16);
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

    return Buffer.concat([decipher.update(payload, 'base64'), decipher.final()])
      .toString('binary')
      .slice(16)
      .split('\0')[0];
  }

  private encryptPayload(
    original: string,
    key = this.session.key,
    iv = this.session.iv,
    hmacKey = this.session.hmacKey
  ): ApiCallResult {
    const pad = (unpadded: Buffer): Buffer => {
      const blockSize = 16;
      const extra = Buffer.alloc(blockSize - (unpadded.length % blockSize));
      return Buffer.concat([unpadded, extra]);
    };
    let ciphered: Buffer;
    let sig: Buffer;

    try {
      let data = Buffer.from(original);
      let headerPrefix = Buffer.from(
        [...new Array(12)].map(() => Math.round(Math.random() * 255))
      );

      let headerSufix = Buffer.alloc(4);
      headerSufix.writeIntBE(data.length, 0, 4);
      let header = Buffer.concat([headerPrefix, headerSufix]);
      let payload = pad(Buffer.concat([header, data]));
      let cipher = crypto
        .createCipheriv('aes-128-cbc', key, iv)
        .setAutoPadding(false);
      ciphered = Buffer.concat([cipher.update(payload), cipher.final()]);
      let hmac = crypto.createHmac('sha256', hmacKey);
      sig = hmac.update(ciphered).digest();
    } catch (Error) {
      return { error: Error };
    }
    return { value: Buffer.concat([ciphered, sig]).toString('base64') };
  }

  // Returns the TV specs
  async getSpecs() {
    return curl
      .get(`${this.baseURL}/nrc/ddd.xml`)
      .then(
        async (raw): Promise<VieraSpecs> => {
          const jsonObject = parser.parse(raw.data);
          const { device } = jsonObject.root;
          const specs = <VieraSpecs>{
            friendlyName: device.friendlyName,
            modelName: device.modelName,
            modelNumber: device.modelNumber,
            manufacturer: device.manufacturer,
            serialNumber: device.UDN.slice(5),
            requiresEncryption: await this.needsCrypto()
          };
          const extra = specs.requiresEncryption
            ? '(requires crypto for comunication)'
            : '';

          this.log.info(
            `found a '${specs.modelName}' TV (${specs.modelNumber}) at '${this.address}' ${extra}.\n`
          );
          return specs;
        }
      )
      .catch(() => {});
  }

  private renderEncryptedRequest(
    action: string,
    urn: string,
    parameters: string
  ): ApiCallResult {
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

  private renderRequest(action: string, urn: string, parameters: string) {
    let [data, method, responseType]: string[] = [];
    method = 'post';
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

    return { method, headers, data, responseType };
  }

  public async sendRequest(
    requestType: RequestType,
    realAction: string,
    realParameters = 'None',
    callback?
  ): Promise<ApiCallResult> {
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
    // let payload: ApiCallResult;
    const payload = await curl(
      `${this.baseURL}${urL}`,
      postRequest as AxiosRequestConfig
    )
      .then(r => {
        let output: ApiCallResult;
        if (
          action === 'X_GetEncryptSessionId' ||
          action === 'X_EncryptedCommand'
        ) {
          output = {
            // TODO: add error handling to getKey
            value: this.decryptPayload(getKey('X_EncResult', r.data))
          };
        } else {
          output = { value: r.data };
        }
        return output;
      })
      .catch(error => {
        return { error: new Error(error) } as ApiCallResult;
      });

    if (payload.error) {
      return payload;
    }
    if (callback) {
      return callback(payload.value);
    }
    return payload;
  }

  private async requestPinCode() {
    const parameters = '<X_DeviceName>MyRemote</X_DeviceName>';
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const callback = (data: string): ApiCallResult => {
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
    return this.sendRequest(
      'command',
      'X_DisplayPinCode',
      parameters,
      callback
    );
  }

  private async authorizePinCode(pin: string) {
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

    const callback = (r: string): ApiCallResult => {
      const raw = getKey('X_AuthResult', r);
      const authResultDecrypted = this.decryptPayload(raw, key, iv);
      this.auth.appId = getKey('X_ApplicationId', authResultDecrypted);
      this.auth.key = getKey('X_Keyword', authResultDecrypted);
      // TODO: Proper error handling
      return {};
    };
    return this.sendRequest('command', 'X_RequestAuth', parameters, callback);
  }

  private renderSampleConfig() {
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
      // eslint-disable-next-line quotes
      "\nPlease add, as a starting point, the snippet bellow inside the 'platforms' array of your homebridge's 'config.json'\n--x--"
    );

    console.group();
    console.log(JSON.stringify(sample, undefined, 4));
    console.groupEnd();
    console.log('--x--');
  }

  public static async webSetup() {
    const server = http.createServer(async (request, response) => {
      let tv: VieraTV;
      const urlObject = url.parse(request.url!, true, false);
      let returnCode = 200;
      let body = `
      <html>
        <body></body>
      </html>`;

      if (urlObject.query.pin) {
        if (urlObject.query.tv) {
          const ip = urlObject.query.tv;
          const { pin } = urlObject.query;
          console.log(urlObject);
          const address = new Address4(ip as string);

          if (
            address.isValid() === true &&
            (await VieraTV.livenessProbe(address)) === true
          ) {
            tv = new VieraTV(address);
            const specs = await tv.getSpecs();
            if (specs !== undefined) {
              if (specs.requiresEncryption === true) {
                if (urlObject.query.challenge) {
                  tv.session.challenge = Buffer.from(
                    urlObject.query.challenge as string,
                    'base64'
                  );
                  const result = await tv.authorizePinCode(pin as string);
                  if (result.error) {
                    returnCode = 500;
                    body = `
                    <html>
                      <body>
                        Wrong Pin code...
                      </body>
                    </html>`;
                  } else {
                    body = `
                    <html>
                      <body>
                        Paired with your TV sucessfully!.<br />
                        <b>Encryption Key</b>: ${tv!.auth.key}<br />
                        <b>AppId</b>: ${tv!.auth.appId}<br />
                      </body>
                    </html>`;
                  }
                }
              }
            }
          }
        }
      } else if (urlObject.query.ip) {
        const { ip } = urlObject.query;
        const address = new Address4(ip as string);

        if (address.isValid() !== true) {
          returnCode = 500;
          body = `
          <html>
            <body>
              the supplied TV ip address ('${ip}') is NOT a valid IPv4 address...
            </body>
          </html>`;
        } else if ((await VieraTV.livenessProbe(address)) === false) {
          body = `
          <html>
            <body>
              the supplied TV ip address '${ip}' is unreachable...
            </body>
          </html>`;
        } else {
          tv = new VieraTV(address);
          const specs = await tv.getSpecs();
          if (specs === undefined) {
            returnCode = 500;
            body = `
            <html>
              <body>
                An unexpected error occurred - Unable to fetch specs from the
                TV(with ip address ${ip}) .
              </body>
            </html>`;
          } else if (specs.requiresEncryption === false) {
            returnCode = 500;
            body = `
              <html>
                <body>
                  Found a <b>${specs.modelNumber}</b> on ip address ${ip}! It's just that this specific model does not
                  require encryption!'
                </body>
              </html>
            `;
          } else if (!(await tv.isTurnedOn())) {
            returnCode = 500;
            body = `
              <html>
                <body>
                  Found a <b>${specs.modelNumber}</b>, on ip address ${ip}, which requires
                  encryption; Unfortunatelly the TV seems to be in standby. <b>Please
                  turn it ON</b> and try again ...
                </body>
              </html>
            `;
          } else {
            const newRequest = await tv.requestPinCode();
            if (newRequest.error) {
              returnCode = 500;
              body = `
                <html>
                  <body>
                    Found a <b>${specs.modelNumber}</b>, on ip address ${ip}, which requires encryption;
                    <br />
                    Sadly An unexpected error ocurred while attempting to request a
                    pin code from the TV. Please make sure that the TV is
                    powered ON (and NOT in standby)
                  </body>
                </html>`;
            } else {
              body = `
                <html>
                  <body>
                    ip ${ip} found - '${specs.modelNumber}' and it requires
                    encryption;
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
                  </body>
                </html>
              `;
            }
          }
        }
      } else {
        body = `
          <html>
            <body>
              <form action="/">
                <label for="ip">
                  Please enter your Panasonic™ Viera™ (2018 or later model) IP address:
                </label>
                <br />
                <input type="text" id="ip" name="ip" /><input type="submit" value="Submit" />
              </form>
            </body>
          </html>`;
      }

      response.writeHead(returnCode, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.write(body);
      response.end();
    });

    server.on('clientError', (error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      console.log(error);
    });
    server.listen(8973);
  }

  public static async setup(target: string): Promise<void> {
    const ip = new Address4(target);
    if (ip.isValid() !== true) {
      console.error('Please introduce a valid ip address!');
      process.exitCode = 1;
      return;
    }
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
          '\nAn unexpected error ocurred while attempting to request a pin code from the TV.',
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

  // Sends a command to the TV
  public async sendCommand(cmd: string): Promise<ApiCallResult> {
    const parameters = `<X_KeyEvent>NRC_${cmd.toUpperCase()}-ONOFF</X_KeyEvent>`;

    return this.sendRequest('command', 'X_SendKey', parameters);
  }

  // Send a change HDMI input to the TV
  public async sendHDMICommand(hdmiInput: string): Promise<ApiCallResult> {
    const parameters = `<X_KeyEvent>NRC_HDMI${hdmiInput}-ONOFF</X_KeyEvent>`;

    return this.sendRequest('command', 'X_SendKey', parameters);
  }

  // Send command to open app on the TV
  public async sendAppCommand(appId: string): Promise<ApiCallResult> {
    const cmd =
      `${appId}`.length === 16 ? `product_id=${appId}` : `resource_id=${appId}`;
    const parameters = `<X_AppType>vc_app</X_AppType><X_LaunchKeyword>${cmd}</X_LaunchKeyword>`;

    return this.sendRequest('command', 'X_LaunchApp', parameters);
  }

  // Get volume from TV
  public async getVolume(): Promise<ApiCallResult> {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const callback = (data: string) => {
      const match = /<CurrentVolume>(\d*)<\/CurrentVolume>/gmu.exec(data);
      if (match) {
        return { value: match[1] };
      }
      return { value: '0' };
    };
    const parameters = defaultAudioChannel;

    return this.sendRequest('render', 'GetVolume', parameters, callback);
  }

  // Set Volume
  public async setVolume(volume: string): Promise<ApiCallResult> {
    const parameters = `${defaultAudioChannel}<DesiredVolume>${volume}</DesiredVolume>`;
    return this.sendRequest('render', 'SetVolume', parameters);
  }

  // Get the current mute setting
  public async getMute(): Promise<ApiCallResult> {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const callback = (data: string) => {
      const regex = /<CurrentMute>([0-1])<\/CurrentMute>/gmu;
      const match = regex.exec(data);
      if (match) {
        // eslint-disable-next-line no-constant-condition
        return { value: true ? match[1] === '1' : false };
      }
      return { value: true };
    };

    return this.sendRequest('render', 'GetMute', defaultAudioChannel, callback);
  }

  // Set mute to on/off
  public async setMute(enable: boolean): Promise<ApiCallResult> {
    const mute = enable ? '1' : '0';
    const parameters = `${defaultAudioChannel}<DesiredMute>${mute}</DesiredMute>`;

    return this.sendRequest('render', 'SetMute', parameters);
  }

  // Returns the list of apps on the TV
  public async getApps(): Promise<ApiCallResult> {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const callback = (data: string) => {
      const raw = getKey('X_AppList', data);
      const decoded = decodeXML(raw);
      const re = /'product_id=(?<id>(\d|[A-Z])+)'(?<appName>([^'])+)/gmu;
      let i;
      let apps: { name: string; id: string }[] = [];
      // eslint-disable-next-line no-cond-assign
      while ((i = re.exec(decoded))) {
        apps.push({ name: i.groups.appName, id: i.groups.id });
      }
      if (apps.length === 0) {
        return { error: new Error('The TV is in standby!') };
      }
      return { value: apps };
    };
    return this.sendRequest('command', 'X_GetAppList', undefined, callback);
  }
}

export default VieraTV;
