import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service
} from 'homebridge'

// @ts-expect-error noImplicityAny...
import { isValidMACAddress } from '@mi-sec/mac-address'
import { Address4 } from 'ip-address'

import { UserConfig, VieramaticPlatformAccessory } from './accessory'
import { Abnormal, Outcome, isEmpty, printf } from './helpers'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings'
import Storage from './storage'
import { VieraApps, VieraSpecs, VieraTV } from './viera'

class VieramaticPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service

  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic

  public readonly accessories: PlatformAccessory[] = []

  public readonly storage: Storage

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.storage = new Storage(api)

    this.log.debug('Finished initializing platform:', this.config.platform)

    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback')
      await this.discoverDevices()
    })
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName)
    this.accessories.push(accessory)
  }

  async discoverDevices(): Promise<void> {
    this.accessories.map((cachedAccessory) =>
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory])
    )

    this.storage.init()
    VieraTV.webSetup(this).catch((error) => this.log.error(error))
    const devices = this.config.tvs as UserConfig[]

    devices.forEach(async (device: UserConfig) => {
      const outcome = await this.deviceSetup(device)
      if (Abnormal(outcome)) {
        this.log.error(outcome.error.message)
        return
      }

      this.api.publishExternalAccessories(PLUGIN_NAME, [outcome.value.accessory])

      this.log.info('successfully loaded', outcome.value.accessory.displayName)
    })
  }

  deviceSetupPreFlight = (device: UserConfig): Outcome<Address4> => {
    const raw = JSON.stringify(device, undefined, 2)
    if (!Address4.isValid(device.ipAddress)) {
      const msg = printf(
        "IGNORING '%s' as it is not a valid ip address.\n\n%s",
        device.ipAddress,
        raw
      )
      return { error: Error(msg) }
    }
    const { mac } = device
    if (mac != null && isValidMACAddress(mac) === false) {
      const msg = printf(
        "IGNORING '%s' as it has an invalid MAC address: '%s'\n\n%s",
        device.ipAddress,
        mac,
        raw
      )
      return { error: Error(msg) }
    }
    return { value: new Address4(device.ipAddress) }
  }

  private knownWorking(ip: Address4): VieraSpecs {
    if (this.storage.accessories === null) return {}

    for (const [_, v] of Object.entries(this.storage.accessories))
      if (v.data.ipAddress === ip.address) return v.data.specs

    return {}
  }

  private async deviceSetup(device: UserConfig): Promise<Outcome<VieramaticPlatformAccessory>> {
    this.log.info("handling '%s' from config.json", device.ipAddress)
    const outcome = this.deviceSetupPreFlight(device)

    if (Abnormal(outcome)) return outcome

    const ip = outcome.value
    const cached = this.knownWorking(ip)
    const reachable = await VieraTV.livenessProbe(ip)

    if (!(reachable || cached != null)) {
      const msg = printf(
        "IGNORING '%s' as it is not reachable, and we can't relay on cached data",
        ip.address,
        'as it seems that it was never ever seen and setup before.\n\n',
        'Please make sure that your TV is powered ON and connected to the network.'
      )
      return { error: Error(msg) }
    }

    const tv = new VieraTV(ip, this.log, device.mac)
    const specs = await tv.getSpecs()

    if (isEmpty(specs)) {
      this.log.warn(
        "WARNING: unable to fetch specs from TV at '%s'. Using the previously cached ones: \n\n%s",
        ip.address,
        cached
      )
      if (cached?.requiresEncryption) {
        const msg = printf(
          "IGNORING '%s' as we do not support offline initialization, ",
          ip.address,
          'from cache, for models that require encryption.'
        )
        return { error: Error(msg) }
      }
    }
    tv.specs = isEmpty(specs) ? cached : specs
    if (tv.specs.requiresEncryption) {
      if (!(device.appId != null && device.encKey != null)) {
        const msg = printf(
          "IGNORING '%s' as it is from a Panasonic TV that requires",
          ip.address,
          "encryption '%s' and no valid credentials were supplied.",
          tv.specs.modelName
        )
        return { error: Error(msg) }
      }

      tv.auth.appId = device.appId
      tv.auth.key = device.encKey
      tv.deriveSessionKey(tv.auth.key)

      const result = await tv.requestSessionId()

      if (Abnormal(result)) {
        const msg = printf(
          "IGNORING '%s' ('%s') as no working credentials were supplied.\n\n",
          ip.address,
          tv.specs.modelName,
          result.error.message
        )
        return { error: Error(msg) }
      }
    }
    tv.specs.friendlyName = device.friendlyName ?? tv.specs.friendlyName
    /* eslint-disable-next-line new-cap */
    const accessory = new this.api.platformAccessory(
      tv.specs.friendlyName,
      tv.specs.serialNumber,
      this.api.hap.Categories.TELEVISION
    )

    accessory.context.device = tv
    let apps: VieraApps = []
    if (
      this.storage.accessories === null ||
      this.storage.accessories[`${tv.specs.serialNumber}`] === undefined
    ) {
      this.log.info("Initializing '%s' first time ever.", tv.specs.friendlyName)
      const status = await tv.isTurnedOn()
      if (!status) {
        const msg = printf(
          'Unable to finish initial setup of %s.\n\n',
          tv.specs.friendlyName,
          'Please make sure that this TV is powered ON and NOT in stand-by.'
        )
        return { error: Error(msg) }
      }
      if (device.disabledAppSupport == null || !device.disabledAppSupport) {
        const cmd = await tv.getApps()

        if (Abnormal(cmd)) {
          const msg = printf('unable to fetch Apps list from the TV:\n\n', cmd.error.message)
          return { error: Error(msg) }
        }

        apps = cmd.value
      }
    }

    return {
      value: new VieramaticPlatformAccessory(this, accessory, device, apps)
    }
  }
}

export default VieramaticPlatform
