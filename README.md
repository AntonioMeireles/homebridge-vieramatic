# homebridge-vieramatic

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)
[![npm version](https://img.shields.io/npm/v/homebridge-vieramatic?color=blue)](https://www.npmjs.com/package/homebridge-vieramatic)
[![downloads](https://img.shields.io/npm/dt/homebridge-vieramatic?color=blue)](https://www.npmjs.com/package/homebridge-vieramatic)

## [Homebridge](http://homebridge.io) plugin for Panasonic™ Viera™ TVs

- **full support for 2018 and later models**

  > Pincode and encryption (encapsulated in AES-CBC-128 encryption with
  > HMAC-SHA-256) was added as a requirement for communication with TV models
  > released on and after 2018 which has broken previously existing plugins.
  >
  > (tested on Author's TX-50GX830E)

- HomeKit TV Accessory

- Power TV On & Off

- Input switching

- Automated TV Apps handling

### Requirements

1. iOS 12.3 or later
2. Homebridge v0.4.50 or later

### TV Setup

1. On your TV go to `Menu -> Network -> TV Remote App Settings` and ensure the following settings are **ON**:

   - **TV Remote**

   - **Powered On by Apps**

   - **Networked Standby**

2. Then, go to `Menu -> Network -> Network Status -> Status Details` and take note of your TV ip address.

### Installation

1. Install [homebridge](http://homebridge.io).
2. Install this plugin

   > ```shell
   >  $ sudo npm install -g homebridge-vieramatic
   > ```

3. run the _pre-flight_ setup script, and take note of its output

   > ```shell
   >  $ viera-pair YOUR_TV_IP_ADDRESS_HERE
   > ```

4. Update your _homebridge_'s `config.json` file per the output of `viera-pair` in the step above

   > if you are using one of the multiple homebridge graphical web front-ends, like
   > [HOOBS](https://hoobs.org) or
   > [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x), you may
   > need to _paste_, the config snippet referenced above manually to it.
   >
   > - When using [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x)
   >   you can go to the `config` tab and edit the settings there.
   > - Over [HOOBS](https://hoobs.org) please do follow the steps referenced
   >   [here](https://hoobs.org/knowledge-base/how-plugins-work-with-hoobs-advanced/) replacing all
   >   mentions of `homebridge-plugin` with `homebridge-vieramatic`.
   >
   >   Please do note that in HOOBS `viera-pair` will end located at
   >   `/home/hoobs/.hoobs/node_modules/.bin/viera-pair`

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

### Integration with Siri - quick note about input switching

As far as the author knows, currently, the Homekit TV integration spec from Apple sadly does
not allow to switch inputs with Siri directly (would love to be proved wrong).

The workaround is either to make shortcuts that do the input change and invoke those from Siri,
or to create scenes straight in the home app that achieve the same and then invoke them.

### Acknowledgments

- **George Nick Gorzynski**'s original [homebridge-panasonic](https://github.com/g30r93g/homebridge-panasonic)
  plugin which served as the base inspiration for this new one.
- **Florian Holzapfel**'s [panasonic-viera](https://github.com/florianholzapfel/panasonic-viera)
  python library which documented the new pincode authentication and communication scheme of 2018 and later models.

### Contributing

This is an [open source](http://opensource.org/osd) project released under
the [MIT License](./LICENSE.md).

[Contributions](https://github.com/AntonioMeireles/homebridge-vieramatic/pulls)
and [suggestions or bug reports](https://github.com/AntonioMeireles/homebridge-vieramatic/issues)
are gladly welcomed!
