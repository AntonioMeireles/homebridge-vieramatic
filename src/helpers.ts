const isEmpty = (obj: Record<string, unknown>): boolean =>
  Object.keys(obj).length === 0 && obj.constructor === Object

// vscode decorator trickery
const lit = (s: TemplateStringsArray, ...args: string[]): string =>
  s.map((ss, i) => `${ss}${args[i] ?? ''}`).join('')
const html = lit

export { isEmpty, html }
