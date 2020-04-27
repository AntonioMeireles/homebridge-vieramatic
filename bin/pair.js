#!/usr/bin/env node
require('module-alias/register')
require('coffeescript/register')
// does what it says ...
require('../lib/cli').run()
