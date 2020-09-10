import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service
  // eslint-disable-next-line import/no-extraneous-dependencies
} from 'homebridge';
import { Address4 } from 'ip-address';

// eslint-disable-next-line import/no-cycle
import { sleep, VieramaticPlatformAccessory } from './accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import Storage from './storage';
import VieraTV from './viera';

class VieramaticPlatform implements DynamicPlatformPlugin {
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
    const devices = this.config.tvs;

    devices.forEach(async (device) => {
      await this.deviceSetup(device);
    });
  }

  private async deviceSetup(device): Promise<void> {
    this.log.info('handling', device.ipAddress, 'from config.json');

    const ip = new Address4(device.ipAddress);

    if (ip.isValid() !== true) {
      this.log.error(
        `IGNORING '${ip.address}' as it is not a valid ip address.`
      );
      this.log.error(device);
      return;
    }

    if ((await VieraTV.livenessProbe(ip)) === false) {
      this.log.error(`IGNORING '${ip.address}' as it is not reachable.`);
      this.log.error(
        'Please make sure that your TV is powered ON and connected to the network.'
      );
      return;
    }
    const tv = new VieraTV(ip);
    const specs = await tv.getSpecs();

    if (specs === undefined) {
      this.log.error(
        `IGNORING '${ip.address}' as an unexpected error occurred - was unable to fetch specs from the TV.`
      );
      return;
    }
    tv.specs = specs;
    if (tv.specs.requiresEncryption === true) {
      if (!(device.appId && device.encKey)) {
        this.log.error(
          `IGNORING '${ip.address}' as it is from a Panasonic TV that requires encryption
           '${tv.specs.modelName}' and no valid credentials were supplied.`
        );
        return;
      }
      [tv.auth.appId, tv.auth.key] = [device.appId, device.encKey];
      [tv.session.key, tv.session.hmacKey] = tv.deriveSessionKey(tv.auth.key!);
      const result = await tv.requestSessionId();
      if (result.error) {
        this.log.error(
          `IGNORING '${ip.address}' ('${tv.specs.modelName}') as no working credentials were supplied.`,
          result.error
        );
        return;
      }
    }
    // eslint-disable-next-line new-cap
    const accessory = new this.api.platformAccessory(
      tv.specs.friendlyName,
      tv.specs.serialNumber
    );
    accessory.category = this.api.hap.Categories.TELEVISION;
    accessory.context.device = tv;

    const status = await tv.isTurnedOn();
    if (status !== true) {
      this.log.info(
        'TV was OFF; turning it ON for a bit in order to fetch its built-in app list'
      );
      await tv.sendCommand('POWER');
      await sleep(2000);
    }
    const cmd = await tv.getApps();
    if (status !== true) {
      await sleep(500);
      await tv.sendCommand('POWER');
      this.log.info('turning TV OFF again');
    }
    if (cmd.error) {
      this.log.error('unable to fetch Apps list from the TV', cmd);
      return;
    }
    const apps = cmd.value || [];

    // eslint-disable-next-line no-new
    new VieramaticPlatformAccessory(this, accessory, device, apps);
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);

    this.log.info('successfully loaded', accessory.displayName);
  }
}

export default VieramaticPlatform;
