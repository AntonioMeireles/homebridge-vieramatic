// eslint-disable-next-line node/no-extraneous-import
import { jest } from '@jest/globals'
import { Service } from 'hap-nodejs'
import { HomebridgeAPI, InternalAPIEvent, AccessoryPlugin } from 'homebridge/lib/api'

import VieramaticPlatform from './platform'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings'

class ExampleAccessory implements AccessoryPlugin {
  getServices = () => [new Service.Switch('MyFakeTV')]
}

const api = new HomebridgeAPI()
const emitSpy = jest.spyOn(api, 'emit')
const accessoryName = 'mockTV'

describe('VieramaticPlatform', () => {
  describe('HomebridgeAPI.prototype.registerAccessory', () => {
    it('should register accessory with legacy style signature', () => {
      api.registerAccessory(PLUGIN_NAME, accessoryName, ExampleAccessory)
      expect(emitSpy).toHaveBeenLastCalledWith(
        InternalAPIEvent.REGISTER_ACCESSORY,
        accessoryName,
        ExampleAccessory,
        PLUGIN_NAME
      )
    })

    it('should register accessory without passing plugin name', () => {
      api.registerAccessory(accessoryName, ExampleAccessory)
      expect(emitSpy).toHaveBeenLastCalledWith(
        InternalAPIEvent.REGISTER_ACCESSORY,
        accessoryName,
        ExampleAccessory
      )
    })
  })

  describe('HomebridgeAPI.prototype.registerPlatform', () => {
    it('should register platform with legacy style signature', () => {
      api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, VieramaticPlatform)
      expect(emitSpy).toHaveBeenLastCalledWith(
        InternalAPIEvent.REGISTER_PLATFORM,
        PLATFORM_NAME,
        VieramaticPlatform,
        PLUGIN_NAME
      )
    })

    it('should register platform without passing plugin name', () => {
      api.registerPlatform(PLATFORM_NAME, VieramaticPlatform)
      expect(emitSpy).toHaveBeenLastCalledWith(
        InternalAPIEvent.REGISTER_PLATFORM,
        PLATFORM_NAME,
        VieramaticPlatform
      )
    })
  })
})
