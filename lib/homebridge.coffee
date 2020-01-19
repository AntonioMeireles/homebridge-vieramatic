# homebridge vieramatic plugin

# > required **external dependencies**
UpnpSub = require('node-upnp-subscription')
events = require('events')
_ = require('lodash')

{ Viera } = require('./viera')

# helpers
findVal = (object, key) ->
  value = undefined
  Object.keys(object).some((k) ->
    if k == key
      value = object[k]
      return true
    if object[k] and typeof object[k] == 'object'
      value = findVal(object[k], key)
      return value != undefined
  )
  value

### global Service Characteristic Accessory ###

class Vieramatic
  tvEvent = new events.EventEmitter()

  constructor: (log, config, api) ->
    log.debug('Vieramatic Init')
    # eslint-disable-next-line no-undef
    [@log, @api, @accessories] = [log, api, []]

    @config = {
      tvs: config?.tvs || []
    }

    @api.on('didFinishLaunching', @init) if @api

  init: () =>
    for __, viera of @config.tvs
      @log.debug(viera.ipAddress)
      viera.hdmiInputs = [] unless viera.hdmiInputs?
      tv = new Viera(viera.ipAddress, viera.appId, viera.encKey)
      reachable = true

      try
        await tv.getSpecs()
      catch ___
        reachable = false
        @log.error(
          "unable to connect to TV (at #{
            viera.ipAddress
          }). Either it is powered off or the supplied IP is wrong "
        )
      # eslint-disable-next-line no-continue
      continue unless reachable
      @log.debug(tv)

      if tv.encrypted and not (tv._appId? and tv._encKey?)
        @log.error("TV at #{viera.ipAddress} requires encryption but no credentials were supplied.")
        # eslint-disable-next-line no-continue
        continue
      viera.applications = await tv.getApps()
      await @addAccessory(tv, viera.hdmiInputs, viera.applications)

    @log.debug('config.json: %s Viera TV defined', @config.tvs.length)

    @log('DidFinishLaunching')

  addAccessory: (accessory, hdmiInputs, applications) =>
    [@device, @applications] = [accessory, applications]
    { friendlyName, serialNumber, modelName, modelNumber, manufacturer } = accessory.specs

    if found = _.find(@accessories, { UUID: serialNumber })
      newAccessory = found
      if @applications.length is 0
        @log.debug('TV is in standby - getting (cached) TV apps')
        @applications = newAccessory.inputs.applications
    else
      @log.debug('Adding as Accessory', accessory)

      tvService = new Service.Television(friendlyName, 'Television')
      tvService
      .setCharacteristic(Characteristic.ConfiguredName, friendlyName)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, 1)
      tvService.addCharacteristic(Characteristic.RemoteKey)
      tvService.addCharacteristic(Characteristic.PowerModeSelection)

      speakerService = new Service.TelevisionSpeaker("#{friendlyName} Volume", 'volumeService')
      speakerService.addCharacteristic(Characteristic.Volume)

      volumeService = new Service.Lightbulb("#{friendlyName} Volume", 'volumeService')
      volumeService.addCharacteristic(Characteristic.Brightness)

      tvService.addLinkedService(speakerService)
      tvService.addLinkedService(volumeService)

      # eslint-disable-next-line new-cap
      newAccessory = new Accessory(friendlyName, serialNumber)

      accessoryInformation = newAccessory.getService(Service.AccessoryInformation)
      accessoryInformation
      .setCharacteristic(Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(Characteristic.Model, "#{modelName} #{modelNumber}")
      .setCharacteristic(Characteristic.SerialNumber, serialNumber)
      accessoryInformation.displayName = friendlyName
      accessoryInformation.subtype = 'specs'

      newAccessory.addService(tvService)
      newAccessory.addService(speakerService)
      newAccessory.addService(volumeService)

      @accessories.push(newAccessory)
      @api.registerPlatformAccessories('homebridge-vieramatic', 'PanasonicVieraTV', [newAccessory])

    newAccessory.context = {
      inputs: {
        hdmi: hdmiInputs,
        applications: { ...applications }
      }
      specs: { ...@device.specs }
    }

    newAccessory.on('identify', (paired, callback) =>
      @log.debug(friendlyName, 'Identify!!!')
      callback())

    tvService = newAccessory.getService(Service.Television) unless tvService?
    tvService
    .getCharacteristic(Characteristic.Active)
    .on('get', @getPowerStatus)
    .on('set', @setPowerStatus)

    tvService.getCharacteristic(Characteristic.RemoteKey).on('set', @remoteControl)
    tvService.getCharacteristic(Characteristic.ActiveIdentifier).on('set', @setInput)

    speakerService = newAccessory.getService(Service.TelevisionSpeaker) unless speakerService?

    speakerService.setCharacteristic(
      Characteristic.VolumeControlType,
      Characteristic.VolumeControlType.ABSOLUTE
    )

    speakerService.getCharacteristic(Characteristic.VolumeSelector).on('set', @setVolume)

    speakerService
    .getCharacteristic(Characteristic.Mute)
    .on('get', @getMute)
    .on('set', @setMute)
    speakerService
    .getCharacteristic(Characteristic.Volume)
    .on('get', @getVolume)
    .on('set', @setVolume)

    volumeService = newAccessory.getService(Service.Lightbulb) unless volumeService?
    volumeService
    .getCharacteristic(Characteristic.On)
    # .on('get', @getMute)
    # .on('set', @setMute)
    .on('get', (callback) =>
      { value } = tvService.getCharacteristic(Characteristic.Active)
      @log.debug('(volumeService/On.get)', value)
      if value is 0 then callback(null, false) else callback(null, true))
    .on('set', (value, callback) =>
      @log.debug('(volumeService/On.set)', value)
      if tvService.getCharacteristic(Characteristic.Active).value is 0
        volumeService.getCharacteristic(Characteristic.On).updateValue(false)
        callback(null, value)
      else
        callback(null, not value))

    volumeService
    .getCharacteristic(Characteristic.Brightness)
    .on('get', @getVolume)
    .on('set', @setVolume)

    # TV Tuner
    configuredName = 'TV Tuner'
    displayName = configuredName.toLowerCase().replace(' ', '')
    firstTime = false
    unless svc = _.find(newAccessory.services, { displayName })
      firstTime = true
      svc = new Service.InputSource(displayName, 500)
      tvService.addLinkedService(svc)
      newAccessory.addService(svc)
    await @configureInputSource(svc, 'TUNER', configuredName, parseInt(500, 10), firstTime)

    # HDMI inputs
    for __, input of newAccessory.context.inputs.hdmi
      firstTime = false
      configuredName = "HDMI #{input.id}: #{input.name}"
      displayName = configuredName.toLowerCase().replace(' ', '')

      unless svc = _.find(newAccessory.services, { displayName })
        firstTime = true
        svc = new Service.InputSource(displayName, input.id)
        tvService.addLinkedService(svc)
        newAccessory.addService(svc)
      await @configureInputSource(svc, 'HDMI', configuredName, parseInt(input.id, 10), firstTime)

    # Apps
    for id, app of applications
      firstTime = false
      configuredName = "#{app.name}"
      displayName = configuredName.toLowerCase().replace(' ', '')
      unless svc = _.find(newAccessory.services, { displayName })
        firstTime = true
        svc = new Service.InputSource(displayName, app.id)
        tvService.addLinkedService(svc)
        newAccessory.addService(svc)
      await @configureInputSource(svc, 'APP', configuredName, 1000 + parseInt(id, 10), firstTime)

    tvEvent
    .on('INTO_STANDBY', () ->
      volumeService.getCharacteristic(Characteristic.On).updateValue(false)
      tvService
      .getCharacteristic(Characteristic.Active)
      .updateValue(Characteristic.Active.INACTIVE))
    .on('POWERING_ON', () ->
      volumeService.getCharacteristic(Characteristic.On).updateValue(true)
      tvService.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE))

    setInterval(@getPowerStatus, 5000)

    newAccessory.reachable = true

    @api.updatePlatformAccessories('homebridge-vieramatic', 'PanasonicVieraTV', [newAccessory])

  configureAccessory: (accessory) =>
    @log.debug('loading (from cache)', accessory.displayName)
    @accessories.push(accessory)

  # eslint-disable-next-line coffee/class-methods-use-this
  configureInputSource: (source, type, configuredName, identifier, firstTime) =>
    # eslint-disable-next-line default-case
    switch type
      when 'TUNER'
        if firstTime
          source.setCharacteristic(
            Characteristic.InputSourceType,
            Characteristic.InputSourceType.TUNER
          )
      when 'HDMI'
        if firstTime
          source.setCharacteristic(
            Characteristic.InputSourceType,
            Characteristic.InputSourceType.HDMI
          )

      when 'APP'
        source.setCharacteristic(
          Characteristic.InputSourceType,
          Characteristic.InputSourceType.APPLICATION
        )

    switch type
      when 'TUNER', 'HDMI'
        if firstTime
          source
          .setCharacteristic(
            Characteristic.CurrentVisibilityState,
            Characteristic.CurrentVisibilityState.SHOWN
          )
          .setCharacteristic(
            Characteristic.TargetVisibilityState,
            Characteristic.TargetVisibilityState.SHOWN
          )
      else
        if firstTime
          source
          .setCharacteristic(
            Characteristic.CurrentVisibilityState,
            Characteristic.CurrentVisibilityState.HIDDEN
          )
          .setCharacteristic(
            Characteristic.TargetVisibilityState,
            Characteristic.TargetVisibilityState.HIDDEN
          )

    if firstTime
      source
      .setCharacteristic(Characteristic.Identifier, identifier)
      .setCharacteristic(Characteristic.ConfiguredName, configuredName)
      .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)

    source
    .getCharacteristic(Characteristic.TargetVisibilityState)
    .on('set', (state, callback) =>
      source.getCharacteristic(Characteristic.CurrentVisibilityState).updateValue(state)
      callback())

  getMute: (callback) =>
    mute = await @device.getMute()
    @log.debug('(getMute)', mute)
    callback(null, mute)

  setMute: (mute, callback) =>
    await @device.setMute()
    @log.debug('(setMute)', mute)
    callback(null, not mute)

  setVolume: (value, callback) =>
    @log.debug('(setVolume)', value)
    await @device.setVolume(value)
    callback(null, value)

  getVolume: (callback) =>
    volume = await @device.getVolume()
    @log.debug('(getVolume)', volume)
    callback(null, volume)

  getPowerStatus: (callback) =>
    # @log.debug('(getPowerStatus)')
    # eslint-disable-next-line coffee/no-inner-declarations
    if callback?
      # eslint-disable-next-line coffee/no-inner-declarations
      fn = (bool) -> callback(null, bool)
    else
      fn = (bool) -> bool

    powerStateSub = await new UpnpSub(@device.ipAddress, 55000, '/nrc/event_0')

    powerStateSub.on('message', (message) =>
      screenState = await findVal(message.body['e:propertyset']['e:property'], 'X_ScreenState')

      up = () =>
        tvEvent.emit('POWERING_ON')
        @poweredOn = true
        fn(true)
      down = () =>
        tvEvent.emit('INTO_STANDBY')
        @poweredOn = false
        fn(false)

      if screenState is 'none' or screenState is null or screenState is undefined
        @log.warn(
          "Couldn't check power state. Your TV may not be correctly set up or it
          may be incapable of performing power on from standby."
        )
        if screenState is 'none' then up() else down()
      # eslint-disable-next-line prettier/prettier
      else if screenState is 'on' then up() else down())

    powerStateSub.on('error', (err) =>
      @log.error(
        "Couldn't check power state. Please check your TV's network connection.
        Alternatively, your TV may not be correctly set up or it may not be able
        to perform power on from standby.",
        err
      )
      false)

    setTimeout(powerStateSub.unsubscribe, 900)

  setPowerStatus: (turnOn, callback) =>
    @log.debug('(setPowerStatus)', turnOn, @poweredOn)
    if (turnOn is 1 and @poweredOn is true) or (turnOn is 0 and @poweredOn is false)
      if turnOn then str = 'ON' else str = 'on STANDBY'
      @log.debug('TV is already %s: Ignoring!', str)
    else
      if turnOn then str = 'ON' else str = 'OFF'
      @log.debug('Powering TV %s...', str)
      if _.isError(await @device.sendCommand('POWER'))
        return callback(new Error('unable to power cycle TV - probably without power'))
      @poweredOn = not @poweredOn
    callback()

  remoteControl: (keyId, callback) =>
    # https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit-TV.ts#L235
    # eslint-disable-next-line default-case
    switch keyId
      when 0 # Rewind
        cmd = 'REW'
      when 1 # Fast Forward
        cmd = 'FF'
      when 2 # Next Track
        cmd = 'SKIP_NEXT'
      when 3 # Previous Track
        cmd = 'SKIP_PREV'
      when 4 # Up Arrow
        cmd = 'UP'
      when 5 # Down Arrow
        cmd = 'DOWN'
      when 6 # Left Arrow
        cmd = 'LEFT'
      when 7 # Right Arrow
        cmd = 'RIGHT'
      when 8 # Select
        cmd = 'ENTER'
      when 9 # Back
        cmd = 'RETURN'
      when 10 # Exit
        cmd = 'CANCEL'
      when 11 # Play / Pause
        cmd = 'PLAY'
      when 15 # Information
        cmd = 'HOME'

    @log.debug(cmd)
    await @device.sendCommand(cmd)
    callback(null, keyId)

  setInput: (value, callback) =>
    # eslint-disable-next-line default-case
    switch
      when value < 100
        @log.debug('(setInput) switching to HDMI INPUT ', value)
        await @device.sendHDMICommand(value)
      when value > 999
        real = value - 1000
        app = @applications[real]
        @log.debug('(setInput) switching to App', app.name)
        await @device.sendAppCommand(app.id)
      when value is 500
        @log.debug('(setInput) switching to internal TV tunner')
        await @device.sendCommand('AD_CHANGE')

    callback(null, value)

module.exports = Vieramatic
