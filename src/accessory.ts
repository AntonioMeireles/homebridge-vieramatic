import { Characteristic, CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge'
import util from 'node:util'

import { Abnormal, Ok, Outcome, EmptyObject, prettyPrint, sleep } from './helpers'
import { wakeOnLan } from './networkUtils'
import VieramaticPlatform from './platform'
import { VieraApp, VieraApps, VieraSpecs, VieraTV } from './viera'

type InputVisibility = 0 | 1

type OnDisk =
  | EmptyObject
  | {
      data: {
        inputs: {
          applications: VieraApps
          hdmi: HdmiInput[]
          TUNER: { hidden?: InputVisibility }
        }
        ipAddress: string
        specs: VieraSpecs
      }
    }

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
    readonly accessory: PlatformAccessory,
    private readonly userConfig: UserConfig
  ) {
    this.log = this.platform.log
    this.Service = this.platform.Service
    this.Characteristic = this.platform.Characteristic

    this.log.debug(prettyPrint(this.userConfig))

    const handler = {
      get: <T, K extends keyof T>(obj: T, prop: K): T[K] | boolean | undefined => {
        if (prop === 'isProxy') return true

        const property = obj[prop]
        // eslint-disable-next-line unicorn/no-typeof-undefined
        if (typeof property === 'undefined') return

        if (!util.types.isProxy(property) && typeof property === 'object')
          obj[prop] = new Proxy(
            property as unknown as Record<string, unknown>,
            handler
          ) as unknown as T[K]

        return obj[prop]
      },
      set: <T, K extends keyof T>(obj: T, prop: K, value: T[K]) => {
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
    const model = `${this.device.specs.modelName} ${this.device.specs.modelNumber}`
    if (svc)
      svc
        .setCharacteristic(this.Characteristic.Manufacturer, this.device.specs.manufacturer)
        .setCharacteristic(this.Characteristic.SerialNumber, this.device.specs.serialNumber)
        .setCharacteristic(this.Characteristic.Model, model)

    this.accessory.on('identify', () =>
      this.log.info(this.device.specs.friendlyName, 'Identified!')
    )

    this.service = this.accessory.addService(this.Service.Television)

    this.service.setCharacteristic(this.Characteristic.Name, this.device.specs.friendlyName)

    this.service
      .setCharacteristic(this.Characteristic.ConfiguredName, this.device.specs.friendlyName)
      .setCharacteristic(
        this.Characteristic.SleepDiscoveryMode,
        this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
      )

    this.service.addCharacteristic(this.Characteristic.PowerModeSelection).onSet(async () => {
      const outcome = await this.device.sendKey('MENU')
      if (Abnormal(outcome))
        this.log.error('unexpected error in PowerModeSelection.set', outcome.error)
    })

    this.service
      .getCharacteristic(this.Characteristic.Active)
      .onSet(this.setPowerStatus.bind(this))
      .onGet(this.getPowerStatus.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(this.remoteControl.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(this.setInput.bind(this))

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
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this))
    speakerService
      .getCharacteristic(this.Characteristic.Volume)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this))
    speakerService
      .getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet(this.setVolumeSelector.bind(this))

    if (this.userConfig.customVolumeSlider === true) {
      const [friendlyN, svcN] = [`${this.device.specs.friendlyName} Volume`, 'VolumeAsFanService']
      const customSpeakerService = this.accessory.addService(this.Service.Fan, friendlyN, svcN)
      this.service.addLinkedService(customSpeakerService)

      customSpeakerService
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => {
          const { value } = this.service.getCharacteristic(this.Characteristic.Active)
          this.log.debug('(customSpeakerService/On.get)', value)
          return value
        })
        .onSet(async (value: CharacteristicValue) => {
          this.log.debug('(customSpeakerService/On.set)', value)
          const previous = this.service.getCharacteristic(this.Characteristic.Active).value
          const state = previous === this.Characteristic.Active.INACTIVE ? false : !value
          await this.device.setMute(state)
        })

      customSpeakerService
        .getCharacteristic(this.Characteristic.RotationSpeed)
        .onGet(this.getVolume.bind(this))
        .onSet(this.setVolume.bind(this))
    }

    setInterval(async () => await this.getPowerStatus(), 5000)

    this.userConfig.hdmiInputs ||= []

    // ignore HDMI configs
    this.userConfig.hdmiInputs = this.userConfig.hdmiInputs.filter((input) => {
      const required = ['id', 'name']

      for (const req of required)
        if (!Object.prototype.hasOwnProperty.call(input, req)) {
          this.log.warn(
            `ignoring hdmi input "${prettyPrint(
              input
            )}" as it has a missing required field ("${req}" is required)`
          )
          return false
        }

      return true
    })
    const apps = Ok(this.device.apps) ? this.device.apps.value : []
    if (this.storage.data as unknown) {
      this.log.debug('Restoring', this.device.specs.friendlyName)
      // properly handle hdmi interface renaming (#78)
      const sameId = (a: HdmiInput, b: HdmiInput): boolean => a.id === b.id
      const sameNameId = (a: HdmiInput, b: HdmiInput): boolean => a.id === b.id && a.name === b.name

      this.storage.data.inputs.hdmi = this.storage.data.inputs.hdmi.map(
        (element: HdmiInput): HdmiInput => {
          const found = userConfig.hdmiInputs.findIndex((x) => sameId(x, element))
          if (found !== -1 && userConfig.hdmiInputs[found].name !== element.name) {
            const msg = "HDMI input '%s' renamed from '%s' to '%s'"
            this.log.info(msg, element.id, element.name, userConfig.hdmiInputs[found].name)
            element.name = userConfig.hdmiInputs[found].name
          }
          return element
        }
      )
      // check for new user added inputs
      for (const input of userConfig.hdmiInputs) {
        const found = this.storage.data.inputs.hdmi.findIndex((x) => sameNameId(x, input))
        if (found === -1) {
          const msg = `appending HDMI input '${input.id}':'${input.name}' as it was appended to config.json`
          this.log.info(msg)
          this.storage.data.inputs.hdmi.push(input)
        }
      }
      // check for user removed inputs
      this.storage.data.inputs.hdmi = this.storage.data.inputs.hdmi.filter((input) => {
        const found = userConfig.hdmiInputs.findIndex((x) => sameId(x, input))
        if (found !== -1) return true

        const msg = `removing HDMI input '${input.id}':'${input.name}' as it was dropped from the config.json`
        this.log.info(msg, input.id, input.name)
        return false
      })

      this.storage.data.ipAddress = this.userConfig.ipAddress
      this.storage.data.specs = { ...this.device.specs }
      if (apps.length > 0) {
        const next: VieraApps = []
        for (const line of Object.entries(this.storage.data.inputs.applications)) {
          const [_, app] = line
          const found = [...apps].some((x: VieraApp): boolean => x.name === app.name)
          if (found) {
            next.push(app)
          } else {
            this.log.warn(`deleting TV App '${app.name}' as it wasn't removed from your TV's`)
          }
        }
        for (const line of Object.entries([...apps])) {
          const [_, app] = line
          const found = next.some((x: VieraApp): boolean => x.name === app.name)
          if (!found) {
            this.log.warn(`adding TV App '${app.name}' since it was added to your TV`)
            next.push(app)
          }
        }
        this.storage.data.inputs.applications = { ...next }
      } else this.log.warn('Using previously cached App listing.')
    } else {
      this.storage.data = {
        inputs: {
          applications: { ...apps },
          hdmi: this.userConfig.hdmiInputs,
          // add default TUNER (live TV)... visible by default
          TUNER: { hidden: 0 }
        },
        ipAddress: this.userConfig.ipAddress,
        specs: { ...this.device.specs }
      }
    }

    // TV Tuner
    this.configureInputSource('TUNER', 'TV Tuner', 500)
    // HDMI inputs ...
    this.storage.data.inputs.hdmi = this.storage.data.inputs.hdmi.filter(
      (input: HdmiInput): boolean => {
        // catch gracefully user cfg errors (#67)
        try {
          this.configureInputSource('HDMI', input.name, Number.parseInt(input.id, 10))
        } catch {
          this.log.error(
            "Unable to add as an accessory to your TV 'HDMI' input:\n%s\n\n%s",
            prettyPrint(input),
            "If you do believe that your homebridge's 'config.json' is in order and",
            'has absolutelly no duplicated entries for HDMI inputs then please fill',
            'a bug at https://github.com/AntonioMeireles/homebridge-vieramatic/issues,',
            'otherwise just remove or fix the duplicated stuff.'
          )
          return false
        }
        return true
      }
    )
    // Apps
    for (const line of Object.entries(this.storage.data.inputs.applications)) {
      const [id, app] = line
      const sig = 1000 + Number.parseInt(id, 10)
      this.configureInputSource('APPLICATION', app.name, sig)
    }
  }

  private async setInput(value: CharacteristicValue): Promise<void> {
    const fn = async (): Promise<Outcome<void>> => {
      let app: VieraApp, real: number

      switch (true) {
        case value < 100: {
          this.log.debug('(setInput) switching to HDMI INPUT ', value)
          return await this.device.sendKey(`HDMI${value}`)
        }
        case value > 999: {
          real = (value as number) - 1000
          app = this.storage.data.inputs.applications[real]
          this.log.debug('(setInput) switching to App', app.name)
          return await this.device.launchApp(app.id)
        }
        // case value === 500:
        default: {
          this.log.debug('(setInput) switching to internal TV tunner')
          return await this.device.sendKey('AD_CHANGE')
        }
      }
    }

    const cmd = await fn()
    if (Abnormal(cmd)) this.log.error('setInput', value, cmd.error)
  }

  private configureInputSource(type: InputType, configuredName: string, identifier: number): void {
    const fn = (element: HdmiInput): boolean => element.id === identifier.toString()

    const visibility = (): string => {
      let idx: number
      let hidden: number
      const { inputs } = this.storage.data

      switch (type) {
        case 'HDMI': {
          idx = inputs.hdmi.findIndex((x: HdmiInput) => fn(x))
          // by default all hdmiInputs will be visible
          hidden = inputs.hdmi[idx].hidden ?? 0
          break
        }
        case 'APPLICATION': {
          idx = identifier - 1000
          // by default all apps will be hidden
          hidden = inputs.applications[idx].hidden ?? 1
          break
        }
        // case 'TUNER':
        default: {
          // by default TUNER is visible
          hidden = inputs.TUNER.hidden ?? 0
        }
      }
      return hidden.toFixed(0)
    }

    const source = this.accessory.addService(
      this.Service.InputSource,
      configuredName.toLowerCase().replace(/\s/gu, ''),
      identifier.toString()
    )
    const visibilityState = (state: CharacteristicValue): void => {
      let idx: number
      const id = source.getCharacteristic(this.Characteristic.Identifier).value ?? 500
      const { inputs } = this.storage.data

      switch (true) {
        case id < 100: {
          // hdmi input
          idx = inputs.hdmi.findIndex((x: HdmiInput) => fn(x))
          inputs.hdmi[idx].hidden = state as InputVisibility
          break
        }
        case id > 999: {
          // APP
          idx = (id as number) - 1000
          inputs.applications[idx].hidden = state as InputVisibility
          break
        }
        // case id === 500:
        default: {
          inputs.TUNER.hidden = state as InputVisibility
          break
        }
      }
      source.updateCharacteristic(this.Characteristic.CurrentVisibilityState, state)
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
    source.getCharacteristic(this.Characteristic.TargetVisibilityState).onSet(visibilityState)

    const svc = this.accessory.getService(this.Service.Television)
    if (svc) svc.addLinkedService(source)
  }

  async setPowerStatus(nextState: CharacteristicValue): Promise<void> {
    const message = nextState === this.Characteristic.Active.ACTIVE ? 'ON' : 'into STANDBY'
    const currentState = await VieraTV.isTurnedOn(this.device.address)
    this.log.debug('(setPowerStatus)', nextState, currentState)
    if ((nextState === this.Characteristic.Active.ACTIVE) === currentState)
      this.log.debug('TV is already %s: Ignoring!', message)
    else if (nextState === this.Characteristic.Active.ACTIVE && this.userConfig.mac) {
      this.log.debug('sending WOL packets to awake TV')
      // takes 1 sec (10 magic pkts sent with 100ms interval)
      await wakeOnLan(this.userConfig.mac, this.device.address, 10)
      await sleep(1000)
      await this.updateTVstatus(nextState)
      this.log.debug('Turned TV', message)
    } else {
      const cmd = await this.device.sendKey('POWER')
      if (Abnormal(cmd))
        this.log.error('(setPowerStatus)/-> %s - unable to power cycle TV - unpowered ?', message)
      else {
        await this.updateTVstatus(nextState)
        this.log.debug('Turned TV', message)
      }
    }
  }

  async getPowerStatus(): Promise<boolean> {
    const currentState = await VieraTV.isTurnedOn(this.device.address)

    await this.updateTVstatus(currentState)

    return currentState
  }

  async getMute(): Promise<boolean> {
    const state = await VieraTV.isTurnedOn(this.device.address)
    let mute: boolean

    if (state) {
      const cmd = await this.device.getMute()
      mute = Ok(cmd) ? cmd.value : true
    } else mute = true

    this.log.debug('(getMute) is', mute)
    return mute
  }

  async setMute(state: CharacteristicValue): Promise<void> {
    this.log.debug('(setMute) is', state)
    if (Abnormal(await this.device.setMute(state as boolean)))
      this.log.error('(setMute)/(%s) unable to change mute state on TV...', state)
  }

  async setVolume(value: CharacteristicValue): Promise<void> {
    this.log.debug('(setVolume)', value)
    if (Abnormal(await this.device.setVolume((value as number).toString())))
      this.log.error('(setVolume)/(%s) unable to set volume on TV...', value)
  }

  async getVolume(): Promise<number> {
    const cmd = await this.device.getVolume()
    let volume = 0

    Ok(cmd) ? (volume = Number(cmd.value)) : this.log.debug('(getVolume) no volume from TV...')

    return volume
  }

  async setVolumeSelector(key: CharacteristicValue): Promise<void> {
    this.log.debug('setVolumeSelector', key)
    const action = key === this.Characteristic.VolumeSelector.INCREMENT ? 'VOLUP' : 'VOLDOWN'
    const cmd = await this.device.sendKey(action)
    if (Abnormal(cmd)) this.log.error('(setVolumeSelector) unable to change volume', cmd.error)
  }

  async updateTVstatus(nextState: CharacteristicValue): Promise<void> {
    const tvService = this.accessory.getService(this.Service.Television)
    const speakerService = this.accessory.getService(this.Service.TelevisionSpeaker)
    const customSpeakerService = this.accessory.getService(this.Service.Fan)

    if (!tvService || !speakerService) return

    speakerService.updateCharacteristic(this.Characteristic.Active, nextState)
    tvService.updateCharacteristic(this.Characteristic.Active, nextState)

    if (nextState === true) {
      const [cmd, volume] = [await this.device.getMute(), await this.getVolume()]
      const muted = Ok(cmd) ? cmd.value : true

      speakerService
        .updateCharacteristic(this.Characteristic.Mute, muted)
        .updateCharacteristic(this.Characteristic.Volume, volume)

      if (customSpeakerService)
        customSpeakerService
          .updateCharacteristic(this.Characteristic.On, !muted)
          .updateCharacteristic(this.Characteristic.RotationSpeed, volume)
    } else if (customSpeakerService)
      customSpeakerService.updateCharacteristic(this.Characteristic.On, nextState)
  }

  async remoteControl(keyId: CharacteristicValue): Promise<void> {
    // https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/definitions/CharacteristicDefinitions.ts#L3029
    const keys: Record<number, string> = {
      // Rewind
      0: 'REW',
      // Fast Forward
      1: 'FF',
      // Next Track
      2: 'SKIP_NEXT',
      // Previous Track
      3: 'SKIP_PREV',
      // Up Arrow
      4: 'UP',
      // Down Arrow
      5: 'DOWN',
      // Left Arrow
      6: 'LEFT',
      // Right Arrow
      7: 'RIGHT',
      // Select
      8: 'ENTER',
      // Back
      9: 'RETURN',
      // Exit
      10: 'CANCEL',
      // Play / Pause
      11: 'PLAY',
      // Information
      15: 'HOME'
    }
    const action = (keyId as number) in keys ? keys[keyId as number] : 'HOME'
    this.log.debug('remote control:', action)
    const cmd = await this.device.sendKey(action)

    if (Abnormal(cmd)) this.log.error('(remoteControl)/(%s) %s', action, cmd.error)
  }
}

export { InputVisibility, OnDisk, UserConfig, VieramaticPlatformAccessory }
