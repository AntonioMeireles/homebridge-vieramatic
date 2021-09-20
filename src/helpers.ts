import util from 'util'

import parser from 'fast-xml-parser'

const xml2obj = (raw: string): Record<string, unknown> =>
  parser.parse(raw, {
    numParseOptions: {
      hex: true,
      leadingZeros: true,
      // workarounds fxp 3.20.0 woes
      // encrypted payloads were sometimes being parsed as (!) bigNums
      skipLike: /^\S+=$/
    }
  })
const obj2xml = (data: unknown): string =>
  // eslint-disable-next-line new-cap
  new parser.j2xParser({ ignoreAttributes: false }).parse(data)

const isValidMACAddress = (address: string): boolean =>
  /^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/.test(address)

const sleep = async (ms: number): Promise<unknown> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const isEmpty = (obj: Record<string, unknown>): boolean =>
  Object.keys(obj).length === 0 && obj.constructor === Object

const printf = util.format
// vscode decorator trickery
// istanbul ignore next
const lit = (s: TemplateStringsArray, ...args: string[]): string =>
  s.map((ss, i) => `${ss}${args[i] ?? ''}`).join('')
const html = lit

// error handling
interface Success<T> {
  value: T
}

interface Failure {
  error: Error
}

type Outcome<T> = Success<T> | Failure

const Abnormal = (result: unknown): result is Failure => (result as Failure).error != null

export { sleep, isEmpty, isValidMACAddress, html, Outcome, printf, Abnormal, obj2xml, xml2obj }
