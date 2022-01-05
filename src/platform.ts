import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service
} from 'homebridge'

import { UserConfig, VieramaticPlatformAccessory } from './accessory'
import { Abnormal, Outcome, isEmpty, isValidMACAddress, isValidIPv4, dupeChecker } from './helpers'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings'
import Storage from './storage'
import { VieraAuth, VieraSpecs, VieraTV } from './viera'

class VieramaticPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service

  readonly Characteristic: typeof Characteristic

  readonly accessories: PlatformAccessory[] = []

  readonly storage: Storage

  constructor(
    readonly log: Logger,
    private readonly config: PlatformConfig,
    private readonly api: API
  ) {
    this.storage = new Storage(api)
    this.Characteristic = this.api.hap.Characteristic
    this.Service = this.api.hap.Service

    this.log.debug('Finished initializing platform:', this.config.platform)

    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback')
      await this.discoverDevices()
    })
  }

  configureAccessory = (accessory: PlatformAccessory): void => {
    this.log.info('Loading accessory from cache:', accessory.displayName)
    this.accessories.push(accessory)
  }

  discoverDevices = async (): Promise<void> => {
    this.accessories.map((cachedAccessory) =>
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory])
    )

    const devices = (this.config.tvs ?? []) as UserConfig[]

    const sanityCheck = dupeChecker(devices)
    if (Abnormal(sanityCheck)) {
      this.log.error('Aborted loading as a fatal error was found.')
      this.log.error(
        'Attempting to setup more than a single TV with same IP address: ',
        sanityCheck.error.message
      )
      this.log.error('please fix your config and then restart homebridge again!')
      return
    }

    for (const device of devices) {
      const outcome = await this.#deviceSetup(device)
      if (Abnormal(outcome)) {
        this.log.error(outcome.error.message)
        continue
      }

      this.api.publishExternalAccessories(PLUGIN_NAME, [outcome.value.accessory])
      this.log.info('successfully loaded', outcome.value.accessory.displayName)
    }
  }

  #deviceSetupPreFlight = (device: UserConfig): Outcome<void> => {
    const raw = JSON.stringify(device, undefined, 2)
    const invalid = (type: string): Error =>
      Error(`IGNORED '${device.ipAddress}' as it has an invalid ${type} address.\n\n${raw}`)

    if (!isValidIPv4(device.ipAddress)) return { error: invalid('ip') }

    const { mac } = device
    if (mac && !isValidMACAddress(mac)) return { error: invalid('MAC') }

    return {}
  }

  #knownWorking = (ip: string): VieraSpecs => {
    if (isEmpty(this.storage.accessories)) return {}

    for (const [_, v] of Object.entries(this.storage.accessories))
      if (v.data.ipAddress === ip) return v.data.specs

    return {}
  }

  #deviceSetup = async (device: UserConfig): Promise<Outcome<VieramaticPlatformAccessory>> => {
    this.log.info("handling '%s' from config.json", device.ipAddress)

    const [ip, outcome] = [device.ipAddress, this.#deviceSetupPreFlight(device)]

    if (Abnormal(outcome)) return outcome

    const [reachable, cached] = [await VieraTV.livenessProbe(ip), this.#knownWorking(ip)]

    if (!reachable && isEmpty(cached)) {
      const error = Error(
        `IGNORING '${ip}' as it is not reachable.\n` +
          "(As we can't rely on cached data since it seems that it was never ever seen and " +
          'fully setup before)\n\n' +
          'Please make sure that your TV is powered ON and connected to the network.'
      )

      return { error }
    }

    const creds: { auth?: VieraAuth; mac?: string; cached: VieraSpecs } = {
      cached,
      mac: device.mac
    }
    if (device.appId && device.encKey) creds.auth = { appId: device.appId, key: device.encKey }

    const conn = await VieraTV.connect(ip, this.log, creds)
    if (Abnormal(conn)) return conn
    const tv = conn.value

    tv.specs.friendlyName = device.friendlyName ?? tv.specs.friendlyName
    const accessory = new this.api.platformAccessory(
      tv.specs.friendlyName,
      tv.specs.serialNumber,
      this.api.hap.Categories.TELEVISION
    )

    accessory.context.device = tv

    const accessories = this.storage.accessories
    const firstTime = isEmpty(accessories) || !accessories[tv.specs.serialNumber]

    if (firstTime) this.log.info(`Initializing '${tv.specs.friendlyName}' first time ever.`)

    if (!device.disabledAppSupport && Abnormal(tv.apps)) {
      const err = `Unable to fetch Apps list from the TV: ${tv.apps.error.message}.`
      const ft = `Unable to finish initial setup of ${tv.specs.friendlyName}. ${err}. This TV must be powered ON and NOT in stand-by.`
      if (firstTime) return { error: Error(ft) }
      this.log.debug(err)
    }

    return { value: new VieramaticPlatformAccessory(this, accessory, device) }
  }
}

export default VieramaticPlatform
