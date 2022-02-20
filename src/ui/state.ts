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

const rawClone = <T = unknown>(data: T): T =>
  data !== undefined ? JSON.parse(JSON.stringify(data)) : undefined

export { InitialState, PluginConfig, rawClone, Selected }
