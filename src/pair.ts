#!/usr/bin/env node
import { VieraTV } from './viera'

const ip = process.argv.slice(2)

if (ip.length !== 1) {
  console.error(
    'Please specify your Panasonic TV IP address as the (only) argument'
  )
  process.exitCode = 1
} else {
  VieraTV.setup(ip[0]).catch((e) => console.error(e))
}
