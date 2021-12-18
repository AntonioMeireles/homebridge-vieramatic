#!/usr/bin/env node
// istanbul ignore file
import { question } from 'readline-sync'

import { Outcome, Abnormal } from './helpers'
import { VieraTV, VieraAuth } from './viera'

const oops = (error: Error): void => {
  console.error(`${error.name}: ${error.message}`)
  process.exitCode = -1
}

const setup = async (ip: string): Promise<void> => {
  let probe: Outcome<VieraTV>
  if (Abnormal((probe = await VieraTV.probe(ip)))) throw probe.error
  const tv = probe.value

  if (tv.specs.requiresEncryption) {
    let auth: Outcome<VieraAuth>, challenge: Outcome<string>
    if (Abnormal((challenge = await tv.requestPinCode()))) throw challenge.error
    const pin = question('Enter the displayed pin code: ')
    if (Abnormal((auth = await tv.authorizePinCode(pin)))) throw auth.error

    tv.auth = auth.value
  }
  tv.renderSampleConfig()
}

process.argv.length !== 3
  ? oops(Error('Please specify your Panasonic TV IP address as the (only) argument'))
  : setup(process.argv[2]).catch(oops)
