import { UserConfig } from '../accessory'
import { PLATFORM_NAME } from '../settings'
import { VieraSpecs } from '../viera'

class PluginConfig implements PluginConfig {
  readonly platform = PLATFORM_NAME
  tvs: UserConfig[]
  constructor(tvs: UserConfig[] = []) {
    this.tvs = tvs
  }
}

type Selected = {
  config: UserConfig
  specs?: VieraSpecs
  reachable: boolean
  onHold: boolean
}

type GlobalState = {
  abnormal: boolean
  frontPage: boolean
  killSwitch: boolean
  loading: boolean
  pluginConfig: PluginConfig
  selected?: Selected
}

const InitialState: GlobalState = {
  abnormal: false,
  frontPage: true,
  killSwitch: false,
  loading: true,
  pluginConfig: new PluginConfig()
}

const objPurifier = (obj: unknown) =>
  obj !== undefined ? JSON.parse(JSON.stringify(obj)) : undefined

export { InitialState, objPurifier, PluginConfig, Selected }
