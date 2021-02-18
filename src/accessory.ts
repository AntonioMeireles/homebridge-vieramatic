import {
  Characteristic,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service
} from 'homebridge'

// @ts-expect-error noImplicityAny...
import wakeOnLan from '@mi-sec/wol'

import { Abnormal, sleep, Outcome } from './helpers'
import VieramaticPlatform from './platform'
import { VieraApp, VieraApps, VieraSpecs, VieraTV } from './viera'

type InputVisibility = 0 | 1

type OnDisk =
  | {
      data: {
        inputs: {
          applications: VieraApps
          hdmi: HdmiInput[]
          TUNER: { hidden: InputVisibility }
        }
        ipAddress: string
        specs: VieraSpecs
      }
    }
  | Record<string, never>

interface HdmiInput {
  name: string
  id: string
  hidden?: InputVisibility
}

interface UserConfig {
  friendlyName?: string
  ipAddress: string
  mac?: string
  encKey?: string
  appId?: string
  customVolumeSlider?: boolean
  disabledAppSupport?: boolean
  hdmiInputs: HdmiInput[]
}

type InputType = 'HDMI' | 'APPLICATION' | 'TUNER'

class VieramaticPlatformAccessory {
  private readonly service: Service

  private readonly Service: typeof Service

  private readonly Characteristic: typeof Characteristic

  private readonly log: Logger

  private readonly storage: OnDisk

  private readonly device: VieraTV

  constructor(
    private readonly platform: VieramaticPlatform,
    public readonly accessory: PlatformAccessory,
    private readonly userConfig: UserConfig,
    private readonly tvApps: VieraApps
  ) {
    this.log = this.platform.log
    this.Service = this.platform.Service
    this.Characteristic = this.platform.Characteristic

    this.log.debug(JSON.stringify(this.userConfig, undefined, 2))

    const handler = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: (obj: any, prop: PropertyKey): unknown => {
        if (prop === 'isProxy') return true

        const property = obj[prop]
        if (typeof property === 'undefined') return

        if (property.isProxy == null && typeof property === 'object')
          obj[prop] = new Proxy(property, handler)

        return obj[prop]
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: (obj: any, prop: PropertyKey, value: any): boolean => {
        obj[prop] = value
        this.platform.storage.save()
        return true
      }
    }

    this.device = this.accessory.context.device
    this.storage = new Proxy<OnDisk>(
      this.platform.storage.get(this.device.specs.serialNumber),
      handler
    )

    const svc = this.accessory.getService(this.Service.AccessoryInformation)
    if (svc != null)
      svc
        .setCharacteristic(
          this.Characteristic.Manufacturer,
          this.device.specs.manufacturer
        )
        .setCharacteristic(
          this.Characteristic.Model,
          `${this.device.specs.modelName} ${this.device.specs.modelNumber}`
        )
        .setCharacteristic(
          this.Characteristic.SerialNumber,
          this.device.specs.serialNumber
        )

    this.accessory.on('identify', () =>
      this.log.info(this.device.specs.friendlyName, 'Identified!')
    )

    this.service = this.accessory.addService(this.Service.Television)

    this.service.setCharacteristic(
      this.Characteristic.Name,
      this.device.specs.friendlyName
    )

    this.service
      .setCharacteristic(
        this.Characteristic.ConfiguredName,
        this.device.specs.friendlyName
      )
      .setCharacteristic(
        this.Characteristic.SleepDiscoveryMode,
        this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
      )

    this.service
      .addCharacteristic(this.Characteristic.PowerModeSelection)
      .on(
        'set',
        async (
          _value: CharacteristicValue,
          callback: CharacteristicSetCallback
        ) => {
          const outcome = await this.device.sendCommand('MENU')
          if (Abnormal(outcome))
            this.log.error(
              'unexpected error in PowerModeSelection.set',
              outcome.error
            )

          callback(null)
        }
      )

    this.service
      .getCharacteristic(this.Characteristic.Active)
      .on('set', this.setPowerStatus.bind(this))
      .on('get', this.getPowerStatus.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.RemoteKey)
      .on('set', this.remoteControl.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.ActiveIdentifier)
      .on('set', this.setInput.bind(this))

    const speakerService = this.accessory.addService(
      this.Service.TelevisionSpeaker,
      `${this.device.specs.friendlyName} Volume`,
      'volumeService'
    )

    speakerService.addCharacteristic(this.Characteristic.Volume)
    speakerService.addCharacteristic(this.Characteristic.Active)
    speakerService.setCharacteristic(
      this.Characteristic.VolumeControlType,
      this.Characteristic.VolumeControlType.ABSOLUTE
    )
    this.service.addLinkedService(speakerService)

    speakerService
      .getCharacteristic(this.Characteristic.Mute)
      .on('get', this.getMute.bind(this))
      .on('set', this.setMute.bind(this))
    speakerService
      .getCharacteristic(this.Characteristic.Volume)
      .on('get', this.getVolume.bind(this))
      .on('set', this.setVolume.bind(this))
    speakerService
      .getCharacteristic(this.Characteristic.VolumeSelector)
      .on('set', this.setVolumeSelector.bind(this))

    if (this.userConfig.customVolumeSlider === true) {
      const customSpeakerService = this.accessory.addService(
        this.Service.Fan,
        `${this.device.specs.friendlyName} Volume`,
        'VolumeAsFanService'
      )
      this.service.addLinkedService(customSpeakerService)

      customSpeakerService
        .getCharacteristic(this.Characteristic.On)
        .on('get', (callback: CharacteristicGetCallback) => {
          const { value } = this.service.getCharacteristic(
            this.Characteristic.Active
          )
          this.log.debug('(customSpeakerService/On.get)', value)
          callback(null, value)
        })
        .on(
          'set',
          async (
            value: CharacteristicValue,
            callback: CharacteristicSetCallback
          ) => {
            this.log.debug('(customSpeakerService/On.set)', value)
            const state =
              this.service.getCharacteristic(this.Characteristic.Active)
                .value === this.Characteristic.Active.INACTIVE
                ? false
                : !(value as boolean)
            await this.device.setMute(state)
            callback(null)
          }
        )

      customSpeakerService
        .getCharacteristic(this.Characteristic.RotationSpeed)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this))
    }

    setInterval(async () => await this.getPowerStatus(), 5000)

    this.userConfig.hdmiInputs ||= []

    // ignore HDMI configs
    this.userConfig.hdmiInputs = this.userConfig.hdmiInputs.filter((input) => {
      const required = ['id', 'name']

      for (const req of required)
        if (!Object.prototype.hasOwnProperty.call(input, req)) {
          this.log.warn(
            'ignoring hdmi input "%s" as it has a missing required field ("%s" is required)',
            input,
            req
          )
          return false
        }

      return true
    })

    if (this.storage.data == null) {
      this.storage.data = {
        inputs: {
          applications: { ...this.tvApps },
          hdmi: this.userConfig.hdmiInputs,
          // add default TUNER (live TV)... visible by default
          TUNER: { hidden: 0 }
        },
        ipAddress: this.userConfig.ipAddress,
        specs: { ...this.device.specs }
      }
    } else {
      this.log.debug('Restoring', this.device.specs.friendlyName)
      // check for new user added inputs
      userConfig.hdmiInputs.forEach((input) => {
        const fn = (element: HdmiInput): boolean =>
          element.id === input.id && element.name === input.name

        const found = this.storage.data.inputs.hdmi.findIndex((x: HdmiInput) =>
          fn(x)
        )
        if (found === -1) {
          this.log.info(
            "adding HDMI input '%s' - '%s' as it was appended to config.json",
            input.id,
            input.name
          )
          this.storage.data.inputs.hdmi.push(input)
        }
      })
      // check for user removed inputs
      const shallow: HdmiInput[] = []
      this.storage.data.inputs.hdmi.forEach((input: HdmiInput) => {
        const fn = (element: HdmiInput): boolean => element.id === input.id

        const found = userConfig.hdmiInputs.findIndex((x) => fn(x))
        found === -1
          ? this.log.info(
              "unsetting HDMI input '%s' ['%s'] since it was dropped from the config.json",
              input.id,
              input.name
            )
          : shallow.push(input)
      })
      this.storage.data.inputs.hdmi = [...shallow]
      this.storage.data.ipAddress = this.userConfig.ipAddress
      this.storage.data.specs = { ...this.device.specs }

      // FIXME: check also for added/removed apps (just in case)
    }

    // TV Tuner
    this.configureInputSource('TUNER', 'TV Tuner', 500)
    // HDMI inputs ...
    this.storage.data.inputs.hdmi.forEach((input: HdmiInput) => {
      const sig = Number.parseInt(input.id, 10)
      this.configureInputSource('HDMI', input.name, sig)
    })
    // Apps
    Object.entries(this.storage.data.inputs.applications).forEach((line) => {
      const [id, app] = line
      const sig = 1000 + Number.parseInt(id, 10)
      this.configureInputSource('APPLICATION', app.name, sig)
    })
  }

  private async setInput(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    const fn = async (): Promise<Outcome<void>> => {
      let app: VieraApp
      let real: number

      switch (false) {
        case !(value < 100):
          this.log.debug('(setInput) switching to HDMI INPUT ', value)
          return await this.device.sendHDMICommand((value as number).toString())
        case !(value > 999):
          real = (value as number) - 1000
          app = this.storage.data.inputs.applications[real]
          this.log.debug('(setInput) switching to App', app.name)
          return await this.device.sendAppCommand(app.id)
        case !(value === 500):
        default:
          this.log.debug('(setInput) switching to internal TV tunner')
          return await this.device.sendCommand('AD_CHANGE')
      }
    }

    const cmd = await fn()
    if (Abnormal(cmd)) this.log.error('setInput', value, cmd.error)

    callback(null)
  }

  private configureInputSource(
    type: InputType,
    configuredName: string,
    identifier: number
  ): void {
    const fn = (element: HdmiInput): boolean =>
      element.id === identifier.toString()

    const visibility = (): string => {
      let idx: number
      let hidden: number
      const { inputs } = this.storage.data

      switch (type) {
        case 'HDMI':
          idx = inputs.hdmi.findIndex((x: HdmiInput) => fn(x))
          // by default all hdmiInputs will be visible
          hidden = inputs.hdmi[idx].hidden ?? 0
          break
        case 'APPLICATION':
          idx = identifier - 1000
          // by default all apps will be hidden
          hidden = inputs.applications[idx].hidden ?? 1
          break
        case 'TUNER':
        default:
          hidden = inputs.TUNER.hidden
      }
      return hidden.toFixed()
    }
    // catch gracefully user cfg errors (#67)
    try {
      const source = this.accessory.addService(
        this.Service.InputSource,
        configuredName.toLowerCase().replace(/\s/gu, ''),
        identifier
      )
      const visibilityState = (
        state: CharacteristicValue,
        callback: CharacteristicSetCallback
      ): void => {
        let idx: number
        const id =
          source.getCharacteristic(this.Characteristic.Identifier).value ?? 500
        const { inputs } = this.storage.data

        switch (false) {
          case !(id < 100):
            // hdmi input
            idx = inputs.hdmi.findIndex((x: HdmiInput) => fn(x))
            inputs.hdmi[idx].hidden = state as InputVisibility
            break
          case !(id > 999):
            // APP
            idx = (id as number) - 1000
            inputs.applications[idx].hidden = state as InputVisibility
            break
          case !(id === 500):
          default:
            inputs.TUNER.hidden = state as InputVisibility
            break
        }
        source.updateCharacteristic(
          this.Characteristic.CurrentVisibilityState,
          state
        )

        callback(null)
      }
      const hidden = visibility()

      source
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType[type]
        )
        .setCharacteristic(this.Characteristic.CurrentVisibilityState, hidden)
        .setCharacteristic(this.Characteristic.TargetVisibilityState, hidden)
        .setCharacteristic(this.Characteristic.Identifier, identifier)
        .setCharacteristic(this.Characteristic.ConfiguredName, configuredName)
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED
        )
      source
        .getCharacteristic(this.Characteristic.TargetVisibilityState)
        .on('set', visibilityState)

      const svc = this.accessory.getService(this.Service.Television)
      if (svc != null) svc.addLinkedService(source)
    } catch (error) {
      this.log.error(
        "An error ocurred while trying to add an '%s' accessory ('%s':'%s') to your TV - ignoring it.",
        type,
        identifier,
        configuredName,
        "If you do believe that your homebridge's 'config.json' is in order and has absolutelly no",
        'duplicated entries then please fill a bug at https://github.com/AntonioMeireles/homebridge-vieramatic/issues'
      )
    }
  }

  async setPowerStatus(
    nextState: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    const message =
      nextState === this.Characteristic.Active.ACTIVE ? 'ON' : 'into STANDBY'
    const currentState = await this.device.isTurnedOn()
    this.log.debug('(setPowerStatus)', nextState, currentState)
    if ((nextState === this.Characteristic.Active.ACTIVE) === currentState) {
      this.log.debug('TV is already %s: Ignoring!', message)
    } else if (
      nextState === this.Characteristic.Active.ACTIVE &&
      this.device.mac != null
    ) {
      this.log.debug('sending WOL packets to awake TV')
      await wakeOnLan(this.device.mac, { packets: 10 })
      await this.updateTVstatus(nextState)
      this.log.debug('Turned TV', message)
    } else {
      const cmd = await this.device.sendCommand('POWER')
      if (Abnormal(cmd)) {
        this.log.error(
          '(setPowerStatus)/-> %s  - unable to power cycle TV - probably unpowered',
          message
        )
      } else {
        await this.updateTVstatus(nextState)
        this.log.debug('Turned TV', message)
      }
    }

    callback(null)
  }

  async getPowerStatus(callback?: CharacteristicGetCallback): Promise<void> {
    const currentState = await this.device.isTurnedOn()

    await this.updateTVstatus(currentState)

    if (callback != null) callback(null, currentState)
  }

  async getMute(callback: CharacteristicGetCallback): Promise<void> {
    const state = await this.device.isTurnedOn()
    let mute: boolean

    if (state) {
      const cmd = await this.device.getMute()
      mute = !Abnormal(cmd) ? cmd.value : true
    } else {
      mute = true
    }

    this.log.debug('(getMute) is', mute)
    callback(null, mute)
  }

  async setMute(
    state: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    this.log.debug('(setMute) is', state)
    const cmd = await this.device.setMute(state as boolean)

    if (Abnormal(cmd))
      this.log.error(
        '(setMute)/(%s) unable to change mute state on TV...',
        state
      )

    callback(null)
  }

  async setVolume(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    this.log.debug('(setVolume)', value)
    const cmd = await this.device.setVolume((value as number).toString())
    if (Abnormal(cmd)) {
      this.log.error('(setVolume)/(%s) unable to set volume on TV...', value)
      value = 0
    }
    callback(null)
  }

  async getVolume(callback: CharacteristicGetCallback): Promise<void> {
    const cmd = await this.device.getVolume()
    let volume = 0

    Abnormal(cmd)
      ? this.log.error('(getVolume) unable to get volume from TV...')
      : (volume = Number(cmd.value))

    callback(null, volume)
  }

  async setVolumeSelector(
    key: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    this.log.debug('setVolumeSelector', key)
    const action =
      key === this.Characteristic.VolumeSelector.INCREMENT ? 'VOLUP' : 'VOLDOWN'
    const cmd = await this.device.sendCommand(action)

    if (Abnormal(cmd))
      this.log.error('(setVolumeSelector) unable to change volume', cmd.error)

    callback(null)
  }

  async updateTVstatus(newState: CharacteristicValue): Promise<void> {
    let customSpeakerService: Service | undefined
    const tvService = this.accessory.getService(this.Service.Television)
    const speakerService = this.accessory.getService(
      this.Service.TelevisionSpeaker
    )

    if (tvService === undefined || speakerService === undefined) return

    if (this.userConfig.customVolumeSlider === true)
      customSpeakerService = this.accessory.getService(this.Service.Fan)

    speakerService.updateCharacteristic(this.Characteristic.Active, newState)
    tvService.updateCharacteristic(this.Characteristic.Active, newState)
    if (newState === true) {
      const cmd = await this.device.getMute()
      if (
        !Abnormal(cmd) &&
        cmd.value !==
          speakerService.getCharacteristic(this.Characteristic.Mute).value
      ) {
        speakerService.updateCharacteristic(this.Characteristic.Mute, cmd.value)
        if (customSpeakerService != null)
          customSpeakerService.updateCharacteristic(
            this.Characteristic.On,
            cmd.value ? 0 : 1
          )
      }
    } else {
      speakerService.updateCharacteristic(this.Characteristic.Mute, true)

      if (customSpeakerService != null)
        customSpeakerService.updateCharacteristic(this.Characteristic.On, false)
    }
  }

  async remoteControl(
    keyId: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): Promise<void> {
    let action: string
    //  https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit-TV.ts#L235
    switch (keyId) {
      // Rewind
      case 0:
        action = 'REW'
        break
      // Fast Forward
      case 1:
        action = 'FF'
        break
      // Next Track
      case 2:
        action = 'SKIP_NEXT'
        break
      // Previous Track
      case 3:
        action = 'SKIP_PREV'
        break
      // Up Arrow
      case 4:
        action = 'UP'
        break
      // Down Arrow
      case 5:
        action = 'DOWN'
        break
      // Left Arrow
      case 6:
        action = 'LEFT'
        break
      // Right Arrow
      case 7:
        action = 'RIGHT'
        break
      // Select
      case 8:
        action = 'ENTER'
        break
      // Back
      case 9:
        action = 'RETURN'
        break
      // Exit
      case 10:
        action = 'CANCEL'
        break
      // Play / Pause
      case 11:
        action = 'PLAY'
        break
      // Information
      case 15:
      default:
        action = 'HOME'
        break
    }
    this.log.debug('remote control:', action)
    const cmd = await this.device.sendCommand(action)

    if (Abnormal(cmd))
      this.log.error('(remoteControl)/(%s) %s', action, cmd.error)

    callback(null)
  }
}

export {
  sleep,
  OnDisk,
  InputVisibility,
  UserConfig,
  VieramaticPlatformAccessory
}
