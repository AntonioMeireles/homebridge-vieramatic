import { UserConfig } from './accessory'

const dupeChecker = (devices: UserConfig[]): Outcome<void> => {
  const unique: string[] = []
  let error: Error = Error()
  const state = devices.some((it) => {
    if (!unique.includes(it.ipAddress)) {
      unique.push(it.ipAddress)
      return false
    }
    error = Error(it.ipAddress)
    return true
  })
  return state ? { error } : {}
}

const isValidMACAddress = (mac: string): boolean => /^(?:[\dA-Fa-f]{2}:){5}[\dA-Fa-f]{2}$/.test(mac)
const isValidIPv4 = (ip: string): boolean =>
  /^(?:(?:\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.){3}(?:\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])$/.test(ip)

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

export { Abnormal, dupeChecker, html, isEmpty, isValidIPv4, isValidMACAddress, Ok, Outcome, sleep }
