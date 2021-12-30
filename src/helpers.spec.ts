// eslint-disable-next-line node/no-extraneous-import
import { jest } from '@jest/globals'

import { isValidMACAddress, sleep, isEmpty } from './helpers'

jest.setTimeout(30_000)

describe('isValidMacAddress', () => {
  it('should verify a valid mac address', () => {
    expect(isValidMACAddress('61:67:0F:6E:B0:48')).toBeTruthy()
  })

  it('should not reject a lower case valid mac address', () => {
    const macAddress = '0E:80:9C:B4:E4:C5'
    expect(isValidMACAddress(macAddress)).toBeTruthy()
    expect(isValidMACAddress(macAddress.toLowerCase())).toBeTruthy()
  })

  it('should reject too short mac address', () => {
    expect(isValidMACAddress('25:22:04:2B:3A')).toBeFalsy()
  })

  it('should reject too long mac address', () => {
    expect(isValidMACAddress('7F:9A:58:0E:87:23:AA')).toBeFalsy()
  })
})

describe('sleep', () => {
  test('do something after 200ms', async () => {
    const foo = true
    await sleep(200)
    expect(foo).toBeDefined()
  })
})

describe('isEmpty', () => {
  test('should be True if empty Object', () => {
    expect(isEmpty({})).toBeTruthy()
  })
  test('should be False if not an empty Object', () => {
    expect(isEmpty({ a: true })).toBeFalsy()
  })
})
