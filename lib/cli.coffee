Viera = require('./viera')

run = () ->
  ip = process.argv.slice(2)
  unless ip.length is 1
    console.error('Please give (only) your Panasonic TV IP address as argument')
    process.exitCode = 1
  else
    new Viera(ip[0]).setup()

#
# ## Public API
# --------
module.exports = { run }
