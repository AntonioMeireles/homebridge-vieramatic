# homebridge-vieramatic

[![License: Apache 2](https://img.shields.io/badge/License-Apache_2-blue.svg)](./LICENSE.md)
[![npm version](https://img.shields.io/npm/v/homebridge-vieramatic?color=blue)](https://www.npmjs.com/package/homebridge-vieramatic)
[![downloads](https://img.shields.io/npm/dt/homebridge-vieramatic?color=blue)](https://www.npmjs.com/package/homebridge-vieramatic)
[![Vulnerabilities](https://img.shields.io/snyk/vulnerabilities/npm/homebridge-vieramatic)](https://snyk.io/vuln/npm:homebridge-vieramatic)

# The [Homebridge](http://homebridge.io) plugin for Panasonic™ Viera™ TVs

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

## Requirements

- iOS 12.3 or later
- Homebridge v0.4.50 or later

## TV Setup

1. On your TV go to `Menu -> Network -> TV Remote App Settings` and ensure the following settings are **ON**:

   - **TV Remote**
   - **Powered On by Apps**
   - **Networked Standby**

2. Then, go to `Menu -> Network -> Network Status -> Status Details` and take note of your TV ip address.

## Plugin Setup

### the simple way - **recommended**

1. Get [**homebridge**](http://homebridge.io).

2. [install the **homebridge UI**](https://github.com/oznu/homebridge-config-ui-x#installation-instructions)

3. From your browser, access the homebridge's ui, and jump to the plugins _tab_.

   there, search for `vieramatic`, and install it.

4. Restart homebridge

5. Go again to the plugins tab, and click on 'settings' from this plugin.

6. Just follow the instructions and that's it.

7. If for some reason, things do not progress as expected, it is probably a bug.
   Please just [report](https://github.com/AntonioMeireles/homebridge-vieramatic/issues) it.

### the old fashioned way

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
     >     "ipAddress": "YOUR_TV_IP_ADDRESS_HERE",
     >     "hdmiInputs": []
     >   }, {
     >     "ipAddress": "YOUR_SECOND_TV_IP_ADDRESS_HERE",
     >     "hdmiInputs": []
     >   }
     > ]
     > ```

6. disable the custom volume slider (**optional**)

   By default each TV will appear on HomeKit with an additional volume slider (of Fan type) in order
   to provide a visual way to control the volume (in addition to the hardware volume controls)
   In order to disable this feature, for each defined TV, just add

   ```JSON
      "customVolumeSlider": false,
   ```

7. [re]start homebridge

## Tips and tricks

### input switching - how to get Siri to do it

As far as the author knows, currently, the HomeKit TV integration spec from Apple sadly does
not allow to switch inputs with Siri directly (would love to be proven wrong).

The workaround is either to make shortcuts that do the input change and invoke those from Siri,
or to create scenes straight in the home app that achieve the same and then invoke them.

### Docker

if your **homebridge** setup resolves around containers please do note that in order for this plugin to fully
work you need to also expose to the outside port `8973`, otherwise you won't be able to access to endpoint that
generates your encryption credentials.

## Contributing

[Contributions](https://github.com/AntonioMeireles/homebridge-vieramatic/pulls)
and [suggestions or bug reports](https://github.com/AntonioMeireles/homebridge-vieramatic/issues)
are gladly welcomed!

## License

This is an [open source](http://opensource.org/osd) project released under the [Apache License 2.0](./LICENSE).

## Acknowledgments

- **George Nick Gorzynski**'s [homebridge-panasonic](https://github.com/g30r93g/homebridge-panasonic)
  plugin which served as the base inspiration for this new one.
- **Florian Holzapfel**'s [panasonic-viera](https://github.com/florianholzapfel/panasonic-viera)
  python library which documented the new pin code authentication and communication scheme of 2018 and later models.
- the [Homebridge](http://homebridge.io) community at large without whom this wouldn't just be possible.
