// eslint-disable-next-line import/no-extraneous-dependencies
import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import VieramaticPlatform from './platform';

export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, VieramaticPlatform);
};
