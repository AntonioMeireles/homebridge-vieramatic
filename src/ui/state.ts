import { UserConfig } from '../accessory'
import { VieraSpecs } from '../viera'

type PluginConfig = {
  platform: string
  tvs: UserConfig[]
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
  pluginConfig: {
    platform: '',
    tvs: []
  }
}

const objPurifier = (obj: unknown) =>
  obj !== undefined ? JSON.parse(JSON.stringify(obj)) : undefined

export { InitialState, objPurifier, PluginConfig, Selected }
