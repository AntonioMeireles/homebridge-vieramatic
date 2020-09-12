/* eslint-disable-next-line import/no-extraneous-dependencies */
import { API } from 'homebridge';

import { VieramaticPlatform } from './platform';
import { PLATFORM_NAME } from './settings';

export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, VieramaticPlatform);
};
