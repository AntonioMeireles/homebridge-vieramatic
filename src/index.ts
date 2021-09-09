import { API } from 'homebridge'

// istanbul ignore file
import VieramaticPlatform from './platform'
import { PLATFORM_NAME } from './settings'

export = (api: API): void => api.registerPlatform(PLATFORM_NAME, VieramaticPlatform)
