# homebridge-vieramatic - the [Homebridge](http://homebridge.io) plugin for Panasonic™ Viera™ TVs

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![License: Apache 2](https://img.shields.io/badge/License-Apache_2-blue.svg)](./LICENSE.md)
[![npm version](https://img.shields.io/npm/v/homebridge-vieramatic?color=blue)](https://www.npmjs.com/package/homebridge-vieramatic)
[![downloads](https://img.shields.io/npm/dt/homebridge-vieramatic?color=blue)](https://www.npmjs.com/package/homebridge-vieramatic)
[![GitHub last commit](https://img.shields.io/github/last-commit/AntonioMeireles/homebridge-vieramatic.svg?color=blue)](https://github.com/AntonioMeireles/homebridge-vieramatic)

## features

- **full support for 2018 and later models**
  > Pin code and encryption (encapsulated in AES-CBC-128 encryption with
  > HMAC-SHA-256) was added as a requirement for communication with TV models
  > released on and after 2018 which has broken previously existing plugins.
  >
  > Please do note that **older models are still supported** too, as first class citizens.
- **HomeKit TV Accessory**
- **Power TV** On & Off
- **Input switching**
- Automated **TV Apps handling**
- **Fully configurable via the Homebridge UI**. No more need to manually edit homebridge's
  `config.json` nor to run shell commands.

## requirements

- iOS 12.3 or later
- Homebridge **v1.3.0** or _later_ (since **`homebridge-vieramatic@3.0.0`**)

  > before upgrading to **Homebridge v1.3.0** check please its
  > [ChangeLog](https://github.com/homebridge/homebridge/blob/master/CHANGELOG.md#v130-2021-02-20)
  > specially the **[breaking
  > changes](https://github.com/homebridge/homebridge/blob/master/CHANGELOG.md#breaking-changes)**
  > section in order to see if anything there applies to your particular setup.

- A actively supported [LTS](https://nodejs.org/en/about/releases/) nodejs release. So, the minimum
  from 4.x onwards is Node 12.

## TV setup

1. On your TV go to `Menu -> Network -> TV Remote App Settings` and make sure that the following settings are **all** turned **ON**:

   - **TV Remote**
   - **Powered On by Apps**
   - **Networked Standby**

2. Then, go to `Menu -> Network -> Network Status -> Status Details` and take note of your TV ip address.

## plugin setup

### the simple way [recommended]

1. Get [**homebridge**](http://homebridge.io).

2. [install the **homebridge UI**](https://github.com/oznu/homebridge-config-ui-x#installation-instructions),
   if not using it already.

3. From your browser, access the homebridge's ui, and jump to the plugins _tab_.

   there, search for `vieramatic`, and install it.

4. Restart homebridge

5. Go again to the 'plugins' _tab_, click on 'settings' from this plugin and follow the instructions.

6. [add your newly configured Viera TV to HomeKit](https://github.com/homebridge/homebridge/wiki/Connecting-Homebridge-To-HomeKit#how-to-add-homebridge-cameras--tvs).

7. that's it! ~~The plugin will even detect automatically all TVs on your local network (and
   if it doesn't you can still add them manually...)~~
    > early 4.x releases shipped with automated discovery of available TV on your local network, via
    > SSDP multicast discovery. That is causing issues in several setups - namely docker ones, so it
    > become disabled until it becomes completely reliable for the common case.
    >

8. If for some reason, things do not progress as expected, it is probably a bug.
   Please just [report](https://github.com/AntonioMeireles/homebridge-vieramatic/issues) it.

> This plugin assumes and expects that the user has
> [homebridge-plugin-ui-x](https://github.com/oznu/homebridge-config-ui-x) installed for all its UI
> functionality. So, there's no integration UI wise of any kind for third party homebridge UIs like
> HOOBS. So, if you are an HOOBS user you need to use `viera-pair` (see bellow) to generate the
> encryption tuple!
>

### the old fashioned way [you shouldn't need to do this anymore really, except if using HOOBS or similar]

1. Get [**homebridge**](http://homebridge.io).

2. Install this plugin

   > ```shell
   >  $ sudo npm install -g homebridge-vieramatic
   > ```

3. run the _pre-flight_ setup script, and take note of the output

   > ```shell
   >  $ viera-pair YOUR_TV_IP_ADDRESS_HERE
   > ```

4. Update your _homebridge_'s `config.json` file per the output of `viera-pair` in the step above.

5. Populate the `hdmiInputs` section according to your input switching list.

   > ```JSON
   > "platforms": [
   >    {
   >       "platform": "PanasonicVieraTV",
   >       "tvs": [
   >          {
   >            "friendlyName": "YOUR_TV_NAME_HERE",
   >            "ipAddress": "YOUR_TV_IP_ADDRESS_HERE",
   >            "hdmiInputs": [
   >              {
   >                "id" : "1",
   >                "name": "Apple TV"
   >              }, {
   >                "id" : "2",
   >                "name": "VodafoneTV box"
   >              },
   >            ]
   >          }
   >       ]
   >    }
   > ]
   > ```

   - please do note that if have more than one TV you add its config to the `tvs` array and not as
     a whole platform duplicate, along the example bellow...

     > ```JSON
     >
     > "tvs": [
     >   {
     >     "friendlyName": "YOUR_TV_NAME_HERE",
     >     "ipAddress": "YOUR_TV_IP_ADDRESS_HERE",
     >     "hdmiInputs": []
     >   }, {
     >     "friendlyName": "YOUR_TV_NAME_HERE",
     >     "ipAddress": "YOUR_SECOND_TV_IP_ADDRESS_HERE",
     >     "hdmiInputs": []
     >   }
     > ]
     > ```

6. disable the custom volume slider (**optional**)

   By default each TV will appear on HomeKit with an additional volume slider (of _Fan_ type) in order
   to provide a visual way to control the volume (in addition to the hardware
   volume controls)

   In order to disable this feature, for each defined TV, just add

   ```JSON
      "customVolumeSlider": false,
   ```

7. [re]start homebridge

## tips and tricks

### TV naming

If you'd prefer for Vieramatic to automatically detect and consume the name on your TV, then you can remove the `tvName` field from your config.

Your `config.json` file will look like this:

> ```JSON
> "tvs": [
>   {
>     "ipAddress": "YOUR_TV_IP_ADDRESS_HERE",
>     "friendlyName": "OPTIONAL_CUSTOMIZED_TV_NAME_HERE",
>     "hdmiInputs": [
>       {
>         "id" : "1",
>         "name": "Apple TV"
>       }, {
>         "id" : "2",
>         "name": "VodafoneTV box"
>       }
> ]
> ```

### supported TV sets

This plugin should support **ALL** the TV models supported by Panasonic's own "**Panasonic TV Remote TV 3**"
mobile app ([**IOS** install link](https://apps.apple.com/us/app/panasonic-tv-remote-3/id1435893441) and
[**Android** install link](https://play.google.com/store/apps/details?id=com.panasonic.ais_pfdc_tvremote3_gbl&hl=en)).

So, if experiencing setup problems, do make sure, in advance, that the TV is discoverable/manageable by the mobile
app while connected to the exact same network as your homebridge setup, because if it isn't there's not much that the
plugin could do.

> some older sets became unreachable from the network either immediately
> after entering into stand-by, or after a while, and a subset of those sets
> supports being awaken via '**Wake On Lan**'.
> If your set is one of those, you'll need to specify your TVs MAC address,
> either via the Homebridge UI's or directly into the TV's definition in
> homebridge's `config.json` along:
>
> ```JSON
>   "tvs": [
>     {
>       "ipAddress": "YOUR_TV_IP_ADDRESS_HERE",
>        (...)
>       "mac": "YOUR_TV_MAC_ADDRESS",
>       (...)
>      }
>    ]
> ```
>
> so that the the plugin could turn the TV ON.
>
> Please do note that, on older sets, the **Wake On Lan** feature is only
> expected to work if the TV is connected to the network via a cable and not via
> wi-fi. On some sets, specially less older ones, it _may_ work also wirelessly.

### Disabling TV app support in very old TV sets

Early Panasonic SmartTVs APis either didn't expose TV apps using the current API
or simply lacked that functionality at all. So, in order to support those sets a
new options was added in `2.0.16` that allows the plugin's support for TV's apps
to be disabled. For each affected TV just add to its' section (in
`config.json`), or (preferable) turn that option ON via homebridge's config UI.

```JSON
   "disabledAppSupport": true,
```

### How to power on TV on (very old) unsupported TV sets

On some TVs, WoL (wakeup from lan) functionality is not even available, but a
similar effect can can be achieved by using taking advantage of plain [CEC
hdmi](https://en.wikipedia.org/wiki/Consumer_Electronics_Control).

#### Requirements

- Your homebridge device will need to be connected to your TV via HDMI.
- You will need to available a script executor for Homebridge (Script2 is used in
  this guide). Install it per `npm install -g homebridge-script2`
- You will need to have available in your homebridge host `cec-client`.

  > on a Raspberry Pi running Raspbian `cec-client` is provided by having
  > installed the `cec-utils` package

- You will need to activate CEC-HDMI on your TV (the system that automatically
  turns the TV on or off if an hdmi device is turned on or off). You will also
  need to ensure that, on boot, the homebridge host does not turn
  on the TV, or change its' HDMI source input (to it).

  On a rPI (per [here](https://raspberrypi.stackexchange.com/questions/6682/stopping-rasppi-raspbmc-from-auto-changing-source-on-tv))
  you'll achieve that goal by adding the `hdmi_ignore_cec_init=1` config option
  to your `/boot/config.txt`.

#### script snippets

> adapt absolute paths accordingly to your local setup and mod `name` from
> default (`"TV ON/OFF"`) bellow to whatever suits you best.

- **`homebridge.conf`**

  ```json
  {
     "accessory": "Script2",
     "name": "TV ON/OFF",
     "on": "/var/homebridge/TV-ON-OFF/on.sh",
     "off": "/var/homebridge/TV-ON-OFF/off.sh",
     "state": "/var/homebridge/TV-ON-OFF/state.sh",
     "on_value": "ON",
     "unique_serial": "1234568"
  },
  ```

- **`/var/homebridge/TV-ON-OFF/on.sh`**

  ```bash
  #!/bin/sh
  echo 'on 0' | cec-client -s -d 1 && echo "ON"
  ```

- **`/var/homebridge/TV-ON-OFF/off.sh`**

```bash
#!/bin/bash
echo 'standby 0' | cec-client -s -d 1 && echo "OFF"
```

**`/var/homebridge/TV-ON-OFF/state.sh`**

- ```bash
  #!/bin/bash
  state=$(echo 'pow <DEVICE #>' | cec-client -s -d 1)
  if [[ $state == *" on"* ]]; then
     echo "ON"
  else
     echo "OFF"
  fi
  ```

  restart homebridge and You should now have TV ON/OFF capabilities exposed to
  your HomeKit setup.

### input switching - how to get Siri to do it

As far as the author knows, currently, the HomeKit TV integration spec from Apple sadly does
not allow to switch inputs with Siri directly (would love to be proven wrong).

The workaround is either to make shortcuts that do the input change and invoke those from Siri,
or to create scenes straight in the home app that achieve the same and then invoke them.

### upgrading from pre `2.0.0` releases of this plugin

The upgrade should be transparent, and painless.

The only expected side effect is that you'll need to set again the visibility of your inputs and apps as they 'll get back
to the defaults. If you experience other kinds if issues **then** it is a bug so, please
[report](https://github.com/AntonioMeireles/homebridge-vieramatic/issues) it with as much context as possible.

## contributing

[Contributions](https://github.com/AntonioMeireles/homebridge-vieramatic/pulls)
and [suggestions or bug reports](https://github.com/AntonioMeireles/homebridge-vieramatic/issues)
are gladly welcomed!

## licensing

This is an [open source](http://opensource.org/osd) project released under the [Apache License 2.0](./LICENSE).

## acknowledgments

- **George Nick Gorzynski**'s [homebridge-panasonic](https://github.com/g30r93g/homebridge-panasonic)
  plugin which served as the base inspiration for this new one.
- **Florian Holzapfel**'s [panasonic-viera](https://github.com/florianholzapfel/panasonic-viera)
  python library which documented the new pin code authentication and communication scheme of 2018 and later models.
- the [Homebridge](http://homebridge.io) community at large without whom this wouldn't just be possible.
