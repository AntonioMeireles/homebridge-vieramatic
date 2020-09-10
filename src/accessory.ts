import {
  CharacteristicGetCallback,
  // CharacteristicChange,
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service
  // eslint-disable-next-line import/no-extraneous-dependencies
} from 'homebridge';

// eslint-disable-next-line import/no-cycle
import VieramaticPlatform from './platform';
import { Outcome } from './viera';

// helpers ...
const displayName = (string: string): string => {
  return string.toLowerCase().replace(/\s+/gu, '');
};

export function sleep(ms: number): Promise<unknown> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
type InputType = 'HDMI' | 'APPLICATION' | 'TUNER';

export class VieramaticPlatformAccessory {
  private service: Service;

  private storage;

  constructor(
    private readonly platform: VieramaticPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly userConfig,
    private readonly tvApps
  ) {
    const handler = {
      get(target, key): unknown {
        if (key === 'isProxy') {
          return true;
        }
        const property = target[key];
        if (typeof property === 'undefined') {
          // eslint-disable-next-line consistent-return
          return;
        }
        if (!property.isProxy && typeof property === 'object') {
          // eslint-disable-next-line no-param-reassign
          target[key] = new Proxy(property, handler);
        }
        return target[key];
      },
      set: (target, key, value): boolean => {
        // eslint-disable-next-line no-param-reassign
        target[key] = value;
        this.platform.storage.save();
        return true;
      }
    };

    this.platform.log.debug(this.userConfig);
    const { device } = this.accessory.context;
    this.storage = new Proxy(
      this.platform.storage.get(device.specs.serialNumber!),
      handler
    );

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        device.specs.manufacturer
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        `${device.specs.modelName} ${device.specs.modelNumber}`
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        device.specs.serialNumber
      );

    this.accessory.on('identify', () => {
      this.platform.log.info(accessory.displayName, 'Identify!!!');
    });

    this.service = this.accessory.addService(this.platform.Service.Television);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      device.specs.friendlyName
    );

    this.service
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        device.specs.friendlyName
      )
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
      );

    this.service.addCharacteristic(
      this.platform.Characteristic.PowerModeSelection
    );

    this.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .on('set', this.setPowerStatus.bind(this))
      .on('get', this.getPowerStatus.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.RemoteKey)
      .on('set', this.remoteControl.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .on('set', this.setInput.bind(this));

    const speakerService = this.accessory.addService(
      this.platform.Service.TelevisionSpeaker,
      `${device.specs.friendlyName} Volume`,
      'volumeService'
    );

    speakerService.addCharacteristic(this.platform.Characteristic.Volume);
    speakerService.addCharacteristic(this.platform.Characteristic.Active);
    speakerService.setCharacteristic(
      this.platform.Characteristic.VolumeControlType,
      this.platform.Characteristic.VolumeControlType.ABSOLUTE
    );
    this.service.addLinkedService(speakerService);

    speakerService
      .getCharacteristic(this.platform.Characteristic.Mute)
      .on('get', this.getMute.bind(this))
      .on('set', this.setMute.bind(this));
    speakerService
      .getCharacteristic(this.platform.Characteristic.Volume)
      .on('get', this.getVolume.bind(this))
      .on('set', this.setVolume.bind(this));
    speakerService
      .getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .on('set', this.setVolumeSelector.bind(this));

    if (this.userConfig.customVolumeSlider === true) {
      const customSpeakerService = this.accessory.addService(
        this.platform.Service.Fan,
        `${device.specs.modelNumber} Volume`,
        'VolumeAsFanService'
      );
      this.service.addLinkedService(customSpeakerService);

      customSpeakerService
        .getCharacteristic(this.platform.Characteristic.On)
        .on('get', (callback: CharacteristicGetCallback) => {
          const { value } = this.service.getCharacteristic(
            this.platform.Characteristic.Active
          );
          this.platform.log.debug('(customSpeakerService/On.get)', value);
          return callback(undefined, value);
        })
        .on(
          'set',
          (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            this.platform.log.debug('(customSpeakerService/On.set)', value);
            switch (
              this.service.getCharacteristic(
                this.platform.Characteristic.Active
              ).value
            ) {
              case this.platform.Characteristic.Active.INACTIVE:
                return callback(undefined, false);
              default:
                return callback(undefined, !value);
            }
          }
        );

      customSpeakerService
        .getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));
    }

    setInterval(() => {
      this.getPowerStatus();
    }, 5000);

    this.userConfig.hdmiInputs ||= [];

    if (!this.storage.data) {
      this.platform.log.info(
        `Initializing ${device.specs.friendlyName} for the first time.`
      );
      this.storage.data = {
        inputs: {
          hdmi: this.userConfig.hdmiInputs,
          applications: { ...this.tvApps }
        },
        specs: { ...device.specs }
      };
      // add default TUNER (live TV)... visible by default
      this.storage.data.inputs.TUNER = { hidden: 0 };
      // by default all hdmiInputs will be visible
      this.storage.data.inputs.hdmi.forEach((element) => {
        // eslint-disable-next-line no-param-reassign
        element.hidden = 0;
      });
      // by default all apps will be hidden
      Object.entries(this.storage.data.inputs.applications).forEach(
        (_element, index) => {
          this.storage.data.inputs.applications[index].hidden = 1;
        }
      );
    } else {
      this.platform.log.debug(`Restoring ${device.specs.friendlyName}.`);
      // check for new user added inputs
      userConfig.hdmiInputs.forEach((input) => {
        const fn = function isThere(element): boolean {
          return element.id === input.id && element.name === input.name;
        };
        // eslint-disable-next-line unicorn/no-fn-reference-in-iterator
        const found = this.storage.data.inputs.hdmi.findIndex(fn);
        if (found === -1) {
          this.platform.log.info(
            `adding HDMI input '${input.id}' - '${input.name}' as it was appended to config.json`
          );
          // eslint-disable-next-line no-param-reassign
          input.hidden = 0;
          this.storage.data.inputs.hdmi.push(input);
        }
      });
      // check for user removed inputs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shallow: any[] = [];
      this.storage.data.inputs.hdmi.forEach((input) => {
        const fn = function isThere(element): boolean {
          return element.id === input.id;
        };
        // eslint-disable-next-line unicorn/no-fn-reference-in-iterator
        const found = userConfig.hdmiInputs.findIndex(fn);
        if (found === -1) {
          this.platform.log.info(
            `unsetting HDMI input '${input.id}' ['${input.name}'] since it was dropped from the config.json`
          );
        } else {
          shallow.push(input);
        }
      });
      this.storage.data.inputs.hdmi = [...shallow];

      // FIXME: check also for added/removed apps (just in case)
    }

    // TV Tuner
    this.configureInputSource('TUNER', 'TV Tuner', 500);
    // HDMI inputs ...
    this.storage.data.inputs.hdmi.forEach((input) => {
      this.configureInputSource(
        'HDMI',
        input.name,
        Number.parseInt(input.id, 10)
      );
    });
    // Apps
    Object.entries(this.storage.data.inputs.applications).forEach(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (line: any) => {
        const [id, app] = line;
        this.configureInputSource(
          'APPLICATION',
          app.name,
          1000 + Number.parseInt(id, 10)
        );
      }
    );
  }

  private async setInput(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    const fn = async (): Promise<Outcome> => {
      let app;
      let real: number;

      switch (false) {
        case !(value < 100):
          this.platform.log.debug('(setInput) switching to HDMI INPUT ', value);
          return this.accessory.context.device.sendHDMICommand(value);
        case !(value > 999):
          real = (value as number) - 1000;
          app = this.storage.data.inputs.applications[real];
          this.platform.log.debug('(setInput) switching to App', app.name);
          return this.accessory.context.device.sendAppCommand(app.id);
        default:
          // case !(value === 500):
          this.platform.log.debug('(setInput) switching to internal TV tunner');
          return this.accessory.context.device.sendCommand('AD_CHANGE');
      }
      return {};
    };

    const cmd = await fn();
    if (cmd.error) {
      this.platform.log.error('setInput', value, cmd.error);
    }
    callback(undefined, value);
  }

  private configureInputSource(
    type: InputType,
    configuredName: string,
    identifier: number
  ): void {
    const fn = function isThere(element): boolean {
      return element.id === identifier.toString();
    };
    const visibility = (): string => {
      let idx: number;
      let hidden: string;
      const { inputs } = this.storage.data;

      switch (type) {
        case 'HDMI':
          // eslint-disable-next-line unicorn/no-fn-reference-in-iterator
          idx = this.storage.data.inputs.hdmi.findIndex(fn);
          hidden = inputs.hdmi[idx].hidden;
          break;
        case 'APPLICATION':
          idx = identifier - 1000;
          hidden = inputs.applications[idx].hidden;
          break;
        case 'TUNER':
        default:
          hidden = inputs.TUNER.hidden;
      }
      return hidden;
    };

    const source = this.accessory.addService(
      this.platform.Service.InputSource,
      displayName(configuredName),
      identifier
    );
    const visibilityState = (
      state: CharacteristicValue,
      callback: CharacteristicSetCallback
    ): void => {
      let idx: number;
      const id = source.getCharacteristic(
        this.platform.Characteristic.Identifier
      ).value;
      const { inputs } = this.storage.data;

      switch (false) {
        case !(id! < 100):
          // hdmi input
          // eslint-disable-next-line unicorn/no-fn-reference-in-iterator
          idx = this.storage.data.inputs.hdmi.findIndex(fn);
          inputs.hdmi[idx].hidden = state;
          break;
        case !(id! > 999):
          // APP
          idx = (id as number) - 1000;
          inputs.applications[idx].hidden = state;
          break;
        default:
          // case !(id === 500):
          inputs.TUNER.hidden = state;
          break;
      }
      source
        .getCharacteristic(this.platform.Characteristic.CurrentVisibilityState)
        .updateValue(state);
      return callback();
    };
    const hidden = visibility();

    source
      .setCharacteristic(
        this.platform.Characteristic.InputSourceType,
        this.platform.Characteristic.InputSourceType[type]
      )
      .setCharacteristic(
        this.platform.Characteristic.CurrentVisibilityState,
        hidden
      )
      .setCharacteristic(
        this.platform.Characteristic.TargetVisibilityState,
        hidden
      )
      .setCharacteristic(this.platform.Characteristic.Identifier, identifier)
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        configuredName
      )
      .setCharacteristic(
        this.platform.Characteristic.IsConfigured,
        this.platform.Characteristic.IsConfigured.CONFIGURED
      );
    source
      .getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
      .on('set', visibilityState.bind(this));

    this.accessory
      .getService(this.platform.Service.Television)!
      .addLinkedService(source);
  }

  async setPowerStatus(
    nextState: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    const message =
      nextState === this.platform.Characteristic.Active.ACTIVE
        ? 'ON'
        : 'into STANDBY';
    const currentState = await this.accessory.context.device.isTurnedOn();
    this.platform.log.debug('(setPowerStatus)', nextState, currentState);
    if (
      (nextState === this.platform.Characteristic.Active.ACTIVE) ===
      currentState
    ) {
      this.platform.log.debug('TV is already %s: Ignoring!', message);
    } else {
      const cmd = await this.accessory.context.device.sendCommand('POWER');
      if (cmd.error) {
        this.platform.log.error(
          `(setPowerStatus)/->${message} - unable to power cycle TV - probably unpowered`
        );
      } else {
        await this.updateTVstatus(nextState);
        this.platform.log.debug('Turned TV', message);
      }
    }

    callback();
  }

  async getPowerStatus(callback?: CharacteristicGetCallback): Promise<void> {
    const currentState = await this.accessory.context.device.isTurnedOn();
    await this.updateTVstatus(currentState);
    if (callback) {
      callback(undefined, currentState);
    }
  }

  async getMute(callback: CharacteristicGetCallback): Promise<void> {
    const state = await this.accessory.context.device.isTurnedOn();
    let mute: boolean;

    if (state === true) {
      const cmd = await this.accessory.context.device.getMute();

      mute = !cmd.error ? cmd.value : true;
    } else {
      mute = true;
    }
    this.platform.log.debug('(getMute) is', mute);
    callback(undefined, mute);
  }

  async setMute(state, callback: CharacteristicSetCallback): Promise<void> {
    this.platform.log.debug('(setMute) is', state);
    const cmd = await this.accessory.context.device.setMute(state);
    if (cmd.error) {
      this.platform.log.error(
        `(setMute)/(${state}) unable to change mute state on TV...`
      );
    } else {
      // eslint-disable-next-line no-param-reassign
      state = !state;
    }
    callback(undefined, state);
  }

  async setVolume(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    this.platform.log.debug('(setVolume)', value);
    const cmd = await this.accessory.context.device.setVolume(value);
    if (cmd.error) {
      this.platform.log.error(
        '(setVolume)/(%s) unable to set volume on TV...',
        value
      );
      // eslint-disable-next-line no-param-reassign
      value = 0;
    }
    callback(undefined, value);
  }

  async getVolume(callback: CharacteristicSetCallback): Promise<void> {
    const cmd = await this.accessory.context.device.getVolume();
    let volume: number;
    if (cmd.error) {
      this.platform.log.error('(getVolume) unable to get volume from TV...');
      volume = 0;
    } else {
      volume = cmd.value;
    }
    callback(undefined, volume);
  }

  async setVolumeSelector(
    key: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    this.platform.log.debug('setVolumeSelector', key);
    const action =
      key === this.platform.Characteristic.VolumeSelector.INCREMENT
        ? 'VOLUP'
        : 'VOLDOWN';
    const cmd = await this.accessory.context.device.sendCommand(action);
    if (cmd.error) {
      this.platform.log.error(
        '(setVolumeSelector) unable to change volume',
        cmd.error
      );
    }
    callback();
  }

  async updateTVstatus(newState): Promise<void> {
    let customSpeakerService;
    const tvService = this.accessory.getService(
      this.platform.Service.Television
    );
    const speakerService = this.accessory.getService(
      this.platform.Service.TelevisionSpeaker
    );

    if (this.userConfig.customVolumeSlider === true) {
      customSpeakerService = this.accessory.getService(
        this.platform.Service.Fan
      );
    }

    speakerService!
      .getCharacteristic(this.platform.Characteristic.Active)
      .updateValue(newState);
    tvService!
      .getCharacteristic(this.platform.Characteristic.Active)
      .updateValue(newState);
    if (newState === true) {
      const cmd = await this.accessory.context.device.getMute();
      if (!cmd.error) {
        if (
          cmd.value !==
          speakerService!.getCharacteristic(this.platform.Characteristic.Mute)
            .value
        ) {
          speakerService!
            .getCharacteristic(this.platform.Characteristic.Mute)
            .updateValue(cmd.value);
          if (customSpeakerService) {
            customSpeakerService
              .getCharacteristic(this.platform.Characteristic.On)
              .updateValue(!cmd.value);
          }
        }
      }
    } else {
      speakerService!
        .getCharacteristic(this.platform.Characteristic.Mute)
        .updateValue(true);

      if (customSpeakerService) {
        customSpeakerService
          .getCharacteristic(this.platform.Characteristic.On)
          .updateValue(false);
      }
    }
  }

  async remoteControl(
    keyId: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    let action: string;
    //  https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit-TV.ts#L235
    switch (keyId) {
      case 0: // Rewind
        action = 'REW';
        break;
      case 1: // Fast Forward
        action = 'FF';
        break;
      case 2: // Next Track
        action = 'SKIP_NEXT';
        break;
      case 3: // Previous Track
        action = 'SKIP_PREV';
        break;
      case 4: // Up Arrow
        action = 'UP';
        break;
      case 5: // Down Arrow
        action = 'DOWN';
        break;
      case 6: // Left Arrow
        action = 'LEFT';
        break;
      case 7: // Right Arrow
        action = 'RIGHT';
        break;
      case 8: // Select
        action = 'ENTER';
        break;
      case 9: // Back
        action = 'RETURN';
        break;
      case 10: // Exit
        action = 'CANCEL';
        break;
      case 11: // Play / Pause
        action = 'PLAY';
        break;
      default:
        // case 15: // Information
        action = 'HOME';
        break;
    }
    this.platform.log.debug(`remote control:${action}`);
    const cmd = await this.accessory.context.device.sendCommand(action);
    if (cmd.error) {
      this.platform.log.error('(remoteControl)/(%s) %s', action!, cmd.error);
    }

    callback(undefined, keyId);
  }
}
