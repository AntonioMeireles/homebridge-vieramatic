path = require('path')
fs = require('fs-extra')

module.exports = class Storage
  constructor: (api) ->
    @accessories = {}
    @filePath = path.join(api.user.cachedAccessoryPath(), 'vieramatic.json')

  init: () =>
    fs
    .readJson(@filePath)
    .then((acc) => @accessories = acc)
    .catch(() => @accessories = {})

  get: (id) =>
    @accessories = {} unless @accessories?
    @accessories[id] = {} unless @accessories[id]?

    return @accessories[id]

  save: () => fs.writeJson(@filePath, @accessories)
