# > required **external dependencies**
require('string-methods-extension')
_ = require('lodash')
axios = require('axios')
printf = require('util').format
crypto = require('crypto')
readlineSync = require('readline-sync')
isPortReachable = require('is-port-reachable')

# helpers and default settings
axios.default.timeout = 1000
defaultAudioChannel = '<InstanceID>0</InstanceID><Channel>Master</Channel>'

findValue = (xml, tag) ->
  new RegExp("<#{tag}>(?<found>.*)</#{tag}>", 'gmu').exec(xml)?.groups?.found

class Viera
  # Constructor
  constructor: (ipAddress, log = console, appId = null, encKey = null) ->
    # it's up to the consumer check that the supplied IP address is a valid one
    [@ipAddress, @port, @log, @_appId, @_encKey] = [ipAddress, 55000, log, appId, encKey]

    @baseURL = "http://#{@ipAddress}:#{@port}"

  isReachable: () =>
    isPortReachable(@port, { host: @ipAddress })

  needsCrypto: () =>
    axios
    .get("#{@baseURL}/nrc/sdd_0.xml")
    .then((reply) -> if reply.data.match(/X_GetEncryptSessionId/u) then true else false)
    .catch(() -> false)

  isTurnedOn: () =>
    # this endpoint is only available if TV is turned ON, otherwise we get a 400...
    axios
    .get("#{@baseURL}/pac/ddd.xml")
    .then(() -> true)
    .catch(() -> false)

  renderSampleConfig: () ->
    sample = {
      platform: 'PanasonicVieraTV',
      tvs: [
        {
          ipAddress: @ipAddress,
          appId: @_appId if @_appId?,
          encKey: @_encKey if @_encKey?,
          hdmiInputs: []
        }
      ]
    }

    @log.info(
      "\nPlease add the snippet bellow inside the 'platforms' array of your
      homebridge's 'config.json'\n%s\n",
      JSON.stringify(sample, null, 4)
    )

  setup: () ->
    unless await @isReachable()
      @log.error(
        printf(
          "\nUnable to reach (timeout) Viera TV at supplied IP ('%s').\n
          \n- Either the supplied IP is wrong, the TV is not connected to the network,
              or hasn't power.
          \n- It is a Panasonic TV, right ?...\n",
          @ipAddress
        )
      )
      process.exitCode = 1
      return

    [err, specs] = await @getSpecs()
    if err
      @log.error(
        "An unexpected error happened while fetching TV metadata. Please do make sure that the
        TV is powered on and NOT in stand-by.
        \n\n\n'#{err}'"
      )
      process.exitCode = 1
      return

    @specs = specs
    return @renderSampleConfig() unless @specs.requiresEncryption

    [err, __] = await @requestPinCode()
    if err
      @log.error(
        '\nAn unexpected error ocurred while attempting to request a pin code from the TV.',
        '\nPlease make sure that the TV is powered ON (and NOT in standby).'
      )
      process.exitCode = 1
      return

    pin = readlineSync.question('Enter the displayed pin code: ')
    [err, __] = await @authorizePinCode(pin)

    return @renderSampleConfig() unless err

    @log.error('Wrong pin code...')
    process.exitCode = 1

  requestPinCode: () ->
    params = '<X_DeviceName>MyRemote</X_DeviceName>'
    callback = (__, data) =>
      match = /<X_ChallengeKey>(\S*)<\/X_ChallengeKey>/gmu.exec(data)

      unless match
        return [new Error('unexpected reply from TV when requesting challenge key'), null]

      @_challenge = Buffer.from(match[1], 'base64')
      return [null, null]

    @sendRequest('command', 'X_DisplayPinCode', params, callback)

  deriveSessionKeys: () ->
    iv = Buffer.from(@_encKey, 'base64')
    @_sessionIV = iv

    keyVals = Buffer.alloc(16)
    for i in [0...16] by 4
      keyVals[i] = iv[i + 2]
      keyVals[i + 1] = iv[i + 3]
      keyVals[i + 2] = iv[i]
      keyVals[i + 3] = iv[i + 1]

    [@_sessionKey, @_sessionHmacKey] = [Buffer.from(keyVals), Buffer.concat([iv, iv])]

  requestSessionId: () ->
    appId = "<X_ApplicationId>#{@_appId}</X_ApplicationId>"
    encinfo = @encryptPayload(appId)
    params = "<X_ApplicationId>#{@_appId}</X_ApplicationId> <X_EncInfo>#{encinfo}</X_EncInfo>"
    callback = (__, data) =>
      [@_sessionId, @_sessionSeqNum] = [findValue(data, 'X_SessionId'), 1]
      [null, null]

    @sendRequest('command', 'X_GetEncryptSessionId', params, callback)

  decryptPayload: (string, key = @_sessionKey, iv = @_sessionIV) ->
    decipher = crypto.createDecipheriv('aes-128-cbc', key, iv).setAutoPadding(false)
    Buffer.concat([decipher.update(string, 'base64'), decipher.final()])
    .toString('binary')
    .substr(16)
    .split('\0')[0]

  encryptPayload: (string, key = @_sessionKey, iv = @_sessionIV, hmacKey = @_sessionHmacKey) ->
    pad = (unpadded) ->
      blockSize = 16
      extra = Buffer.alloc(blockSize - (unpadded.length % blockSize))
      Buffer.concat([unpadded, extra])

    data = Buffer.from(string)
    headerPrefix = Buffer.from([...(_.random(0, 255) for __ in [0..11])])
    headerSufix = Buffer.alloc(4)
    headerSufix.writeIntBE(data.length, 0, 4)

    header = Buffer.concat([headerPrefix, headerSufix])

    payload = pad(Buffer.concat([header, data]))
    cipher = crypto.createCipheriv('aes-128-cbc', key, iv).setAutoPadding(false)
    ciphered = Buffer.concat([cipher.update(payload), cipher.final()])

    hmac = crypto.createHmac('sha256', hmacKey)
    sig = hmac.update(ciphered).digest()

    Buffer.concat([ciphered, sig]).toString('base64')

  authorizePinCode: (pin) ->
    [iv, key, hmacKey] = [@_challenge, Buffer.alloc(16), Buffer.alloc(32)]

    for i in [0...16] by 4
      key[i] = ~iv[i + 3] & 0xff
      key[i + 1] = ~iv[i + 2] & 0xff
      key[i + 2] = ~iv[i + 1] & 0xff
      key[i + 3] = ~iv[i] & 0xff

    # Derive HMAC key from IV & HMAC key mask (taken from libtvconnect.so)
    hmacKeyMaskVals = [
      # eslint-disable-next-line prettier/prettier
      0x15, 0xc9, 0x5a, 0xc2, 0xb0, 0x8a, 0xa7, 0xeb, 0x4e, 0x22, 0x8f, 0x81, 0x1e, 0x34, 0xd0, 0x4f,
      # eslint-disable-next-line prettier/prettier
      0xa5, 0x4b, 0xa7, 0xdc, 0xac, 0x98, 0x79, 0xfa, 0x8a, 0xcd, 0xa3, 0xfc, 0x24, 0x4f, 0x38, 0x54
    ]

    for j in [0...32] by 4
      hmacKey[j] = hmacKeyMaskVals[j] ^ iv[(j + 2) & 0xf]
      hmacKey[j + 1] = hmacKeyMaskVals[j + 1] ^ iv[(j + 3) & 0xf]
      hmacKey[j + 2] = hmacKeyMaskVals[j + 2] ^ iv[j & 0xf]
      hmacKey[j + 3] = hmacKeyMaskVals[j + 3] ^ iv[(j + 1) & 0xf]

    data = "<X_PinCode>#{pin}</X_PinCode>"
    encryptedPayload = @encryptPayload(data, key, iv, hmacKey)
    params = "<X_AuthInfo>#{encryptedPayload}</X_AuthInfo>"
    callback = (__, reply) =>
      match = findValue(reply, 'X_AuthResult')

      return [new Error(printf('unexpected reply from TV (%s)', reply)), null] if match is null

      authResultDecrypted = @decryptPayload(match, key, iv, hmacKey)
      @_appId = findValue(authResultDecrypted, 'X_ApplicationId')
      @_encKey = findValue(authResultDecrypted, 'X_Keyword')

      if @_appId is null or @_encKey is null
        return [new Error(printf('unexpected reply from TV (%s)', authResultDecrypted)), null]
      return [null, null]

    @sendRequest('command', 'X_RequestAuth', params, callback)

  #
  renderEncryptedRequest: (action, urn, params) ->
    @_sessionSeqNum += 1
    encCommand = printf(
      '
        <X_SessionId>%s</X_SessionId>
        <X_SequenceNumber>%s</X_SequenceNumber>
        <X_OriginalCommand>
          <u:%s xmlns:u="urn:%s">
            %s
          </u:%s>
        </X_OriginalCommand>
      ',
      @_sessionId,
      "00000000#{@_sessionSeqNum}".slice(-8),
      action,
      urn,
      params,
      action
    )
    encryptedPayload = @encryptPayload(encCommand)

    return [
      'X_EncryptedCommand',
      printf(
        '
          <X_ApplicationId>%s</X_ApplicationId>
          <X_EncInfo>%s</X_EncInfo>
        ',
        @_appId,
        encryptedPayload
      )
    ]

  #
  renderRequest: (action, urn, params) ->
    method = 'post'
    responseType = 'text'

    headers = {
      Host: "#{@ipAddress}:#{@port}",
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: "\"urn:#{urn}##{action}\"",
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Accept: 'text/xml'
    }

    data = printf(
      '
        <?xml version="1.0" encoding="utf-8"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
          <s:Body>
            <u:%s xmlns:u="urn:%s">
              %s
            </u:%s>
          </s:Body>
        </s:Envelope>
      ',
      action,
      urn,
      params,
      action
    )

    return { method, headers, data, responseType }

  # Create and send request to the TV
  sendRequest: (type, realAction, realParams = 'None', callback) ->
    neverEncrypted = ['X_GetEncryptSessionId', 'X_DisplayPinCode', 'X_RequestAuth']
    [url, urn] = [undefined, undefined]

    # eslint-disable-next-line default-case
    switch type
      when 'command'
        [url, urn] = ['/nrc/control_0', 'panasonic-com:service:p00NetworkControl:1']
      when 'render'
        [url, urn] = ['/dmr/control_0', 'schemas-upnp-org:service:RenderingControl:1']

    if @specs.requiresEncryption and type is 'command' and not (realAction in neverEncrypted)
      [action, params] = await @renderEncryptedRequest(realAction, urn, realParams)
    else
      [action, params] = [realAction, realParams]

    payload =
      await axios("#{@baseURL}#{url}", @renderRequest(action, urn, params))
      .then((r) =>
        if action in ['X_GetEncryptSessionId', 'X_EncryptedCommand']
          output = @decryptPayload(findValue(r.data, 'X_EncResult'))
        else
          output = r.data
        return output
      )
      .catch((err) -> err)

    return [payload, null] if _.isError(payload)

    unless callback? then [null, payload] else callback(null, payload)

  # Send a command to the TV
  sendCommand: (cmd) ->
    params = "<X_KeyEvent>NRC_#{cmd.toUpperCase()}-ONOFF</X_KeyEvent>"

    @sendRequest('command', 'X_SendKey', params)

  # Send a change HDMI input to the TV
  sendHDMICommand: (hdmiInput) ->
    params = "<X_KeyEvent>NRC_HDMI#{hdmiInput}-ONOFF</X_KeyEvent>"

    @sendRequest('command', 'X_SendKey', params)

  # Send command to open app on the TV
  sendAppCommand: (appId) ->
    @log.debug('appId=', appId)

    cmd = if "#{appId}".length is 16 then "product_id=#{appId}" else "resource_id=#{appId}"
    params = "<X_AppType>vc_app</X_AppType><X_LaunchKeyword>#{cmd}</X_LaunchKeyword>"

    @sendRequest('command', 'X_LaunchApp', params)

  # Get volume from TV
  getVolume: () ->
    params = defaultAudioChannel
    callback = (__, data) ->
      match = /<CurrentVolume>(\d*)<\/CurrentVolume>/gmu.exec(data)
      return [null, match[1]] if match

    @sendRequest('render', 'GetVolume', params, callback)

  # Set volume
  setVolume: (volume) ->
    return [new Error('Volume must be in range from 0 to 100'), null] if volume < 0 or volume > 100

    params = "#{defaultAudioChannel}<DesiredVolume>#{volume}</DesiredVolume>"

    @sendRequest('render', 'SetVolume', params)

  # Get the current mute setting
  getMute: () ->
    params = defaultAudioChannel
    callback = (__, data) ->
      regex = /<CurrentMute>([0-1])<\/CurrentMute>/gmu
      match = regex.exec(data)
      return [null, match[1]] is '1' if match

    @sendRequest('render', 'GetMute', params, callback)

  # Set mute to on/off
  setMute: (enable) ->
    mute = if enable then '1' else '0'
    params = "#{defaultAudioChannel}<DesiredMute>#{mute}</DesiredMute>"

    @sendRequest('render', 'SetMute', params)

  # Returns the list of apps on the TV
  getApps: () ->
    callback = (__, data) ->
      [apps, raw] = [[], await findValue(data, 'X_AppList')]
      if raw?
        xml = raw.decodeXML()
        re = /'product_id=(?<id>(\d|[A-Z])+)'(?<appName>([^'])+)/gmu
        # eslint-disable-next-line coffee/no-cond-assign
        apps.push({ name: match.groups.appName, id: match.groups.id }) while match = re.exec(xml)

      return [null, apps] unless apps.length is 0
      [new Error('Unable to fetch apps from TV as it is in standby'), null]

    @sendRequest('command', 'X_GetAppList', null, callback)

  # Returns the TV specs
  getSpecs: () ->
    specs =
      await axios
      .get("#{@baseURL}/nrc/ddd.xml")
      .then((r) ->
        {
          friendlyName: findValue(r.data, 'friendlyName'),
          modelName: findValue(r.data, 'modelName'),
          modelNumber: findValue(r.data, 'modelNumber'),
          manufacturer: findValue(r.data, 'manufacturer'),
          serialNumber: findValue(r.data, 'UDN').slice(5)
        }
      )
      .catch((err) -> err)

    return [specs, null] if _.isError(specs)

    specs.requiresEncryption = await @needsCrypto()
    extra = if specs.requiresEncryption then '(requires crypto for comunication)' else ''
    @log.info(
      'found a %s TV (%s) at %s %s.\n',
      specs.modelName,
      specs.modelNumber,
      @ipAddress,
      extra
    )
    return [null, specs]

#
# ## Public API
# --------
module.exports = Viera
