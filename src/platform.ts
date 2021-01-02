import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service
} from 'homebridge';

import { isValidMACAddress } from '@mi-sec/mac-address';
import { Address4 } from 'ip-address';

/* eslint-disable-next-line import/no-cycle */
import { UserConfig, VieramaticPlatformAccessory } from './accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Storage } from './storage';
import { Outcome, VieraApps, VieraTV } from './viera';

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

  deviceSetupPreFlight = (device: UserConfig): Outcome<Address4> => {
    if (Address4.isValid(device.ipAddress) !== true) {
      return {
        error: `IGNORING '${device.ipAddress}' as it is not a valid ip address.
        \n\n${JSON.stringify(device, undefined, 2)}`
      };
    }
    const { mac } = device;
    if (mac && isValidMACAddress(mac) === false) {
      return {
        error: `IGNORING '${device.ipAddress}' as it has an invalid MAC address:
        '${device.mac}'\n\n${JSON.stringify(device, undefined, 2)}`
      };
    }
    return { value: new Address4(device.ipAddress) };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private knownWorking(ip: Address4): any {
    if (this.storage.accessories === null) {
      return;
    }
    // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-unused-vars, @typescript-eslint/naming-convention
    for (const [_k, v] of Object.entries(this.storage.accessories)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((v as any).data.ipAddress === ip.address) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, consistent-return
        return (v as any).data.specs;
      }
    }
  }

  private async deviceSetup(device: UserConfig): Promise<void> {
    this.log.info('handling', device.ipAddress, 'from config.json');
    const outcome = this.deviceSetupPreFlight(device);
    if (outcome.error) {
      this.log.error(outcome.error as string);
      return;
    }

    const ip = outcome.value as Address4;
    const cached = this.knownWorking(ip);
    const reachable = await VieraTV.livenessProbe(ip);

    if (!(reachable || cached)) {
      this.log.error(
        "IGNORING '%s' as it is not reachable, and we can't relay on cached data",
        ip.address,
        'as it seems that it was never ever seen and setup before.',
        'Please make sure that your TV is powered ON and connected to the network.'
      );
      return;
    }

    const tv = new VieraTV(ip, device.mac);
    const specs = await tv.getSpecs();

    if (!specs) {
      this.log.warn(`WARNING: unable to fetch specs from TV at '${ip.address}`);
      if (cached && cached.requiresEncryption === true) {
        this.log.error(
          "IGNORING '%s' as we do not support offline initialization, from cache,",
          ip.address,
          'for models that require encryption.'
        );
        return;
      }
    }
    tv.specs = specs ?? cached;
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
          "IGNORING '%s' ('%s') as no working credentials were supplied.\n\n",
          ip.address,
          tv.specs.modelName,
          result.error
        );
        return;
      }
    }
    tv.specs.friendlyName = device.friendlyName ?? tv.specs.friendlyName;
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
      this.log.info(`Initializing '${tv.specs.friendlyName}' first time ever.`);
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
