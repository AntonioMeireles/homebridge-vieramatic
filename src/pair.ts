#!/usr/bin/env node
import { VieraTV } from './viera'

const oops = (e: Error): void => {
  console.error(`${e.message} \n`)
  process.exit(-1)
}

try {
  const ip = process.argv.slice(2)
  if (ip.length !== 1)
    throw Error(
      'Please specify your Panasonic TV IP address as the (only) argument'
    )

  VieraTV.setup(ip[0])
    .then(() => process.exit(0))
    .catch(oops)
} catch (e) {
  oops(e)
}
