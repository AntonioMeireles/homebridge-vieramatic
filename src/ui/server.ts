import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils'

import { Abnormal, Outcome } from '../helpers'
import { vieraFinder } from '../networkUtils'
import { VieraAuth, VieraSpecs, VieraTV } from '../viera'

const enum UIServerRequestErrorType {
  DiscoveryFailed,
  NotConnectable,
  AuthFailed,
  PinChallengeError,
  WrongPin
}

interface UIServerRequestError {
  message: string
  error: UIServerRequestErrorType
}

class VieramaticUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()

    this.onRequest('/discover', this.handleDiscovery.bind(this))
    this.onRequest('/ping', this.handleLivenessProbe.bind(this))
    this.onRequest('/specs', this.handleSpecs.bind(this))
    this.onRequest('/pin', this.handlePin.bind(this))
    this.onRequest('/pair', this.handlePairing.bind(this))

    this.ready()
  }

  async handleLivenessProbe(ip: string): Promise<boolean> {
    const reachable = await VieraTV.isTurnedOn(ip)
    console.log('---> (ping)', ip, reachable)
    return reachable
  }

  async handlePin(ip: string): Promise<string> {
    console.log('---> (pin request)', ip)
    const probe = await VieraTV.probe(ip)
    if (Abnormal(probe))
      throw new RequestError(probe.error.message, UIServerRequestErrorType.NotConnectable)
    const tv = probe.value
    let challenge: Outcome<string>
    if (Abnormal((challenge = await tv.requestPinCode())))
      throw new RequestError(challenge.error.message, UIServerRequestErrorType.PinChallengeError)
    return challenge.value
  }

  async handlePairing(payload: { ip: string; pin: string; challenge: string }) {
    console.log('---> (pairing request)', payload.ip, payload.pin, payload.challenge)
    const probe = await VieraTV.probe(payload.ip)
    if (Abnormal(probe))
      throw new RequestError(probe.error.message, UIServerRequestErrorType.NotConnectable)
    const tv = probe.value

    const auth = await tv.authorizePinCode(payload.pin, payload.challenge)
    console.log('---> (pair)', auth)
    if (Abnormal(auth))
      throw new RequestError(auth.error.message, UIServerRequestErrorType.WrongPin)

    return auth.value
  }

  async handleDiscovery(): Promise<string[]> {
    const found = await vieraFinder()
    if (Abnormal(found))
      throw new RequestError(found.error.message, UIServerRequestErrorType.DiscoveryFailed)
    return found.value
  }

  async handleSpecs(payload: string): Promise<VieraSpecs> {
    const tv = JSON.parse(payload)
    console.log('---> (specs)', tv.ipAddress)
    const probe = await VieraTV.probe(tv.ipAddress)
    if (Abnormal(probe))
      throw new RequestError(probe.error.message, UIServerRequestErrorType.NotConnectable)
    else if (probe.value.specs.requiresEncryption) {
      if (tv.encKey && tv.appId) {
        const auth: VieraAuth = { appId: tv.appId, key: tv.encKey }
        const validate = await VieraTV.connect(tv.ipAddress, console, { auth })
        if (Abnormal(validate))
          throw new RequestError(validate.error.message, UIServerRequestErrorType.AuthFailed)
      } else throw new RequestError('no crendentials supplied', UIServerRequestErrorType.AuthFailed)
    }

    return probe.value.specs
  }
}

void (() => new VieramaticUiServer())()

export { UIServerRequestError, UIServerRequestErrorType }
