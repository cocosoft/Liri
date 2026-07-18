// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * CLI Argv Parser
 * 对标OpenClaw cli/argv.ts
 * 命令行参数解析系统
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'cli\argv\index', level: LogLevel.INFO });

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  options: Record<string, unknown>;
  positional: string[];
  rest: string[];
  raw: string[];
}

export interface ArgvSchema {
  name: string;
  options?: ArgvOptionDef[];
  positional?: ArgvPositionalDef[];
  strict?: boolean;
}

export interface ArgvOptionDef {
  name: string;
  alias?: string;
  type?: 'string' | 'number' | 'boolean' | 'array';
  description?: string;
  default?: unknown;
  required?: boolean;
}

export interface ArgvPositionalDef {
  name: string;
  type?: 'string' | 'number';
  description?: string;
  required?: boolean;
  rest?: boolean;
}

export function parseArgv(argv: string[], schema?: ArgvSchema): ParsedArgs {
  const result: ParsedArgs = {
    command: '',
    options: {},
    positional: [],
    rest: [],
    raw: argv,
  };

  if (argv.length === 0) return result;

  result.command = argv[0];

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--') {
      i++;
      while (i < argv.length) {
        result.rest.push(argv[i]);
        i++;
      }
      break;
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        result.options[key] = coerceValue(key, value, schema);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        const key = arg.slice(2);
        const value = argv[i + 1];
        result.options[key] = coerceValue(key, value, schema);
        i++;
      } else {
        result.options[arg.slice(2)] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1 && arg[1] !== '-') {
      const flags = arg.slice(1);
      for (let j = 0; j < flags.length; j++) {
        const char = flags[j];
        const optDef = schema?.options?.find((o) => o.alias === char);
        if (optDef && optDef.type !== 'boolean' && j < flags.length - 1) {
          result.options[optDef.name] = coerceValue(
            optDef.name,
            flags.slice(j + 1),
            schema
          );
          break;
        }
        result.options[char] = true;
      }
    } else {
      result.positional.push(arg);
    }

    i++;
  }

  applyDefaults(result, schema);
  validateRequired(result, schema);

  return result;
}

function coerceValue(key: string, value: string, schema?: ArgvSchema): unknown {
  const optDef = schema?.options?.find((o) => o.name === key);
  const type = optDef?.type;

  if (type === 'array') {
    return value.split(',').map((v) => v.trim());
  }

  if (type === 'number') {
    const num = Number(value);
    return isNaN(num) ? value : num;
  }

  if (type === 'boolean') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

  return value;
}

function applyDefaults(result: ParsedArgs, schema?: ArgvSchema): void {
  if (!schema?.options) return;

  for (const opt of schema.options) {
    if (opt.default !== undefined && result.options[opt.name] === undefined) {
      result.options[opt.name] = opt.default;
    }

    if (opt.alias && result.options[opt.alias] !== undefined) {
      result.options[opt.name] = result.options[opt.alias];
      delete result.options[opt.alias];
    }
  }
}

function validateRequired(result: ParsedArgs, schema?: ArgvSchema): void {
  if (!schema?.options || schema.strict === false) return;

  const missing: string[] = [];

  for (const opt of schema.options) {
    if (opt.required && result.options[opt.name] === undefined) {
      missing.push(`--${opt.name}`);
    }
  }

  if (schema.positional) {
    for (let i = 0; i < schema.positional.length; i++) {
      const pos = schema.positional[i];
      if (pos.required && i >= result.positional.length) {
        missing.push(`<${pos.name}>`);
      }
    }
  }

  if (missing.length > 0) {
    throw new AppError(
      `Missing required arguments: ${missing.join(', ')}`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'INVALID_INPUT',
      { missing }
    );
  }
}

export function formatUsage(schema: ArgvSchema): string {
  const parts: string[] = [schema.name];

  if (schema.options) {
    for (const opt of schema.options) {
      if (opt.required) {
        parts.push(`--${opt.name} <${opt.type ?? 'value'}>`);
      } else {
        parts.push(`[--${opt.name} ${opt.alias ? `(-${opt.alias})` : ''}]`);
      }
    }
  }

  if (schema.positional) {
    for (const pos of schema.positional) {
      if (pos.required) {
        parts.push(`<${pos.name}>`);
      } else {
        parts.push(`[${pos.name}]`);
      }
    }
  }

  return parts.join(' ');
}

export function normalizeArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const singleCharKeys = Object.keys(args).filter((k) => k.length === 1);

  for (const [key, value] of Object.entries(args)) {
    if (!singleCharKeys.includes(key)) {
      result[key] = value;
    }
  }

  return result;
}
