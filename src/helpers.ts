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
  const unique = new Set<string>()
  let error = undefined as unknown as Error
  const state = devices.some((it) => {
    if (unique.has(it.ipAddress)) error = Error(it.ipAddress)
    else unique.add(it.ipAddress)
    return (error as unknown) !== undefined
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

type EmptyObject = Record<string, never>
// error handling
type Success<T> = EmptyObject | { value: T }
type Failure = { error: Error }
type Outcome<T> = Success<T> | Failure
const Abnormal = (outcome: unknown): outcome is Failure =>
  (outcome as Partial<Failure>).error !== undefined
const Ok = <T>(outcome: unknown): outcome is Success<T> => !Abnormal(outcome)

export {
  Abnormal,
  dupeChecker,
  EmptyObject,
  isEmpty,
  isSame,
  isValidIPv4,
  isValidMACAddress,
  Ok,
  Outcome,
  prettyPrint,
  sleep
}
