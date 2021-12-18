const commonSchema = {
  properties: {
    appId: {
      readonly: true,
      required: false,
      title: 'AppId',
      type: 'string'
    },
    customVolumeSlider: {
      default: false,
      description: 'Whether to enable a fan as an additional TV volume control artifact to HomeKit',
      title: 'Volume control service',
      type: 'boolean'
    },
    disabledAppSupport: {
      description: 'Only enable if you have a very old TV set (circa 2012)',
      required: false,
      title:
        'Allow the plugin to still work if the TV does not allow smart app management through HomeKit',
      type: 'boolean'
    },
    encKey: {
      readonly: true,
      required: false,
      title: 'Encryption Key',
      type: 'string'
    },
    friendlyName: {
      description: "The name with you'd like your set to appear on HomeKit.",
      required: false,
      title: 'HomeKit / HomeBridge TV Name',
      type: 'string'
    },
    hdmiInputs: {
      default: [],
      items: {
        properties: {
          id: {
            maxLength: 1,
            pattern: '^[0-6]$',
            required: true,
            title: 'HDMI port number',
            type: 'string'
          },
          name: {
            required: true,
            title: 'attached source description',
            type: 'string'
          }
        },
        type: 'object'
      },
      maxItems: 6,
      minItems: 0,
      title: 'HDMI input',
      type: 'array'
    },
    ipAddress: {
      description: 'The IP address of your TV.',
      format: 'ipv4',
      readonly: true,
      required: true,
      title: 'IP address',
      type: 'string'
    },
    mac: {
      description: 'The MAC address of your TV.',
      pattern: '^([A-Fa-f0-9]{2}(:|-)){5}[A-Fa-f0-9]{2}$',
      readonly: true,
      required: false,
      title: 'MAC address',
      type: 'string'
    }
  },
  type: 'object'
}
const pinRequestSchema = {
  schema: {
    properties: {
      pin: {
        required: true,
        title: 'Please insert the 4-digit PIN displayed on your TV',
        type: 'string'
      }
    },
    type: 'object'
  }
}

const tvAddressSchema = {
  schema: {
    properties: {
      ipAddress: {
        required: true,
        title: 'Please insert the IP address of your TV',
        type: 'string'
      }
    },
    type: 'object'
  }
}

const commonFormLayout = [
  { key: 'ipAddress' },
  {
    key: 'friendlyName',
    placeholder: 'If unset, the name set on the TV will be used.'
  },

  {
    'flex-flow': 'row wrap',
    items: ['hdmiInputs[].id', 'hdmiInputs[].name'],
    key: 'hdmiInputs',
    title: "{{'HDMI '+ value.id }}",
    type: 'array'
  },
  { key: 'customVolumeSlider' },
  {
    items: [
      { key: 'disabledAppSupport' },
      {
        key: 'mac',
        placeholder:
          'leave empty except for older models that require Wake On Lan to power on from standby'
      }
    ],
    title: 'workarounds for older TVs'
  }
]

const authLayout = {
  items: [
    {
      key: 'encKey',
      placeholder: 'leave empty except for 2018 and later sets'
    },
    {
      key: 'appId',
      placeholder: 'leave empty except for 2018 and later sets'
    }
  ],
  title: 'Authentication'
}

export { authLayout, commonFormLayout, commonSchema, pinRequestSchema, tvAddressSchema }
