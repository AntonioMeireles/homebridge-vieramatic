import { UserConfig } from './accessory'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isSame = (a: any, b: any): boolean => {
  if (a === b) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (!a || !b || (typeof a !== 'object' && typeof b !== 'object')) return a === b
  if (a.prototype !== b.prototype) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => isSame(a[k], b[k]))
}

const dupeChecker = (devices: UserConfig[] = []): Outcome<void> => {
  const unique: string[] = []
  let error = Error('.')
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

const prettyPrint = (obj: unknown) => JSON.stringify(obj, undefined, 2)

// vscode decorator trickery
// istanbul ignore next
const lit = (s: TemplateStringsArray, ...args: string[]): string =>
  s.map((ss, i) => `${ss}${args[i] ?? ''}`).join('')
const html = lit

type EmptyObject = Record<string, never>
// error handling
type Success<T> =
  | EmptyObject
  | {
      value: T
    }
interface Failure {
  error: Error
}
type Outcome<T> = Success<T> | Failure
const Abnormal = (outcome: unknown): outcome is Failure =>
  (outcome as { error?: Error }).error !== undefined
const Ok = <T>(outcome: unknown): outcome is Success<T> => !Abnormal(outcome)

export {
  Abnormal,
  dupeChecker,
  EmptyObject,
  html,
  isEmpty,
  isSame,
  isValidIPv4,
  isValidMACAddress,
  Ok,
  Outcome,
  prettyPrint,
  sleep
}
