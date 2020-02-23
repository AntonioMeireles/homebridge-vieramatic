# > required **external dependencies**
path = require('path')
fs = require('fs-extra')

class Storage
  constructor: (api) ->
    @accessories = {}
    @filePath = path.join(api.user.cachedAccessoryPath(), 'vieramatic.json')

  init: () ->
    acc = fs.readJsonSync(@filePath, { throws: false })
    if acc is null then @accessories = {} else @accessories = acc

  get: (id) ->
    @accessories = {} unless @accessories?
    @accessories[id] = {} unless @accessories[id]?

    return @accessories[id]

  save: () ->
    fs.writeJsonSync(@filePath, @accessories)

#
# ## Public API
# --------
module.exports = Storage
