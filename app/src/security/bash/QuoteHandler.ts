import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'security:bash:QuoteHandler',
  level: LogLevel.INFO,
});

export type QuoteResult = {
  quoted: string;
  success: boolean;
  error?: string;
};

export type UnquoteResult = {
  text: string;
  success: boolean;
};

const UNSAFE_CHARS_RE = /[^\w@%+=:,./-]/;

export function quoteArg(arg: string): string {
  if (!arg) {
    return "''";
  }

  if (!UNSAFE_CHARS_RE.test(arg)) {
    return arg;
  }

  let hasSingle = arg.includes("'");

  if (!hasSingle) {
    return `'${arg}'`;
  }

  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function quoteArgs(args: string[]): string {
  return args.map(quoteArg).join(' ');
}

export function tryQuoteArgs(args: unknown[]): QuoteResult {
  try {
    const validated: string[] = args.map((arg, index) => {
      if (arg === null || arg === undefined) {
        return String(arg);
      }
      const type = typeof arg;
      if (type === 'string' || type === 'number' || type === 'boolean') {
        return String(arg);
      }
      throw new AppError(
        `无法引用参数 at index ${index}: 不支持的类型 ${type}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    });
    const quoted = validated.map(quoteArg).join(' ');
    return { quoted, success: true };
  } catch (error) {
    return {
      quoted: '',
      success: false,
      error: error instanceof Error ? error.message : '引用失败',
    };
  }
}

export function unquoteArg(arg: string): UnquoteResult {
  if (!arg) {
    return { text: '', success: true };
  }

  if (arg.startsWith("'") && arg.endsWith("'")) {
    const inner = arg.slice(1, -1);
    return { text: inner.replace(/\\'/g, "'"), success: true };
  }

  if (arg.startsWith('"') && arg.endsWith('"')) {
    const inner = arg.slice(1, -1);
    return {
      text: inner
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\'),
      success: true,
    };
  }

  return { text: arg, success: true };
}

export function hasUnterminatedQuote(command: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (c === '\\' && !inSingle) {
      escapeNext = true;
      continue;
    }

    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
  }

  return inSingle || inDouble;
}

export function hasShellQuoteBug(command: string): boolean {
  let inSingle = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (c === "'") {
      inSingle = !inSingle;
      continue;
    }

    if (c === '\\' && inSingle && i + 1 < command.length) {
      const next = command[i + 1];
      if (next === "'") {
        return true;
      }
    }
  }

  return false;
}

export function escapeForShell(text: string): string {
  return text.replace(/[$`"\\!]/g, '\\$&');
}

export function escapeForDoubleQuotes(text: string): string {
  return text.replace(/[$`\\!"]/g, '\\$&');
}
