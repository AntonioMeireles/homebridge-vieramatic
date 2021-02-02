import util from 'util'

const sleep = async (ms: number): Promise<unknown> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const isEmpty = (obj: Record<string, unknown>): boolean =>
  Object.keys(obj).length === 0 && obj.constructor === Object

const printf = util.format
// vscode decorator trickery
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

const Abnormal = (result: unknown): result is Failure =>
  (result as Failure).error != null

export { sleep, isEmpty, html, Outcome, printf, Abnormal }
