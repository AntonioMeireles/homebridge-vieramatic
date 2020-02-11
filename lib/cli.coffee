### eslint-disable no-console ###

# > required **external dependencies**
net = require('net')
# > required **internal dependencies**
Viera = require('./viera')

run = () ->
  ip = process.argv.slice(2)

  switch
    when ip.length isnt 1
      console.error('Please give (only) your Panasonic TV IP address as argument')
      process.exitCode = 1
    when not net.isIPv4(ip)
      console.error('You entered an invalid IP address!')
      process.exitCode = 1
    else
      new Viera(ip[0]).setup()

#
# ## Public API
# --------
module.exports = { run }
