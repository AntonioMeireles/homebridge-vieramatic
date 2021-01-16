const isEmpty = (obj: Record<string, unknown>): boolean =>
  Object.keys(obj).length === 0 && obj.constructor === Object

// vscode decorator trickery
const lit = (s: TemplateStringsArray, ...args: string[]): string =>
  s.map((ss, i) => `${ss}${args[i] ?? ''}`).join('')
const html = lit

// error handling
interface ExpectedOutcome<T> {
  value: T
}

interface BadOutcome {
  error: Error
}

type Outcome<T> = ExpectedOutcome<T> | BadOutcome

const NotExpected = (obj: unknown): obj is BadOutcome =>
  (obj as BadOutcome).error != null

export { isEmpty, html, Outcome, NotExpected }
