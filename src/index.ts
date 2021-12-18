// istanbul ignore file
import { API } from 'homebridge'

import VieramaticPlatform from './platform'
import { PLATFORM_NAME } from './settings'

export default (api: API): void => api.registerPlatform(PLATFORM_NAME, VieramaticPlatform)
