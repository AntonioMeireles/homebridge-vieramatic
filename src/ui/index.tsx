import { hydrate } from 'preact'

import VieraConfigUI from './VieraConfigUI'

window.homebridge.addEventListener('ready', () =>
  hydrate(<VieraConfigUI />, document.getElementById('root') as HTMLElement)
)
