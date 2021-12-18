import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface'

import { UserConfig } from '../accessory'
import { VieraSpecs } from '../viera'

type Selected =
  | Record<string, never>
  | {
      config: UserConfig
      specs: VieraSpecs
      reachable: boolean
    }

type GlobalState =
  | Record<string, never>
  | {
      config: PluginConfig
      frontPage: boolean
      killSwitch: boolean
      selected: Selected
    }

const InitialState: GlobalState = {
  config: [],
  frontPage: true,
  killSwitch: false,

  selected: {}
}

const getUntrackedObject = (obj: unknown) => (obj != null ? JSON.parse(JSON.stringify(obj)) : null)

export { getUntrackedObject, InitialState }
