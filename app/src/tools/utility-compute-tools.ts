import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';

import {
  makeTool,
  booleanParam,
  stringParam,
  numberParam,
  type ToolExecResult,
} from './utility-helpers';
import type { Tool } from './types/Tool';
import { ToolTag as TT } from './types/Tool';

export function collectComputeTools(tools: Tool[]): void {
  // ========== 数学工具 (6) ==========

  tools.push(
    makeTool({
      name: 'math_calc',
      description:
        'Evaluate a mathematical expression safely using basic arithmetic operators',
      params: [
        stringParam(
          'expression',
          'Math expression to evaluate (e.g., "(1 + 2) * 3")',
          true
        ),
      ],
      aliases: ['calc', 'math', 'evaluate'],
      tags: [TT.CODE],
      execute: (input) => {
        const expr = input.expression as string;
        if (!expr) return { success: false, error: 'expression is required' };
        if (/[^0-9+\-*/.()%\s]/g.test(expr)) {
          return {
            success: false,
            error:
              'Expression contains invalid characters. Only numbers and basic operators (+, -, *, /, %, parentheses) are allowed.',
          };
        }
        try {
          const result = Function(`"use strict"; return (${expr})`)();
          return { success: true, output: String(result) };
        } catch (e) {
          return {
            success: false,
            error: `Evaluation failed: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'math_random',
      description:
        'Generate random numbers with various options (integer, float, or dice-roll style)',
      params: [
        numberParam('min', 'Minimum value (default: 0)'),
        numberParam('max', 'Maximum value (default: 100)'),
        booleanParam(
          'integer',
          'Generate integer instead of float (default: true)'
        ),
        numberParam(
          'count',
          'Number of values to generate (default: 1, max: 1000)'
        ),
      ],
      aliases: ['random', 'rand'],
      tags: [TT.CODE],
      execute: (input) => {
        const min = (input.min as number) ?? 0;
        const max = (input.max as number) ?? 100;
        const asInt = input.integer !== false;
        const count = Math.min(Math.max((input.count as number) || 1, 1), 1000);
        const results: number[] = [];
        for (let i = 0; i < count; i++) {
          const buf = crypto.randomBytes(4);
          const val = buf.readUInt32BE(0) / 0xffffffff;
          const num = min + val * (max - min);
          results.push(asInt ? Math.round(num) : Math.round(num * 100) / 100);
        }
        return {
          success: true,
          output: count === 1 ? String(results[0]) : JSON.stringify(results),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'math_stats',
      description:
        'Calculate statistical measures (sum, average/mean, min, max, median, count) from a list of numbers',
      params: [
        stringParam(
          'numbers',
          'Comma-separated or JSON array of numbers',
          true
        ),
      ],
      aliases: ['stats', 'statistics'],
      tags: [TT.CODE],
      execute: (input) => {
        let nums: number[];
        const raw = input.numbers as string;
        if (!raw) return { success: false, error: 'numbers are required' };
        try {
          nums = JSON.parse(raw);
        } catch {
          nums = raw
            .split(',')
            .map((s) => parseFloat(s.trim()))
            .filter((n) => !isNaN(n));
        }
        if (nums.length === 0)
          return { success: false, error: 'No valid numbers provided' };
        const sorted = [...nums].sort((a, b) => a - b);
        const sum = nums.reduce((a, b) => a + b, 0);
        const avg = sum / nums.length;
        const mid = Math.floor(sorted.length / 2);
        const median =
          sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
        return {
          success: true,
          output: JSON.stringify({
            sum,
            average: avg,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            median,
            count: nums.length,
          }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'math_convert',
      description:
        'Convert between units of length, weight, temperature, data size, and time',
      params: [
        numberParam('value', 'Value to convert', true),
        stringParam(
          'from',
          'Source unit (e.g., "km", "lb", "celsius", "MB", "hours")',
          true
        ),
        stringParam(
          'to',
          'Target unit (e.g., "mi", "kg", "fahrenheit", "GB", "minutes")',
          true
        ),
      ],
      aliases: ['convert', 'unit_convert'],
      tags: [TT.CODE],
      execute: (input) => {
        const value = input.value as number;
        const from = (input.from as string)?.toLowerCase();
        const to = (input.to as string)?.toLowerCase();
        if (value === undefined || !from || !to) {
          return { success: false, error: 'value, from, and to are required' };
        }

        const conversions: Record<
          string,
          Record<string, (v: number) => number>
        > = {
          km: { mi: (v) => v * 0.621371, m: (v) => v * 1000 },
          mi: { km: (v) => v * 1.60934, m: (v) => v * 1609.34 },
          kg: { lb: (v) => v * 2.20462, g: (v) => v * 1000 },
          lb: { kg: (v) => v * 0.453592, g: (v) => v * 453.592 },
          celsius: {
            fahrenheit: (v) => (v * 9) / 5 + 32,
            kelvin: (v) => v + 273.15,
          },
          fahrenheit: {
            celsius: (v) => ((v - 32) * 5) / 9,
            kelvin: (v) => ((v - 32) * 5) / 9 + 273.15,
          },
          mb: { gb: (v) => v / 1024, kb: (v) => v * 1024 },
          gb: { mb: (v) => v * 1024, kb: (v) => v * 1024 * 1024 },
        };

        if (conversions[from]?.[to]) {
          const result = conversions[from][to](value);
          return {
            success: true,
            output: JSON.stringify({ value: result, from, to }),
          };
        }
        return {
          success: false,
          error: `Conversion from "${from}" to "${to}" not supported`,
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'math_round',
      description:
        'Round a number to specified decimal places using various rounding modes',
      params: [
        numberParam('value', 'Number to round', true),
        numberParam('decimals', 'Decimal places (default: 0)'),
        stringParam(
          'mode',
          'Rounding mode: round, floor, ceil (default: round)'
        ),
      ],
      aliases: ['round'],
      tags: [TT.CODE],
      execute: (input) => {
        const value = input.value as number;
        if (value === undefined)
          return { success: false, error: 'value is required' };
        const decimals = (input.decimals as number) ?? 0;
        const mode = (input.mode as string) || 'round';
        const factor = Math.pow(10, decimals);
        let result: number;
        switch (mode) {
          case 'floor':
            result = Math.floor(value * factor) / factor;
            break;
          case 'ceil':
            result = Math.ceil(value * factor) / factor;
            break;
          default:
            result = Math.round(value * factor) / factor;
            break;
        }
        return { success: true, output: String(result) };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'math_sequence',
      description: 'Generate numeric sequences: range, fibonacci, or powers',
      params: [
        numberParam('start', 'Start value'),
        numberParam('end', 'End value'),
        numberParam('step', 'Step value (default: 1)'),
        stringParam(
          'type',
          'Sequence type: range (default), fibonacci, powers'
        ),
        numberParam('count', 'Number of elements (for fibonacci/powers)'),
      ],
      aliases: ['sequence', 'range'],
      tags: [TT.CODE],
      execute: (input) => {
        const type = (input.type as string) || 'range';
        const count = Math.min((input.count as number) || 10, 100);
        let result: number[];

        switch (type) {
          case 'fibonacci': {
            result = [0, 1];
            for (let i = 2; i < count; i++) {
              result.push(result[i - 1] + result[i - 2]);
            }
            if (count <= 0) result = [];
            else if (count === 1) result = [0];
            break;
          }
          case 'powers': {
            const start = (input.start as number) || 1;
            result = Array.from({ length: count }, (_, i) =>
              Math.pow(start, i + 1)
            );
            break;
          }
          default: {
            const start = (input.start as number) ?? 0;
            const end = (input.end as number) ?? 10;
            const step = (input.step as number) ?? 1;
            result = [];
            for (let i = start; i <= end; i += step) {
              result.push(i);
            }
            break;
          }
        }
        return { success: true, output: JSON.stringify(result) };
      },
    })
  );

  // ========== 日期/时间工具 (4) ==========

  tools.push(
    makeTool({
      name: 'timestamp',
      description:
        'Get current timestamp in various formats (unix seconds, unix ms, ISO 8601)',
      params: [
        stringParam('format', 'Format: unix, unix_ms, iso (default: iso)'),
      ],
      aliases: ['now', 'current_time'],
      tags: [TT.CODE],
      execute: (input) => {
        const format = (input.format as string) || 'iso';
        const now = Date.now();
        switch (format) {
          case 'unix':
            return { success: true, output: String(Math.floor(now / 1000)) };
          case 'unix_ms':
            return { success: true, output: String(now) };
          default:
            return { success: true, output: new Date(now).toISOString() };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'date_format',
      description:
        'Format a date/time string into custom format like "YYYY-MM-DD HH:mm:ss"',
      params: [
        stringParam(
          'date',
          'Date string (ISO 8601 or natural), defaults to now'
        ),
        stringParam(
          'format',
          'Format: iso, local, date, time, or custom tokens'
        ),
        stringParam(
          'timezone',
          'Timezone (e.g., "Asia/Shanghai", "America/New_York")'
        ),
      ],
      aliases: ['format_date', 'date_fmt'],
      tags: [TT.CODE],
      execute: (input) => {
        const dateStr = input.date as string;
        const fmt = (input.format as string) || 'iso';
        const date = dateStr ? new Date(dateStr) : new Date();
        if (isNaN(date.getTime()))
          return { success: false, error: 'Invalid date' };

        switch (fmt) {
          case 'local':
            return { success: true, output: date.toString() };
          case 'date':
            return { success: true, output: date.toDateString() };
          case 'time':
            return { success: true, output: date.toTimeString() };
          default:
            const pad = (n: number) => String(n).padStart(2, '0');
            const result = fmt
              .replace('YYYY', String(date.getFullYear()))
              .replace('MM', pad(date.getMonth() + 1))
              .replace('DD', pad(date.getDate()))
              .replace('HH', pad(date.getHours()))
              .replace('mm', pad(date.getMinutes()))
              .replace('ss', pad(date.getSeconds()));
            return { success: true, output: result };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'date_diff',
      description:
        'Calculate time difference between two dates in various units',
      params: [
        stringParam('start', 'Start date string (ISO 8601)', true),
        stringParam('end', 'End date string (ISO 8601), defaults to now'),
        stringParam(
          'unit',
          'Output unit: ms, seconds, minutes, hours, days (default: ms)'
        ),
      ],
      aliases: ['datediff', 'date_difference'],
      tags: [TT.CODE],
      execute: (input) => {
        const startStr = input.start as string;
        if (!startStr)
          return { success: false, error: 'start date is required' };
        const endStr = (input.end as string) || new Date().toISOString();
        const start = new Date(startStr).getTime();
        const end = new Date(endStr).getTime();
        if (isNaN(start))
          return { success: false, error: 'Invalid start date' };
        if (isNaN(end)) return { success: false, error: 'Invalid end date' };
        const diffMs = end - start;
        const unit = (input.unit as string) || 'ms';
        const units: Record<string, number> = {
          ms: 1,
          seconds: 1000,
          minutes: 60000,
          hours: 3600000,
          days: 86400000,
        };
        const divisor = units[unit] || 1;
        return {
          success: true,
          output: JSON.stringify({
            diff: diffMs / divisor,
            unit,
            start: startStr,
            end: endStr,
          }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'date_parse',
      description:
        'Parse a date string into its components (year, month, day, hour, minute, second, day of week, timezone)',
      params: [stringParam('date', 'Date string to parse, defaults to now')],
      aliases: ['parse_date'],
      tags: [TT.CODE],
      execute: (input) => {
        const dateStr = input.date as string;
        const date = dateStr ? new Date(dateStr) : new Date();
        if (isNaN(date.getTime()))
          return { success: false, error: 'Invalid date' };
        const days = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        return {
          success: true,
          output: JSON.stringify({
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            hour: date.getHours(),
            minute: date.getMinutes(),
            second: date.getSeconds(),
            millisecond: date.getMilliseconds(),
            dayOfWeek: days[date.getDay()],
            unix_ms: date.getTime(),
            iso: date.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        };
      },
    })
  );

  // ========== 系统信息工具 (6) ==========

  tools.push(
    makeTool({
      name: 'os_info',
      description:
        'Get operating system information including platform, architecture, hostname, and available CPU cores',
      params: [],
      aliases: ['system_info', 'sysinfo'],
      tags: [TT.SYSTEM],
      execute: () => {
        return {
          success: true,
          output: JSON.stringify({
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: os.uptime(),
            type: os.type(),
            release: os.release(),
            userInfo: os.userInfo().username,
            tmpdir: os.tmpdir(),
          }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'env_get',
      description:
        'Get environment variable values. Returns masked value for sensitive variables containing KEY, SECRET, TOKEN, PASSWORD',
      params: [
        stringParam(
          'name',
          'Environment variable name. If omitted, returns all variable names.',
          false
        ),
      ],
      aliases: ['getenv', 'env'],
      tags: [TT.SYSTEM],
      execute: (input) => {
        const name = input.name as string;
        if (name) {
          const val = process.env[name];
          if (val === undefined)
            return {
              success: false,
              error: `Environment variable "${name}" not set`,
            };
          const sensitive = /key|secret|token|password/i.test(name);
          return {
            success: true,
            output: sensitive ? '*** (masked for security)' : val,
          };
        }
        const keys = Object.keys(process.env).sort();
        return { success: true, output: JSON.stringify(keys) };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'disk_usage',
      description:
        'Get disk/drive usage information for the current filesystem',
      params: [
        stringParam(
          'path',
          'Path to check (default: current working directory)'
        ),
      ],
      aliases: ['disk', 'df'],
      tags: [TT.SYSTEM],
      execute: (input) => {
        const targetPath = (input.path as string) || process.cwd();
        try {
          const stats = fs.statSync(targetPath);
          return {
            success: true,
            output: JSON.stringify({
              path: targetPath,
              isDirectory: stats.isDirectory(),
              sizeBytes: stats.size,
              mode: stats.mode.toString(8),
            }),
          };
        } catch (e) {
          return {
            success: false,
            error: `Cannot access path: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'memory_info',
      description:
        'Get current Node.js process memory usage (heap, RSS, external) in megabytes',
      params: [],
      aliases: ['mem', 'memory'],
      tags: [TT.SYSTEM],
      execute: () => {
        const usage = process.memoryUsage();
        return {
          success: true,
          output: JSON.stringify({
            rss: Math.round((usage.rss / 1024 / 1024) * 100) / 100,
            heapTotal: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
            heapUsed: Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100,
            external: Math.round((usage.external / 1024 / 1024) * 100) / 100,
            unit: 'MB',
          }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'process_info',
      description:
        'Get information about the current Node.js process including PID, uptime, version, and arguments',
      params: [],
      aliases: ['ps', 'proc'],
      tags: [TT.SYSTEM],
      execute: () => ({
        success: true,
        output: JSON.stringify({
          pid: process.pid,
          title: process.title,
          uptime: process.uptime(),
          nodeVersion: process.version,
          versions: process.versions,
          cwd: process.cwd(),
          argv: process.argv,
          execPath: process.execPath,
        }),
      }),
    })
  );

  tools.push(
    makeTool({
      name: 'uptime',
      description: 'Get system and process uptime in human-readable format',
      params: [],
      aliases: ['up'],
      tags: [TT.SYSTEM],
      execute: () => {
        const sysSec = os.uptime();
        const procSec = process.uptime();
        const fmt = (s: number) => {
          const d = Math.floor(s / 86400);
          const h = Math.floor((s % 86400) / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sec = Math.floor(s % 60);
          return `${d}d ${h}h ${m}m ${sec}s`;
        };
        return {
          success: true,
          output: JSON.stringify({
            system: fmt(sysSec),
            process: fmt(procSec),
            systemSeconds: sysSec,
            processSeconds: Math.round(procSec),
          }),
        };
      },
    })
  );

  // ========== 安全工具 (3) ==========

  tools.push(
    makeTool({
      name: 'password_generate',
      description:
        'Generate a cryptographically secure random password with configurable length and character types',
      params: [
        numberParam(
          'length',
          'Password length (default: 16, min: 8, max: 128)'
        ),
        booleanParam('symbols', 'Include special symbols (default: true)'),
        booleanParam('numbers', 'Include numbers (default: true)'),
        booleanParam('uppercase', 'Include uppercase letters (default: true)'),
        booleanParam('lowercase', 'Include lowercase letters (default: true)'),
      ],
      aliases: ['gen_password', 'genpwd'],
      tags: [TT.SYSTEM],
      execute: (input) => {
        const length = Math.min(
          Math.max((input.length as number) || 16, 8),
          128
        );
        const useSymbols = input.symbols !== false;
        const useNumbers = input.numbers !== false;
        const useUpper = input.uppercase !== false;
        const useLower = input.lowercase !== false;

        let chars = '';
        if (useLower) chars += 'abcdefghijklmnopqrstuvwxyz';
        if (useUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (useNumbers) chars += '0123456789';
        if (useSymbols) chars += '!@#$%^&*()-_=+[]{}|;:,.<>?';

        if (!chars)
          return {
            success: false,
            error: 'At least one character type must be enabled',
          };

        let password = '';
        const bytes = crypto.randomBytes(length);
        for (let i = 0; i < length; i++) {
          password += chars[bytes[i] % chars.length];
        }
        return { success: true, output: password };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'token_generate',
      description:
        'Generate a cryptographically secure random token for API keys, auth tokens, or session IDs',
      params: [
        numberParam(
          'bytes',
          'Token size in bytes (default: 32, min: 16, max: 256)'
        ),
        stringParam('encoding', 'Encoding: hex (default), base64, base64url'),
      ],
      aliases: ['gen_token', 'gentkn'],
      tags: [TT.SYSTEM],
      execute: (input) => {
        const bytes = Math.min(
          Math.max((input.bytes as number) || 32, 16),
          256
        );
        const encoding = (input.encoding as string) || 'hex';
        const token = crypto
          .randomBytes(bytes)
          .toString(encoding as BufferEncoding);
        return { success: true, output: token };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'hash_compare',
      description:
        'Compare a plain text string against a hash to verify if they match (supports MD5, SHA1, SHA256)',
      params: [
        stringParam('text', 'Plain text to compare', true),
        stringParam('hash', 'Hash string to compare against', true),
        stringParam(
          'algorithm',
          'Hash algorithm: md5, sha1, sha256 (default: sha256)'
        ),
      ],
      aliases: ['verify_hash', 'hash_check'],
      tags: [TT.SYSTEM],
      execute: (input) => {
        const text = input.text as string;
        const hash = input.hash as string;
        if (!text || !hash)
          return { success: false, error: 'text and hash are required' };
        const algorithm = (input.algorithm as string) || 'sha256';
        const computed = crypto
          .createHash(algorithm)
          .update(text)
          .digest('hex');
        const match = computed === hash;
        return {
          success: true,
          output: JSON.stringify({ match, algorithm, computedHash: computed }),
        };
      },
    })
  );
}
