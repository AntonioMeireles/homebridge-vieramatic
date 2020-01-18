require('string-methods-extension')
_ = require('lodash')
net = require('net')
axios = require('axios')
printf = require('util').format
crypto = require('crypto')
readline = require('readline')
UPnPClient = require('node-upnp')

axios.default.timeout = 1000

findValue = (xml, tag) ->
  new RegExp("<#{tag}>(?<found>...*)</#{tag}>", 'gmu').exec(xml).groups.found

class Viera
  # Constructor
  constructor: (ipAddress, appId, encKey) ->
    unless net.isIPv4(ipAddress)
      throw new TypeError('You entered an invalid IP address!')

    [@ipAddress, @port] = [ipAddress, 55000]

    @baseURL = "http://#{@ipAddress}:#{@port}"

    if appId and encKey
      [@_appId, @_encKey, @encrypted] = [appId, encKey, true]

  setup: () ->
    renderSampleCfg = () =>
      cfg = {
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

      console.log(
        "\nPlease add the snippet bellow inside the 'platforms' array of your
        homebridge's 'config.json'\n"
      )
      console.log(JSON.stringify(cfg, null, 4), '\n')

    @getSpecs()
    .then(() =>
      if @encrypted
        @requestPinCode().then(() =>
          rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          })

          rl.question('Enter the displayed pin code: ', (answer) =>
            @authorizePinCode(answer)
            .then(() ->
              renderSampleCfg()
            )
            .finally(() -> rl.close()))
        )
      else
        renderSampleCfg()
    )
    .catch((error) =>
      switch
        when error.message?.match(/timeout of/gu)
          err = new Error(
            printf('unable to reach (timeout) Viera TV at supplied IP (%s)', @ipAddress)
          )
        when error.response?.status is 500 and error.response.data.match(/Precondition failed/gu)
          err = new Error(
            printf(
              'Viera TV at supplied IP (%s) is not powered ON. Please power it ON and try again',
              @ipAddress
            )
          )
        else
          err = new Error(
            printf(
              "supplied IP (%s) doesn't seem to be from a Panasonic Viera TV (%s)",
              @ipAddress,
              error
            )
          )
      process.exitCode = 1
      console.error(err.message)
    )

  requestPinCode: () ->
    if @encrypted
      @sendRequest(
        'command',
        'X_DisplayPinCode',
        '<X_DeviceName>My Remote</X_DeviceName>',
        {
          callback: (data) =>
            match = /<X_ChallengeKey>(\S*)<\/X_ChallengeKey>/gmu.exec(data)
            unless match is null
              @_challenge = Buffer.from(match[1], 'base64')
            else
              throw new Error('unexpected reply from TV when requesting challenge key')
        }
      ).catch((err) -> throw err)

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
    encinfo = @encryptPayload(
      "<X_ApplicationId>#{@_appId}</X_ApplicationId>",
      @_sessionKey,
      @_sessionIV,
      @_sessionHmacKey
    )
    params = "<X_ApplicationId>#{@_appId}</X_ApplicationId> <X_EncInfo>#{encinfo}</X_EncInfo>"

    @sendRequest(
      'command',
      'X_GetEncryptSessionId',
      params,
      {
        callback: (data) => [@_sessionId, @_sessionSeqNum] = [findValue(data, 'X_SessionId'), 1]
      }
    ).catch((err) -> err)

  # eslint-disable-next-line coffee/class-methods-use-this
  decryptPayload: (string, key, iv) ->
    decipher = crypto.createDecipheriv('aes-128-cbc', key, iv).setAutoPadding(false)
    Buffer.concat([decipher.update(string, 'base64'), decipher.final()])
    .toString('binary')
    .substr(16)
    .split('\0')[0]

  # eslint-disable-next-line coffee/class-methods-use-this
  encryptPayload: (string, key, iv, hmacKey) ->
    pad = (unpadded) ->
      blockSize = 16
      extra = Buffer.alloc(blockSize - (_.size(unpadded) % blockSize))
      Buffer.concat([unpadded, extra])

    data = Buffer.from(string)

    headerPrefix = Buffer.from([...(_.random(0, 255) for __ in _.range(12))])
    headerSufix = Buffer.alloc(4)
    headerSufix.writeIntBE(_.size(data), 0, 4)

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

    for i in [0...32] by 4
      hmacKey[i] = hmacKeyMaskVals[i] ^ iv[(i + 2) & 0xf]
      hmacKey[i + 1] = hmacKeyMaskVals[i + 1] ^ iv[(i + 3) & 0xf]
      hmacKey[i + 2] = hmacKeyMaskVals[i + 2] ^ iv[i & 0xf]
      hmacKey[i + 3] = hmacKeyMaskVals[i + 3] ^ iv[(i + 1) & 0xf]

    data = "<X_PinCode>#{pin}</X_PinCode>"
    encryptedPayload = @encryptPayload(data, key, iv, hmacKey)
    params = "<X_AuthInfo>#{encryptedPayload}</X_AuthInfo>"
    @sendRequest('command', 'X_RequestAuth', params, {
      callback: (_data) =>
        match = findValue(_data, 'X_AuthResult')
        throw new Error(printf('unexpected reply from TV (%s)', _data)) if match is null
        authResultDecrypted = @decryptPayload(match, key, iv, hmacKey)
        if (@_appId = findValue(authResultDecrypted, 'X_ApplicationId')) is null
          throw new Error(printf('unexpected reply from TV (%s)', authResultDecrypted))
        if (@_encKey = findValue(authResultDecrypted, 'X_Keyword')) is null
          throw new Error(printf('unexpected reply from TV (%s)', authResultDecrypted))
    })

  # Create and send request to the TV

  # eslint-disable-next-line max-params
  sendRequest: (type, action, params, options) ->
    neverEncrypted = ['X_GetEncryptSessionId', 'X_DisplayPinCode', 'X_RequestAuth']

    unless params?
      # eslint-disable-next-line no-param-reassign
      params = 'None'

    [url, urn] = [undefined, undefined]

    # eslint-disable-next-line default-case
    switch type
      when 'command'
        [url, urn] = ['/nrc/control_0', 'panasonic-com:service:p00NetworkControl:1']
      when 'render'
        [url, urn] = ['/dmr/control_0', 'schemas-upnp-org:service:RenderingControl:1']

    if @encrypted and type is 'command' and not _.includes(neverEncrypted, action)
      unless @_sessionId?
        await @deriveSessionKeys()
        return err if _.isError((err = await @requestSessionId()))
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
      encryptedPayload = @encryptPayload(encCommand, @_sessionKey, @_sessionIV, @_sessionHmacKey)
      # eslint-disable-next-line no-param-reassign
      action = 'X_EncryptedCommand'
      # eslint-disable-next-line no-param-reassign
      params = printf(
        '
          <X_ApplicationId>%s</X_ApplicationId>
          <X_EncInfo>%s</X_EncInfo>
        ',
        @_appId,
        encryptedPayload
      )

    body = printf(
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

    # console.log body
    config = {
      method: 'post',
      headers: {
        Host: "#{@ipAddress}:#{@port}",
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: "\"urn:#{urn}##{action}\"",
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Accept: 'text/xml'
      }
      data: body,
      responseType: 'text'
    }
    if options?.callback?
      { callback } = options
    else
      # eslint-disable-next-line coffee/no-empty-function
      callback = () ->

    axios("#{@baseURL}#{url}", config)
    .then((r) =>
      if encCommand? or action is 'X_GetEncryptSessionId'
        payload = @decryptPayload(
          findValue(r.data, 'X_EncResult'),
          @_sessionKey,
          @_sessionIV,
          @_sessionHmacKey
        )
      else
        payload = r.data

      callback(payload)
    )
    .catch((_err) ->
      console.debug(_err)
      _err
    )

  # Send a command to the TV

  sendCommand: (cmd) ->
    @sendRequest('command', 'X_SendKey', "<X_KeyEvent>NRC_#{cmd.toUpperCase()}-ONOFF</X_KeyEvent>")

  # Send a change HDMI input to the TV

  sendHDMICommand: (hdmiInput) ->
    @sendRequest('command', 'X_SendKey', "<X_KeyEvent>NRC_HDMI#{hdmiInput}-ONOFF</X_KeyEvent>")

  # Send command to open app on the TV
  sendAppCommand: (appId) ->
    console.debug('appId=', appId, appId.toString().length)

    if "#{appId}".length != 16 then cmd = "resource_id=#{appId}" else cmd = "product_id=#{appId}"

    @sendRequest(
      'command',
      'X_LaunchApp',
      "<X_AppType>vc_app</X_AppType><X_LaunchKeyword>#{cmd}</X_LaunchKeyword>"
    )

  # Get volume from TV

  getVolume: () ->
    fn = (data) ->
      match = /<CurrentVolume>(\d*)<\/CurrentVolume>/gmu.exec(data)
      return match[1] unless _.isNull(match)

    @sendRequest(
      'render',
      'GetVolume',
      '<InstanceID>0</InstanceID><Channel>Master</Channel>',
      { callback: fn }
    ).catch((err) -> return err)

  # Set volume

  setVolume: (volume) ->
    if volume < 0 or volume > 100
      throw new Error('Volume must be in range from 0 to 100')
    @sendRequest(
      'render',
      'SetVolume',
      "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>#{volume}</DesiredVolume>"
    )

  # Get the current mute setting

  getMute: () ->
    fn = (data) =>
      regex = /<CurrentMute>([0-1])<\/CurrentMute>/gmu
      match = regex.exec(data)
      return match[1] is '1' unless _.isNull(match)

    @sendRequest('render', 'GetMute', '<InstanceID>0</InstanceID><Channel>Master</Channel>', {
      callback: fn
    })

  # Set mute to on/off

  setMute: (enable) ->
    mute = if enable then '1' else '0'
    @sendRequest(
      'render',
      'SetMute',
      "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>#{mute}</DesiredMute>"
    )

  # Returns the list of apps on the TV

  getApps: () ->
    apps = []
    @sendRequest(
      'command',
      'X_GetAppList',
      null,
      {
        callback: (data) ->
          raw = await findValue(data, 'X_AppList').decodeXML()
          re = /'product_id=(?<id>(\d|[A-Z])+)'(?<appName>([^'])+)/gmu
          while match = re.exec(raw)
            apps.push({ name: match.groups.appName, id: match.groups.id })
      }
    ).then(() -> apps)

  # Returns the TV specs

  getSpecs: () ->
    client = new UPnPClient({ url: "#{@baseURL}/dmr/ddd.xml" })

    client
    .getDeviceDescription()
    .then((specs) =>
      @specs = {
        friendlyName: specs.friendlyName,
        modelName: specs.modelName,
        modelNumber: specs.modelNumber,
        manufacturer: specs.manufacturer,
        serialNumber: specs.UDN.slice(5)
      }
      console.log('found a %s TV (%s) at %s.\n', @specs.modelName, @specs.modelNumber, @ipAddress)
    )
    .then(() =>
      axios
      .get("#{@baseURL}/nrc/sdd_0.xml")
      .then((reply) =>
        if reply.data.match(/X_GetEncryptSessionId/u)
          @encrypted = true
          console.log(
            "found #{@specs.modelName} TV (#{@specs.modelNumber}) requires crypto for comunication."
          )
      )
    )

#
# ## Public API
# --------
module.exports = { Viera }
