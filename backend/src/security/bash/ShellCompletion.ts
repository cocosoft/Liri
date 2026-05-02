export type CompletionType = 'command' | 'file' | 'variable' | 'option'

export type CompletionContext = {
  prefix: string
  completionType: CompletionType
  beforeCursor: string
}

export type CompletionItem = {
  value: string
  display: string
  type: CompletionType
  description?: string
}

const COMMAND_OPERATORS = new Set(['|', '||', '&&', ';', '&'])

const BUILTIN_VARIABLES = [
  'HOME', 'PWD', 'OLDPWD', 'USER', 'PATH', 'SHELL',
  'HOSTNAME', 'LANG', 'TERM', 'EDITOR', 'DISPLAY',
  'TMPDIR', 'TEMP', 'TMP',
  'LOGNAME', 'UID', 'EUID', 'GROUPS',
  'HISTSIZE', 'HISTFILE', 'HISTFILESIZE',
  'PS1', 'PS2', 'PS4',
  'LINES', 'COLUMNS',
  'IFS', 'PPID', 'RANDOM', 'SECONDS',
]

function isQuoteChar(c: string): boolean {
  return c === '"' || c === "'"
}

function tokenizeSimple(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < input.length; i++) {
    const c = input[i]

    if (inQuote) {
      current += c
      if (c === quoteChar) {
        inQuote = false
      }
      continue
    }

    if (c === '\\') {
      current += c + (input[i + 1] || '')
      i++
      continue
    }

    if (isQuoteChar(c)) {
      inQuote = true
      quoteChar = c
      current += c
      continue
    }

    if (/\s/.test(c)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += c
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

export function parseCompletionContext(
  input: string,
  cursorOffset: number,
): CompletionContext {
  const beforeCursor = input.slice(0, cursorOffset)

  if (!beforeCursor.trim()) {
    return { prefix: '', completionType: 'command', beforeCursor }
  }

  const varMatch = beforeCursor.match(/\$[a-zA-Z_][a-zA-Z0-9_]*$/)
  if (varMatch) {
    return { prefix: varMatch[0], completionType: 'variable', beforeCursor }
  }

  const tokens = tokenizeSimple(beforeCursor)
  const lastToken = tokens[tokens.length - 1] || ''

  if (beforeCursor.endsWith(' ') || beforeCursor.endsWith('\t')) {
    const lastNonSpace = tokens[tokens.length - 1]
    if (lastNonSpace && COMMAND_OPERATORS.has(lastNonSpace)) {
      return { prefix: '', completionType: 'command', beforeCursor }
    }
    if (tokens.length === 0 || (lastNonSpace && COMMAND_OPERATORS.has(lastNonSpace))) {
      return { prefix: '', completionType: 'command', beforeCursor }
    }
    return { prefix: '', completionType: 'file', beforeCursor }
  }

  if (COMMAND_OPERATORS.has(lastToken)) {
    return { prefix: '', completionType: 'command', beforeCursor }
  }

  if (lastToken.startsWith('-')) {
    return { prefix: lastToken, completionType: 'option', beforeCursor }
  }

  if (lastToken.startsWith('/') || lastToken.startsWith('./') || lastToken.startsWith('~/')) {
    return { prefix: lastToken, completionType: 'file', beforeCursor }
  }

  const isFirstToken = tokens.length === 1 && !beforeCursor.startsWith(' ')
  if (isFirstToken) {
    return { prefix: lastToken, completionType: 'command', beforeCursor }
  }

  return { prefix: lastToken, completionType: 'file', beforeCursor }
}

export function matchVariables(prefix: string): CompletionItem[] {
  const varName = prefix.replace(/^\$/, '')
  if (!varName) {
    return BUILTIN_VARIABLES.map(v => ({
      value: `$${v}`,
      display: `$${v}`,
      type: 'variable' as CompletionType,
    }))
  }

  const lowerName = varName.toLowerCase()
  return BUILTIN_VARIABLES
    .filter(v => v.toLowerCase().startsWith(lowerName))
    .map(v => ({
      value: `$${v}`,
      display: `$${v}`,
      type: 'variable' as CompletionType,
    }))
}

export function matchCommands(
  prefix: string,
  knownCommands: string[],
): CompletionItem[] {
  if (!prefix) {
    return knownCommands.slice(0, 20).map(c => ({
      value: c,
      display: c,
      type: 'command' as CompletionType,
    }))
  }

  const lowerPrefix = prefix.toLowerCase()
  return knownCommands
    .filter(c => c.toLowerCase().startsWith(lowerPrefix))
    .slice(0, 20)
    .map(c => ({
      value: c,
      display: c,
      type: 'command' as CompletionType,
    }))
}

export function generateShellCompletion(
  context: CompletionContext,
  knownCommands?: string[],
): CompletionItem[] {
  const commands = knownCommands || []

  switch (context.completionType) {
    case 'command':
      return matchCommands(context.prefix, commands)
    case 'variable':
      return matchVariables(context.prefix)
    case 'file':
      return []
    case 'option':
      return []
    default:
      return []
  }
}
