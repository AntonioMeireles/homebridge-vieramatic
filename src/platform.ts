import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service
} from 'homebridge';
import { Address4 } from 'ip-address';

/* eslint-disable-next-line import/no-cycle */
import { UserConfig, VieramaticPlatformAccessory } from './accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Storage } from './storage';
import { VieraApps, VieraTV } from './viera';

export class VieramaticPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;

  public readonly Characteristic: typeof Characteristic = this.api.hap
    .Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  public storage: Storage;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.storage = new Storage(api);

    this.log.debug('Finished initializing platform:', this.config.platform);

    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      await this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices(): Promise<void> {
    this.accessories.map((cachedAccessory) => {
      return this.api.unregisterPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        [cachedAccessory]
      );
    });

    this.storage.init();
    VieraTV.webSetup();
    const devices = this.config.tvs as UserConfig[];

    devices.forEach(async (device: UserConfig) => {
      await this.deviceSetup(device);
    });
  }

  private async deviceSetup(device: UserConfig): Promise<void> {
    this.log.info('handling', device.ipAddress, 'from config.json');

    if (Address4.isValid(device.ipAddress) !== true) {
      this.log.error(
        "IGNORING '%s' as it is not a valid ip address.",
        device.ipAddress
      );
      this.log.error(JSON.stringify(device, undefined, 2));
      return;
    }
    const ip = new Address4(device.ipAddress);

    if ((await VieraTV.livenessProbe(ip)) === false) {
      this.log.error("IGNORING '%s' as it is not reachable.", ip.address);
      this.log.error(
        'Please make sure that your TV is powered ON and connected to the network.'
      );
      return;
    }
    const tv = new VieraTV(ip);
    const specs = await tv.getSpecs();

    if (specs === undefined) {
      this.log.error(
        "IGNORING '%s' as an unexpected error occurred - was unable to fetch specs from the TV.",
        ip.address
      );
      return;
    }
    tv.specs = specs;
    if (tv.specs.requiresEncryption === true) {
      if (!(device.appId && device.encKey)) {
        this.log.error(
          "IGNORING '%s' as it is from a Panasonic TV that requires encryption '%s'",
          ip.address,
          tv.specs.modelName,
          'and no valid credentials were supplied.'
        );
        return;
      }
      [tv.auth.appId, tv.auth.key] = [device.appId, device.encKey];
      [tv.session.key, tv.session.hmacKey] = tv.deriveSessionKey(tv.auth.key);
      const result = await tv.requestSessionId();
      if (result.error) {
        this.log.error(
          "IGNORING '%s' ('%s') as no working credentials were supplied.",
          ip.address,
          tv.specs.modelName,
          result.error
        );
        return;
      }
    }
    /* eslint-disable-next-line new-cap */
    const accessory = new this.api.platformAccessory<Record<string, VieraTV>>(
      tv.specs.friendlyName,
      tv.specs.serialNumber
    );
    accessory.category = this.api.hap.Categories.TELEVISION;
    accessory.context.device = tv;
    let apps: VieraApps = [];
    if (
      this.storage.accessories === null ||
      this.storage.accessories[`${tv.specs.serialNumber}`] === undefined
    ) {
      this.log.info(
        'Initializing',
        tv.specs.friendlyName,
        'for the first time. [I]'
      );
      const status = await tv.isTurnedOn();
      if (status !== true) {
        this.log.error(
          'Unable to finish initial setup of',
          tv.specs.friendlyName,
          '. Please make sure that this TV is powered ON and NOT in stand-by.'
        );
        return;
      }
      const cmd = await tv.getApps<VieraApps>();
      if (cmd.error) {
        this.log.error('unable to fetch Apps list from the TV', cmd);
        return;
      }
      if (cmd.value) {
        apps = cmd.value;
      }
    }

    /* eslint-disable-next-line no-new */
    new VieramaticPlatformAccessory(this, accessory, device, apps);
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);

    this.log.info('successfully loaded', accessory.displayName);
  }
}
