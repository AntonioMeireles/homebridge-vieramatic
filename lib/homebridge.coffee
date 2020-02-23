### global Service Characteristic Accessory ###

# homebridge vieramatic plugin

# > required **external dependencies**
events = require('events')
net = require('net')
_ = require('lodash')
{ Mutex } = require('async-mutex')

# > required **internal dependencies**
Viera = require('./viera')
Storage = require('./storage')

# helpers
sleep = (ms) -> new Promise((resolve) -> setTimeout(resolve, ms))

iterator = (tvs) ->
  for own __, viera of tvs
    if net.isIPv4(viera.ipAddress)
      viera.hdmiInputs = [] unless viera.hdmiInputs?
      yield viera
    else
      # eslint-disable-next-line no-console
      console.error('Ignoring %s as this is NOT a valid IP address!')

validateCryptoNeeds = (tv) ->
  return null unless tv.specs.requiresEncryption
  return new Error(
    "Ignoring TV at #{tv.ipAddress} as it requires encryption but no credentials were
    supplied."
  ) unless tv._appId? and tv._encKey?
  await tv.deriveSessionKeys()
  [err, __] = await tv.requestSessionId()
  return err

class Vieramatic
  [tvEvent, mutex] = [new events.EventEmitter(), new Mutex()]

  constructor: (log, config, api) ->
    log.info('Vieramatic Init')

    [@log, @api, @previousAccessories] = [log, api, []]

    @config = {
      tvs: config?.tvs or []
    }
    @storage = new Storage(api)
    @storage.init()

    for own cached of @previousAccessories
      @api.unregisterPlatformAccessories('homebridge-vieramatic', 'PanasonicVieraTV', [cached])

    @api.on('didFinishLaunching', @init) if @api

  init: () =>
    for viera from iterator(@config.tvs)
      tv = new Viera(viera.ipAddress, @log, viera.appId, viera.encKey)

      unless await tv.isReachable()
        @log.error(
          "Ignoring TV (at '#{tv.ipAddress}') as it is unreachable. Likely to be powered off."
        )
        continue

      # eslint-disable-next-line coffee/no-constant-condition
      loop
        [err, specs] = await tv.getSpecs()
        break unless err
        @log.warn(
          "An unexpected error happened while fetching TV metadata. Please do make sure that the
          TV is powered on and NOT in stand-by.\n\n\n#{err}\n\n\nTrying again in 10s."
        )
        sleep(10000)

      tv.specs = specs

      @log.debug(tv)

      err = await validateCryptoNeeds(tv)
      unless err
        try
          await @addAccessory(tv, viera.hdmiInputs)
        catch Err
          err = new Error(
            "An unexpected error happened while adding Viera TV (at '#{tv.ipAddress}')
            as an homebridge Accessory.\n\n\n#{Err}"
          )
      @log.error(err) if err

    @log.info('DidFinishLaunching')

  setupNewAccessory: () ->
    { friendlyName, serialNumber, modelName, modelNumber, manufacturer } = @device.specs

    accessory = new Accessory(friendlyName, serialNumber)
    accessory.on('identify', (paired, callback) =>
      @log.debug(friendlyName, 'Identify!!!')
      callback())

    accessoryInformation = accessory.getService(Service.AccessoryInformation)
    accessoryInformation
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.Model, "#{modelName} #{modelNumber}")
    .setCharacteristic(Characteristic.SerialNumber, serialNumber)
    .setCharacteristic(Characteristic.Name, friendlyName)

    return accessory

  setupSpeakerService: (friendlyName) ->
    speakerService = new Service.TelevisionSpeaker("#{friendlyName} Volume", 'volumeService')

    speakerService.addCharacteristic(Characteristic.Volume)
    speakerService.addCharacteristic(Characteristic.Active)
    speakerService.setCharacteristic(
      Characteristic.VolumeControlType,
      Characteristic.VolumeControlType.ABSOLUTE
    )

    speakerService
    .getCharacteristic(Characteristic.Mute)
    .on('get', @getMute)
    .on('set', @setMute)
    speakerService
    .getCharacteristic(Characteristic.Volume)
    .on('get', @getVolume)
    .on('set', @setVolume)

    return speakerService

  newAccessoryPreflight: (hdmiInputs) ->
    { serialNumber } = @device.specs
    handler = {
      get: (target, key) ->
        if key is 'isProxy' then return true
        prop = target[key]
        if typeof prop is 'undefined' then return
        # eslint-disable-next-line no-param-reassign
        if not prop.isProxy and typeof prop is 'object' then target[key] = new Proxy(prop, handler)
        target[key]
      set: (target, key, value) =>
        # eslint-disable-next-line no-param-reassign
        target[key] = value
        @storage.save()
        return true
    }
    @device.storage = new Proxy(@storage.get(serialNumber), handler)

    unless @device.storage.data?
      @log.debug("Initializing '#{@device.specs.friendlyName}' for the first time.")
      # eslint-disable-next-line coffee/no-constant-condition
      loop
        [err, apps] = await @device.getApps()
        break unless err

        @log.warn(
          'Unable to fetch Application list from TV (as it seems to be in standby).
          Trying again in 5s.'
        )
        sleep(5000)

      @applications = apps

      @device.storage.data = {
        inputs: {
          hdmi: hdmiInputs,
          applications: { ...@applications }
        }
        specs: { ...@device.specs }
      }
    else
      @log.debug("Restoring '#{@device.specs.friendlyName}'.")
      [err, apps] = await @device.getApps()
      if err
        @log.debug("#{err.message}, getting previously cached ones instead")
        @applications = @device.storage.data.inputs.applications
      else
        @applications = apps

      for own i, input of hdmiInputs
        idx = _.findIndex(@device.storage.data.inputs.hdmi, ['id', input.id.toString()])
        unless idx < 0
          if @device.storage.data.inputs.hdmi[idx].hiden?
            # eslint-disable-next-line no-param-reassign
            hdmiInputs[i].hiden = @device.storage.data.inputs.hdmi[idx].hiden

  addAccessory: (tv, hdmiInputs) =>
    [@device, @applications] = [_.cloneDeep(tv), []]
    { friendlyName } = @device.specs

    await @newAccessoryPreflight(hdmiInputs)

    newAccessory = await @setupNewAccessory()

    tvService = new Service.Television(friendlyName, 'Television')
    tvService
    .setCharacteristic(Characteristic.ConfiguredName, friendlyName)
    .setCharacteristic(Characteristic.SleepDiscoveryMode, 1)
    tvService.addCharacteristic(Characteristic.RemoteKey)
    tvService.addCharacteristic(Characteristic.PowerModeSelection)
    newAccessory.addService(tvService)

    speakerService = @setupSpeakerService(friendlyName)
    tvService.addLinkedService(speakerService)
    newAccessory.addService(speakerService)

    customSpeakerService = new Service.Fan("#{friendlyName} Volume", 'VolumeAsFanService')
    tvService.addLinkedService(customSpeakerService)
    newAccessory.addService(customSpeakerService)

    tvService
    .getCharacteristic(Characteristic.Active)
    .on('get', @getPowerStatus)
    .on('set', @setPowerStatus)

    tvService.getCharacteristic(Characteristic.RemoteKey).on('set', @remoteControl)
    tvService.getCharacteristic(Characteristic.ActiveIdentifier).on('set', @setInput)
    tvService
    .getCharacteristic(Characteristic.PowerModeSelection)
    .on('set', (value, callback) =>
      [err, __] = await @device.sendCommand('MENU')
      if err then callback(err, null) else callback(null, value))

    customSpeakerService
    .getCharacteristic(Characteristic.On)
    .on('get', (callback) =>
      { value } = tvService.getCharacteristic(Characteristic.Active)
      @log.debug('(customSpeakerService/On.get)', value)
      callback(null, value))
    .on('set', (value, callback) =>
      @log.debug('(customSpeakerService/On.set)', value)
      if tvService.getCharacteristic(Characteristic.Active).value is 0
        customSpeakerService.getCharacteristic(Characteristic.On).updateValue(false)
        callback(null, value)
      else
        callback(null, not value))

    customSpeakerService
    .getCharacteristic(Characteristic.RotationSpeed)
    .on('get', @getVolume)
    .on('set', @setVolume)

    # TV Tuner
    configuredName = 'TV Tuner'
    displayName = configuredName.toLowerCase().replace(' ', '')

    svc = new Service.InputSource(displayName, 500)
    tvService.addLinkedService(svc)
    newAccessory.addService(svc)
    await @configureInputSource(svc, 'TUNER', configuredName, parseInt(500, 10))

    # HDMI inputs
    for own __, input of hdmiInputs
      configuredName = input.name
      displayName = configuredName.toLowerCase().replace(' ', '')

      if _.find(newAccessory.services, { displayName })
        @log.error('ignored duplicated entry in HDMI inputs list...')
      else
        svc = new Service.InputSource(displayName, input.id)
        tvService.addLinkedService(svc)
        newAccessory.addService(svc)
        await @configureInputSource(svc, 'HDMI', configuredName, parseInt(input.id, 10))

    # Apps
    for own id, app of @applications
      configuredName = app.name
      displayName = configuredName.toLowerCase().replace(' ', '')
      svc = new Service.InputSource(displayName, app.id)
      tvService.addLinkedService(svc)
      newAccessory.addService(svc)
      await @configureInputSource(svc, 'APPLICATION', configuredName, 1000 + parseInt(id, 10))

    tvEvent
    .on('INTO_STANDBY', () =>
      @updateTVstatus(false, tvService, speakerService, customSpeakerService))
    .on('POWERED_ON', () => @updateTVstatus(true, tvService, speakerService, customSpeakerService))

    initialStatus = await @device.isTurnedOn()
    if initialStatus then tvEvent.emit('POWERED_ON') else tvEvent.emit('INTO_STANDBY')

    setInterval(@getPowerStatus, 5000)

    newAccessory.reachable = true

    @api.publishExternalAccessories('homebridge-vieramatic', [newAccessory])

  configureAccessory: (tv) =>
    @previousAccessories.push(tv)

  configureInputSource: (source, type, configuredName, identifier) =>
    visibility = () =>
      hiden = 0
      { inputs } = @device.storage.data
      # eslint-disable-next-line default-case
      switch type
        when 'HDMI'
          idx = _.findIndex(inputs.hdmi, ['id', identifier.toString()])
          if inputs.hdmi[idx].hiden?
            { hiden } = inputs.hdmi[idx]
          else
            inputs.hdmi[idx].hiden = hiden
        when 'APPLICATION'
          real = identifier - 1000
          if inputs.applications[real].hiden?
            { hiden } = inputs.applications[real]
          else
            inputs.applications[real].hiden = 1
            hiden = 1
        when 'TUNER'
          if inputs.TUNER?
            { hiden } = inputs.TUNER
          else
            inputs.TUNER = { hiden }

      return hiden

    hiden = await visibility()
    source
    .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType[type])
    .setCharacteristic(Characteristic.CurrentVisibilityState, hiden)
    .setCharacteristic(Characteristic.TargetVisibilityState, hiden)
    .setCharacteristic(Characteristic.Identifier, identifier)
    .setCharacteristic(Characteristic.ConfiguredName, configuredName)
    .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)

    source
    .getCharacteristic(Characteristic.TargetVisibilityState)
    .on('set', (state, callback) =>
      id = source.getCharacteristic(Characteristic.Identifier).value
      { inputs } = @device.storage.data
      # eslint-disable-next-line default-case
      switch
        when id < 100
          # hdmi input
          idx = _.findIndex(inputs.hdmi, ['id', id.toString()])
          inputs.hdmi[idx].hiden = state
        when id > 999
          real = id - 1000
          inputs.applications[real].hiden = state
        when id is 500
          inputs.TUNER = { hiden: state }

      source.getCharacteristic(Characteristic.CurrentVisibilityState).updateValue(state)
      callback())

  getMute: (callback) =>
    status = await @device.isTurnedOn()
    return [null, true] unless status

    [err, mute] = await @device.getMute()
    if err
      callback(null, true)
    else
      @log.debug('(getMute)', mute)
      callback(null, mute)

  setMute: (mute, callback) =>
    @log.debug('(setMute)', mute)
    [err, __] = await @device.setMute(mute)
    if err then callback(err, null) else callback(null, not mute)

  setVolume: (value, callback) =>
    @log.debug('(setVolume)', value)
    [err, __] = await @device.setVolume(value)
    if err then callback(err, null) else callback(null, value)

  getVolume: (callback) =>
    [err, volume] = await @device.getVolume()
    if err
      callback(err, null)
    else
      @log.debug('(getVolume)', volume)
      callback(null, volume)

  # eslint-disable-next-line coffee/class-methods-use-this
  updateTVstatus: (powered, tvService, speakerService, customSpeakerService) ->
    active = Characteristic.Active
    [speakerStatus, tvStatus] = if powered then [true, active.ACTIVE] else [false, active.INACTIVE]

    speakerService.getCharacteristic(active).updateValue(tvStatus)
    customSpeakerService.getCharacteristic(Characteristic.On).updateValue(speakerStatus)
    tvService.getCharacteristic(active).updateValue(tvStatus)
    unless powered
      speakerService.getCharacteristic(Characteristic.Mute).updateValue(true)
    else
      [__, mute] = await @device.getMute()
      speakerService.getCharacteristic(Characteristic.Mute).updateValue(mute)

  getPowerStatus: (callback) =>
    mutex.runExclusive(() =>
      status = await @device.isTurnedOn()
      if status then tvEvent.emit('POWERED_ON') else tvEvent.emit('INTO_STANDBY')
      if callback? then callback(null, status) else status
    )

  setPowerStatus: (turnOn, callback) =>
    poweredOn = await @device.isTurnedOn()
    @log.debug('(setPowerStatus)', turnOn, poweredOn)
    if turnOn is 1 then str = 'ON' else str = 'into STANDBY'
    if (turnOn is 1 and poweredOn) or (turnOn is 0 and not poweredOn)
      @log.debug('TV is already %s: Ignoring!', str)
    else
      [err, __] = await @device.sendCommand('POWER')
      if err
        return callback(new Error('unable to power cycle TV - probably without power'))
      if turnOn is 1 then tvEvent.emit('POWERED_ON') else tvEvent.emit('INTO_STANDBY')
      @log.debug('Turned TV %s', str)
    # FIXME revise callback handling here
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
    [err, __] = await @device.sendCommand(cmd)
    if err then callback(err, null) else callback(null, keyId)

  setInput: (value, callback) =>
    fn = () =>
      switch
        when value < 100
          @log.debug('(setInput) switching to HDMI INPUT ', value)
          @device.sendHDMICommand(value)
        when value > 999
          real = value - 1000
          app = @applications[real]
          @log.debug('(setInput) switching to App', app.name)
          @device.sendAppCommand(app.id)
        when value is 500
          @log.debug('(setInput) switching to internal TV tunner')
          @device.sendCommand('AD_CHANGE')
        else
          err = new Error("Supported values are < 100, > 999 or 500, #{value} is neither")
          @log.error(err)
          [err, null]

    [err, __] = await fn()
    if err then callback(err, null) else callback(null, value)

#
# ## Public API
# --------
module.exports = Vieramatic
