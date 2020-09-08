// eslint-disable-next-line import/no-extraneous-dependencies
import { API } from 'homebridge';

import path from 'path';
import * as fs from 'fs-extra';

class Storage {
  public accessories;

  public filePath: string;

  constructor(api: API) {
    this.accessories = {};
    this.filePath = path.join(
      api.user.cachedAccessoryPath(),
      'vieramatic.json'
    );
  }

  public init(): void {
    const data = fs.readJsonSync(this.filePath, {
      throws: false
    });
    if (data !== undefined) {
      this.accessories = data;
    }
  }

  public get(id: string): unknown {
    if (!this.accessories) {
      this.accessories = {};
    }

    if (!this.accessories[id]) {
      this.accessories[id] = {};
    }

    return this.accessories[id];
  }

  public save(): void {
    fs.writeJSONSync(this.filePath, this.accessories);
  }
}

export default Storage;
