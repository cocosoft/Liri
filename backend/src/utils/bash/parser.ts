/**
 * Bash 命令解析器
 *
 * 不使用 tree-sitter，采用正则/字符串方式解析 Bash 命令。
 * 参考 CC源码 cc_code/backend/utils/bash/parser.ts
 */

import { extractHeredocs } from './heredoc'
import {
  createSimpleCommand,
  extractEnvVars,
  extractRedirections,
  type ParseForSecurityResult,
  type SimpleCommand,
  SHELL_KEYWORDS,
} from './ast'

const MAX_COMMAND_LENGTH = 10000

const COMPLEX_PATTERNS = [
  /&&/,
  /\|\|/,
  /;/,
  /\|(?!\|)/,
  /`/,
  /\$\(/,
  /\(\(/,
  /\b(if|then|else|elif|fi|case|esac|for|while|until|do|done|function)\b/,
  /\bselect\b/,
]

export function splitPipeChain(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  const processChar = (ch: string, i: number) => {
    if (escapeNext) {
      current += ch
      escapeNext = false
      return
    }
    if (ch === '\\') {
      current += ch
      escapeNext = true
      return
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += ch
      return
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += ch
      return
    }
    if (ch === '|' && !inSingleQuote && !inDoubleQuote) {
      parts.push(current.trim())
      current = ''
      return
    }
    current += ch
  }

  for (let i = 0; i < command.length; i++) {
    processChar(command[i]!, i)
  }
  const last = current.trim()
  if (last) parts.push(last)

  return parts
}

export function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!

    if (escapeNext) {
      current += ch
      escapeNext = false
      continue
    }

    if (ch === '\\') {
      current += ch
      escapeNext = true
      continue
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += ch
      continue
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += ch
      continue
    }

    if (/\s/.test(ch) && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function isAllowedCommand(cmd: string): boolean {
  if (SHELL_KEYWORDS.has(cmd)) return false
  if (cmd.startsWith('-')) return false
  if (cmd.includes('/')) return false
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(cmd)
}

function checkCommandSafety(commands: SimpleCommand[]): boolean {
  for (const cmd of commands) {
    if (cmd.argv.length === 0) continue
    const commandName = cmd.argv[0]!
    if (!isAllowedCommand(commandName)) return false
  }
  return true
}

export function parseForSecurity(command: string): ParseForSecurityResult {
  const trimmed = command.trim()

  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return { kind: 'simple', commandText: command, commands: [] }
  }

  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return { kind: 'too-complex', reason: 'Command exceeds maximum length' }
  }

  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { kind: 'too-complex', reason: `Contains complex construct: ${pattern.source}` }
    }
  }

  const { processedCommand } = extractHeredocs(trimmed)
  const pipeline = splitPipeChain(processedCommand)
  const commands: SimpleCommand[] = []

  for (const segment of pipeline) {
    const tokens = tokenize(segment)
    const { cmdTokens, redirects } = extractRedirections(tokens)
    const cmd = createSimpleCommand(segment)

    cmd.redirects = redirects

    for (const token of cmdTokens) {
      const envVar = extractEnvVars(token)
      if (envVar) {
        cmd.envVars.set(envVar.name, envVar.value)
      } else {
        cmd.argv.push(token)
      }
    }

    commands.push(cmd)
  }

  if (!checkCommandSafety(commands)) {
    return { kind: 'too-complex', reason: 'Contains unsafe or complex command pattern' }
  }

  return { kind: 'simple', commandText: command, commands }
}
