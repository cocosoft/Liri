/**
 * CLI打印工具
 * 提供统一的打印输出功能
 */

import { configManager } from '@modules/config';

export interface PrintOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?:
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white';
  bgColor?:
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white';
  prefix?: string;
  suffix?: string;
  indent?: number;
}

const COLOR_CODES: Record<string, string> = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const BG_COLOR_CODES: Record<string, string> = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';

export function formatText(text: string, options: PrintOptions = {}): string {
  let result = '';

  if (options.bold) result += BOLD;
  if (options.italic) result += ITALIC;
  if (options.underline) result += UNDERLINE;
  if (options.color) result += COLOR_CODES[options.color];
  if (options.bgColor) result += BG_COLOR_CODES[options.bgColor];

  if (options.indent) {
    result += ' '.repeat(options.indent);
  }

  if (options.prefix) {
    result += options.prefix;
  }

  result += text;

  if (options.suffix) {
    result += options.suffix;
  }

  result += RESET;

  return result;
}

export function print(text: string, options: PrintOptions = {}): void {
  console.log(formatText(text, options));
}

export function printInfo(text: string): void {
  console.log(formatText(text, { color: 'blue', prefix: 'ℹ️  ' }));
}

export function printSuccess(text: string): void {
  console.log(formatText(text, { color: 'green', prefix: '✅  ' }));
}

export function printWarning(text: string): void {
  console.log(formatText(text, { color: 'yellow', prefix: '⚠️  ' }));
}

export function printError(text: string): void {
  console.log(formatText(text, { color: 'red', prefix: '❌  ' }));
}

export function printDebug(text: string): void {
  if (configManager.env('Liri_DEBUG') === 'true') {
    console.log(formatText(text, { color: 'magenta', prefix: '🔍  ' }));
  }
}

export function printHeader(text: string): void {
  console.log();
  console.log(formatText(text, { bold: true, underline: true }));
  console.log();
}

export function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) return;

  const colWidths = headers.map((_, colIndex) => {
    const columnValues = [
      headers[colIndex],
      ...rows.map((row) => row[colIndex]),
    ];
    return Math.max(...columnValues.map((v) => v.length));
  });

  const formatRow = (row: string[]) => {
    return row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ');
  };

  console.log(formatText(formatRow(headers), { bold: true }));
  console.log(colWidths.map((w) => '-'.repeat(w)).join('-+-'));

  for (const row of rows) {
    console.log(formatRow(row));
  }
}

export function printList(items: string[], bullet = '-'): void {
  for (const item of items) {
    console.log(formatText(` ${bullet} ${item}`, { indent: 2 }));
  }
}

export function printKeyValue(
  key: string,
  value: string | number | boolean
): void {
  console.log(formatText(`${key}:`, { bold: true }) + ` ${value}`);
}

export function printSeparator(char = '-', length = 60): void {
  console.log(char.repeat(length));
}

export function printProgress(message: string, progress: number): void {
  const barLength = 20;
  const filled = Math.round(progress * barLength);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = Math.round(progress * 100);

  process.stdout.write(`\r${message}: [${bar}] ${percent}%`);

  if (progress >= 1) {
    console.log();
  }
}

export function printPrompt(prompt: string): void {
  process.stdout.write(formatText(prompt, { bold: true }) + ' ');
}

export function printCode(code: string, language?: string): void {
  console.log(formatText('```' + (language || ''), { color: 'cyan' }));
  console.log(code);
  console.log(formatText('```', { color: 'cyan' }));
}
