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
// eslint-disable-next-line new-cap
const xml = (data: unknown): string => new parser.j2xParser({ ignoreAttributes: false }).parse(data)

const isValidMACAddress = (mac: string): boolean => /^(?:[\dA-Fa-f]{2}:){5}[\dA-Fa-f]{2}$/.test(mac)

const sleep = async (ms: number): Promise<unknown> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const isEmpty = (obj: Record<string, unknown>): boolean =>
  obj.constructor === Object && Object.keys(obj).length === 0

// vscode decorator trickery
// istanbul ignore next
const lit = (s: TemplateStringsArray, ...args: string[]): string =>
  s.map((ss, i) => `${ss}${args[i] ?? ''}`).join('')
const html = lit

// error handling
type Success<T> =
  | Record<string, never>
  | {
      value: T
    }
interface Failure {
  error: Error
}
type Outcome<T> = Success<T> | Failure
const Abnormal = (result: unknown): result is Failure => (result as Failure).error != null
const Ok = <T>(result: unknown): result is Success<T> => (result as Failure).error == null

export { Abnormal, html, isEmpty, isValidMACAddress, Ok, Outcome, sleep, xml, xml2obj }
