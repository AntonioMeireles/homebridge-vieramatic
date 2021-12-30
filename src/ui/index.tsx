import { hydrate } from 'preact'

import VieraConfigUI from './VieraConfigUI'

window.homebridge.addEventListener('ready', () =>
  hydrate(<VieraConfigUI />, document.querySelector('#root') as HTMLElement)
)
