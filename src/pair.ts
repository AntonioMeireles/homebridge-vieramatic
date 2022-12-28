#!/usr/bin/env node
import { question } from 'readline-sync'

import { Outcome, Abnormal } from './helpers'
import { VieraTV, VieraAuth } from './viera'

const oops = (error: Error): void => {
  console.error(`${error.name}: ${error.message}`)
  process.exitCode = -1
}

const setup = async (ip: string): Promise<void> => {
  const probe = await VieraTV.probe(ip)
  if (Abnormal(probe)) throw probe.error
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

process.argv.length === 3
  ? setup(process.argv[2]).catch(oops)
  : oops(Error('Please specify your Panasonic TV IP address as the (only) argument'))
