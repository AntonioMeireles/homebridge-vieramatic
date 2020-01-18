require('coffeescript/register')
// Node.js would crashes if there is an uncaught exception, while it does not crash
// if there is an 'unhandledRejection', i.e. a Promise without a .catch() handler.
// so, to catch misbehaving we make sure that there are no (hidden) surprises...
// make-promises-safe installs an process.on('unhandledRejection') handler
// with an exit code of 1, just like any uncaught exception.
// vd https://github.com/mcollina/make-promises-safe
require('make-promises-safe')
// does what it says ...

packageJson = require('./package.json')
Vieramatic = require('./lib/homebridge')

module.exports = function (homebridge) {
  console.log('homebridge API version: ' + homebridge.version);
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  homebridge.registerPlatform(packageJson.name, 'PanasonicVieraTV', Vieramatic, true);
}
