/**
 * UtilityTools - 轻量级效用工具集
 * 包含编码/解码、哈希、文本转换、数学、系统信息等常用工具
 * 每个工具实现 Tool 接口，通过 createUtilityTools() 批量创建
 */
import type { Tool, ToolParam, ToolTag } from './types/Tool';
import { ToolTag as TT } from './types/Tool';
import { readSoulMd, writeSoulMd } from '@modules/services/soul/SoulReader';
import { readUserMd, writeUserMd } from '@modules/services/soul/UserReader';

interface ToolFactoryFn {
  (): Tool[];
}

function booleanParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'boolean', description: desc, required };
}

function stringParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'string', description: desc, required };
}

function numberParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'number', description: desc, required };
}

function anyParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'object', description: desc, required };
}

type ToolExecResult = { success: boolean; output?: string; error?: string };

function makeTool(def: {
  name: string;
  description: string;
  params: ToolParam[];
  aliases?: string[];
  tags?: ToolTag[];
  execute:
    | ((input: Record<string, unknown>) => ToolExecResult)
    | ((input: Record<string, unknown>) => Promise<ToolExecResult>);
}): Tool {
  return {
    name: def.name,
    description: def.description,
    params: def.params,
    aliases: def.aliases,
    tags: def.tags,
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    execute: async (input: Record<string, unknown>) => def.execute(input),
    getInfo: () => ({
      name: def.name,
      description: def.description,
      params: def.params,
      aliases: def.aliases,
      tags: def.tags,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block' as const,
    }),
  };
}

/**
 * 批量创建所有效用工具
 */
export function createUtilityTools(): Tool[] {
  const tools: Tool[] = [];

  // ========== 编码/解码工具 (7) ==========

  tools.push(
    makeTool({
      name: 'base64_encode',
      description:
        'Encode text or binary data to Base64 format for safe transmission in URLs or text-based protocols',
      params: [stringParam('text', 'Text to encode', true)],
      aliases: ['b64enc', 'to_base64'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return {
          success: true,
          output: Buffer.from(text, 'utf-8').toString('base64'),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'base64_decode',
      description: 'Decode Base64 encoded string back to plain text',
      params: [stringParam('text', 'Base64 encoded string to decode', true)],
      aliases: ['b64dec', 'from_base64'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        try {
          return {
            success: true,
            output: Buffer.from(text, 'base64').toString('utf-8'),
          };
        } catch {
          return { success: false, error: 'Invalid Base64 input' };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'url_encode',
      description:
        'Percent-encode a URL string, converting special characters to safe %XX sequences',
      params: [stringParam('text', 'Text to URL-encode', true)],
      aliases: ['urienc'],
      tags: [TT.NETWORK],
      execute: (input) => ({
        success: true,
        output: encodeURIComponent(input.text as string),
      }),
    })
  );

  tools.push(
    makeTool({
      name: 'url_decode',
      description:
        'Decode a percent-encoded URL string back to its original form',
      params: [stringParam('text', 'URL-encoded string to decode', true)],
      aliases: ['uridec'],
      tags: [TT.NETWORK],
      execute: (input) => {
        try {
          return {
            success: true,
            output: decodeURIComponent(input.text as string),
          };
        } catch {
          return { success: false, error: 'Invalid URL-encoded input' };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'hex_encode',
      description: 'Convert text to hexadecimal representation',
      params: [stringParam('text', 'Text to convert to hex', true)],
      aliases: ['to_hex'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return {
          success: true,
          output: Buffer.from(text, 'utf-8').toString('hex'),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'hex_decode',
      description: 'Convert hexadecimal string back to plain text',
      params: [stringParam('text', 'Hex string to decode', true)],
      aliases: ['from_hex'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        try {
          return {
            success: true,
            output: Buffer.from(text, 'hex').toString('utf-8'),
          };
        } catch {
          return { success: false, error: 'Invalid hex input' };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'json_escape',
      description:
        'Escape special characters in a string for safe inclusion in JSON',
      params: [stringParam('text', 'Text to JSON-escape', true)],
      aliases: [],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return { success: true, output: JSON.stringify(text).slice(1, -1) };
      },
    })
  );

  // ========== 哈希工具 (3) ==========

  tools.push(
    makeTool({
      name: 'md5_hash',
      description: 'Compute MD5 hash of input text using Node.js crypto module',
      params: [
        stringParam('text', 'Text to hash', true),
        stringParam('encoding', 'Output encoding: hex (default) or base64'),
      ],
      aliases: ['md5'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        const crypto = require('crypto');
        const encoding = (input.encoding as string) || 'hex';
        return {
          success: true,
          output: crypto.createHash('md5').update(text).digest(encoding),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'sha1_hash',
      description: 'Compute SHA-1 hash of input text',
      params: [
        stringParam('text', 'Text to hash', true),
        stringParam('encoding', 'Output encoding: hex (default) or base64'),
      ],
      aliases: ['sha1'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        const crypto = require('crypto');
        const encoding = (input.encoding as string) || 'hex';
        return {
          success: true,
          output: crypto.createHash('sha1').update(text).digest(encoding),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'sha256_hash',
      description:
        'Compute SHA-256 hash of input text, commonly used for checksums and verification',
      params: [
        stringParam('text', 'Text to hash', true),
        stringParam('encoding', 'Output encoding: hex (default) or base64'),
      ],
      aliases: ['sha256'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        const crypto = require('crypto');
        const encoding = (input.encoding as string) || 'hex';
        return {
          success: true,
          output: crypto.createHash('sha256').update(text).digest(encoding),
        };
      },
    })
  );

  // ========== 文本转换工具 (9) ==========

  tools.push(
    makeTool({
      name: 'case_upper',
      description: 'Convert text to UPPERCASE',
      params: [stringParam('text', 'Text to convert to uppercase', true)],
      aliases: ['uppercase', 'to_upper'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return { success: true, output: text.toUpperCase() };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'case_lower',
      description: 'Convert text to lowercase',
      params: [stringParam('text', 'Text to convert to lowercase', true)],
      aliases: ['lowercase', 'to_lower'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return { success: true, output: text.toLowerCase() };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'case_title',
      description:
        'Convert text to Title Case (capitalize first letter of each word)',
      params: [stringParam('text', 'Text to convert to title case', true)],
      aliases: ['titlecase', 'capitalize'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return {
          success: true,
          output: text.replace(
            /\w\S*/g,
            (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
          ),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'case_camel',
      description:
        'Convert text to camelCase (e.g., "hello world" → "helloWorld")',
      params: [stringParam('text', 'Text to convert to camelCase', true)],
      aliases: ['camelcase', 'to_camel'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return {
          success: true,
          output: text
            .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
            .replace(/^(.)/, (c) => c.toLowerCase()),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'case_snake',
      description:
        'Convert text to snake_case (e.g., "hello world" → "hello_world")',
      params: [stringParam('text', 'Text to convert to snake_case', true)],
      aliases: ['snakecase', 'to_snake'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return {
          success: true,
          output: text
            .replace(/([A-Z])/g, '_$1')
            .replace(/[-_\s]+/g, '_')
            .replace(/^_/, '')
            .toLowerCase(),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'case_kebab',
      description:
        'Convert text to kebab-case (e.g., "hello world" → "hello-world")',
      params: [stringParam('text', 'Text to convert to kebab-case', true)],
      aliases: ['kebabcase', 'to_kebab'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return {
          success: true,
          output: text
            .replace(/([A-Z])/g, '-$1')
            .replace(/[_\s]+/g, '-')
            .replace(/^-/, '')
            .toLowerCase(),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'text_trim',
      description: 'Trim whitespace from the beginning and end of text',
      params: [stringParam('text', 'Text to trim', true)],
      aliases: ['trim'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        return { success: true, output: text.trim() };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'text_count',
      description: 'Count characters, words, and lines in text',
      params: [stringParam('text', 'Text to analyze', true)],
      aliases: ['count', 'wc'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        const chars = text.length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const lines = text.split('\n').length;
        return {
          success: true,
          output: JSON.stringify({ characters: chars, words, lines }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'text_split',
      description:
        'Split text by a delimiter and return the parts as a JSON array',
      params: [
        stringParam('text', 'Text to split', true),
        stringParam('delimiter', 'Delimiter to split by (default: newline)'),
      ],
      aliases: ['split'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        const delimiter = (input.delimiter as string) || '\n';
        const parts = text.split(delimiter);
        return { success: true, output: JSON.stringify(parts) };
      },
    })
  );

  // ========== JSON/数据工具 (5) ==========

  tools.push(
    makeTool({
      name: 'json_validate',
      description:
        'Validate whether a string is valid JSON and return parse result',
      params: [stringParam('json', 'JSON string to validate', true)],
      aliases: ['validate_json'],
      tags: [TT.CODE],
      execute: (input) => {
        const json = input.json as string;
        if (!json) return { success: false, error: 'json is required' };
        try {
          JSON.parse(json);
          return { success: true, output: 'Valid JSON' };
        } catch (e: any) {
          return { success: false, error: `Invalid JSON: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'json_format',
      description: 'Pretty-print a JSON string with configurable indentation',
      params: [
        stringParam('json', 'JSON string to format', true),
        numberParam('indent', 'Indentation spaces (default: 2)'),
      ],
      aliases: ['pretty_json', 'format_json'],
      tags: [TT.CODE],
      execute: (input) => {
        const json = input.json as string;
        if (!json) return { success: false, error: 'json is required' };
        try {
          const indent = (input.indent as number) || 2;
          const parsed = JSON.parse(json);
          return {
            success: true,
            output: JSON.stringify(parsed, null, indent),
          };
        } catch (e: any) {
          return { success: false, error: `Invalid JSON: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'json_query',
      description:
        'Query a JSON object using dot-notation path (e.g., "users.0.name")',
      params: [
        stringParam('json', 'JSON string to query', true),
        stringParam('path', 'Dot-notation path to extract', true),
      ],
      aliases: ['jq', 'json_path'],
      tags: [TT.CODE],
      execute: (input) => {
        const json = input.json as string;
        const path = input.path as string;
        if (!json || !path)
          return { success: false, error: 'json and path are required' };
        try {
          let obj = JSON.parse(json);
          const parts = path.split('.');
          for (const part of parts) {
            if (obj === undefined || obj === null) {
              return {
                success: false,
                error: `Path "${path}" not found at "${part}"`,
              };
            }
            obj = obj[part];
          }
          return { success: true, output: JSON.stringify(obj) };
        } catch (e: any) {
          return { success: false, error: `Query failed: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'uuid_generate',
      description:
        'Generate a random UUID (v4) for use as identifiers, keys, or correlation IDs',
      params: [
        numberParam(
          'count',
          'Number of UUIDs to generate (default: 1, max: 100)'
        ),
      ],
      aliases: ['uuid', 'gen_uuid'],
      tags: [TT.CODE],
      execute: (input) => {
        const crypto = require('crypto');
        const count = Math.min(Math.max((input.count as number) || 1, 1), 100);
        const uuids: string[] = [];
        for (let i = 0; i < count; i++) {
          uuids.push(crypto.randomUUID());
        }
        return {
          success: true,
          output: count === 1 ? uuids[0] : JSON.stringify(uuids),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'slug_generate',
      description:
        'Generate a URL-friendly slug from text (e.g., "Hello World!" → "hello-world")',
      params: [stringParam('text', 'Text to convert to slug', true)],
      aliases: ['slug', 'url_slug'],
      tags: [TT.CODE],
      execute: (input) => {
        const text = input.text as string;
        if (!text) return { success: false, error: 'text is required' };
        const slug = text
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        return { success: true, output: slug || 'invalid-input' };
      },
    })
  );

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
        } catch (e: any) {
          return { success: false, error: `Evaluation failed: ${e.message}` };
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
        const crypto = require('crypto');
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
        const os = require('os');
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
        const fs = require('fs');
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
        } catch (e: any) {
          return { success: false, error: `Cannot access path: ${e.message}` };
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
        const os = require('os');
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
        const crypto = require('crypto');
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
        const crypto = require('crypto');
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
        const crypto = require('crypto');
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

  // ========== 网络工具 (4) ==========

  tools.push(
    makeTool({
      name: 'http_get',
      description:
        'Perform a simple HTTP GET request and return the response body, status code, and headers',
      params: [
        stringParam('url', 'URL to fetch', true),
        numberParam('timeout', 'Timeout in milliseconds (default: 10000)'),
      ],
      aliases: ['fetch_get'],
      tags: [TT.NETWORK],
      execute: async (input) => {
        const url = input.url as string;
        if (!url) return { success: false, error: 'url is required' };
        const timeout = (input.timeout as number) || 10000;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          const body = await response.text();
          return {
            success: true,
            output: JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              headers: (() => {
                const h: Record<string, string> = {};
                response.headers.forEach((v, k) => {
                  h[k] = v;
                });
                return h;
              })(),
              bodyLength: body.length,
              body: body.slice(0, 10000),
            }),
          };
        } catch (e: any) {
          return { success: false, error: `HTTP request failed: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'http_head',
      description:
        'Perform an HTTP HEAD request to retrieve response headers without the body content',
      params: [
        stringParam('url', 'URL to check', true),
        numberParam('timeout', 'Timeout in milliseconds (default: 10000)'),
      ],
      aliases: ['head_request'],
      tags: [TT.NETWORK],
      execute: async (input) => {
        const url = input.url as string;
        if (!url) return { success: false, error: 'url is required' };
        const timeout = (input.timeout as number) || 10000;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
          });
          clearTimeout(timer);
          return {
            success: true,
            output: JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              headers: (() => {
                const h: Record<string, string> = {};
                response.headers.forEach((v, k) => {
                  h[k] = v;
                });
                return h;
              })(),
            }),
          };
        } catch (e: any) {
          return { success: false, error: `HEAD request failed: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'dns_lookup',
      description:
        'Resolve a hostname to its IP addresses (both IPv4 and IPv6)',
      params: [
        stringParam(
          'hostname',
          'Hostname to resolve (e.g., "example.com")',
          true
        ),
      ],
      aliases: ['dns', 'resolve'],
      tags: [TT.NETWORK],
      execute: async (input) => {
        const hostname = input.hostname as string;
        if (!hostname) return { success: false, error: 'hostname is required' };
        try {
          const dnsPromises = require('dns/promises') as any;
          const addresses: string[] = await dnsPromises.resolve4(hostname);
          let addresses6: string[] = [];
          try {
            addresses6 = await dnsPromises.resolve6(hostname);
          } catch {}
          return {
            success: true,
            output: JSON.stringify({
              hostname,
              addresses4: addresses,
              addresses6,
            }),
          };
        } catch (e: any) {
          return { success: false, error: `DNS lookup failed: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'ip_info',
      description:
        'Get local network information including IP addresses of all active network interfaces',
      params: [],
      aliases: ['myip', 'ipconfig'],
      tags: [TT.NETWORK],
      execute: () => {
        const os = require('os') as typeof import('os');
        const interfaces = os.networkInterfaces();
        const result: Record<string, string[]> = {};
        for (const [name, addrs] of Object.entries(interfaces)) {
          if (addrs) {
            result[name] = (addrs as import('os').NetworkInterfaceInfo[]).map(
              (a) =>
                `${a.address} (${a.family})${a.internal ? ' [internal]' : ''}`
            );
          }
        }
        return {
          success: true,
          output: JSON.stringify({
            hostname: os.hostname(),
            interfaces: result,
          }),
        };
      },
    })
  );

  // ========== 数据格式转换工具 (4) ==========

  tools.push(
    makeTool({
      name: 'csv_parse',
      description:
        'Parse a CSV string into a structured JSON array of objects with header-based keys',
      params: [
        stringParam('csv', 'CSV text to parse', true),
        stringParam('delimiter', 'Column delimiter (default: ",")'),
        booleanParam('headers', 'First row is headers (default: true)'),
      ],
      aliases: ['parse_csv', 'csv_to_json'],
      tags: [TT.CODE],
      execute: (input) => {
        const csv = input.csv as string;
        if (!csv) return { success: false, error: 'csv is required' };
        const delimiter = (input.delimiter as string) || ',';
        const hasHeaders = input.headers !== false;
        const lines = csv.trim().split('\n');
        if (lines.length === 0) return { success: false, error: 'Empty CSV' };

        const parseLine = (line: string) => {
          const result: string[] = [];
          let current = '';
          let inQuote = false;
          for (const ch of line) {
            if (ch === '"') {
              inQuote = !inQuote;
              continue;
            }
            if (ch === delimiter && !inQuote) {
              result.push(current.trim());
              current = '';
              continue;
            }
            current += ch;
          }
          result.push(current.trim());
          return result;
        };

        const headers = hasHeaders
          ? parseLine(lines[0])
          : lines[0].split(delimiter).map((_, i) => `col${i}`);
        const data = (hasHeaders ? lines.slice(1) : lines).map((line) => {
          const values = parseLine(line);
          const row: Record<string, string> = {};
          headers.forEach((h, i) => {
            row[h] = values[i] || '';
          });
          return row;
        });

        return {
          success: true,
          output: JSON.stringify({ headers, count: data.length, data }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'csv_to_json',
      description:
        'Convert CSV text to a flat JSON string for further processing',
      params: [
        stringParam('csv', 'CSV text to convert', true),
        stringParam('delimiter', 'Column delimiter (default: ",")'),
      ],
      aliases: ['csv2json'],
      tags: [TT.CODE],
      execute: (input) => {
        const csv = input.csv as string;
        if (!csv) return { success: false, error: 'csv is required' };
        const delimiter = (input.delimiter as string) || ',';
        const lines = csv.trim().split('\n');
        if (lines.length < 2)
          return {
            success: false,
            error: 'CSV must have at least a header row and one data row',
          };
        const headers = lines[0].split(delimiter).map((h) => h.trim());
        const rows = lines.slice(1).map((line) => {
          const values = line.split(delimiter).map((v) => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, i) => {
            row[h] = values[i] || '';
          });
          return row;
        });
        return { success: true, output: JSON.stringify(rows) };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'xml_to_json',
      description:
        'Convert simple XML string to JSON representation (supports nested elements and attributes prefixed with @)',
      params: [stringParam('xml', 'XML string to convert', true)],
      aliases: ['xml2json', 'parse_xml'],
      tags: [TT.CODE],
      execute: async (input) => {
        const xml = input.xml as string;
        if (!xml) return { success: false, error: 'xml is required' };
        try {
          const { XMLParser } = require('fast-xml-parser') as any;
          const parser = new XMLParser({ ignoreAttributes: false });
          const result = parser.parse(xml);
          return { success: true, output: JSON.stringify(result, null, 2) };
        } catch {
          return {
            success: true,
            output: JSON.stringify({
              raw: xml,
              note: 'XML parsed as raw text',
            }),
          };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'yaml_to_json',
      description:
        'Convert simple YAML string to JSON (YAML with basic key-value and nested structures)',
      params: [stringParam('yaml', 'YAML string to convert', true)],
      aliases: ['yaml2json', 'parse_yaml'],
      tags: [TT.CODE],
      execute: (input) => {
        const yaml = input.yaml as string;
        if (!yaml) return { success: false, error: 'yaml is required' };
        try {
          const lines = yaml.split('\n');
          const result: Record<string, any> = {};
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx > 0) {
              const key = trimmed.slice(0, colonIdx).trim();
              const val = trimmed.slice(colonIdx + 1).trim();
              result[key] = val || true;
            }
          }
          return { success: true, output: JSON.stringify(result, null, 2) };
        } catch (e: any) {
          return { success: false, error: `YAML parse error: ${e.message}` };
        }
      },
    })
  );

  // ========== 文件效用工具 (5) ==========

  tools.push(
    makeTool({
      name: 'file_info',
      description:
        'Get file or directory metadata including size, permissions, and timestamps',
      params: [stringParam('path', 'File system path to inspect', true)],
      aliases: ['stat', 'file_stat'],
      tags: [TT.FILE],
      execute: (input) => {
        const fs = require('fs');
        const targetPath = input.path as string;
        if (!targetPath) return { success: false, error: 'path is required' };
        try {
          const stats = fs.statSync(targetPath);
          return {
            success: true,
            output: JSON.stringify({
              path: targetPath,
              exists: true,
              type: stats.isDirectory()
                ? 'directory'
                : stats.isFile()
                  ? 'file'
                  : stats.isSymbolicLink()
                    ? 'symlink'
                    : 'other',
              sizeBytes: stats.size,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              accessed: stats.atime.toISOString(),
              permissions: stats.mode.toString(8).slice(-3),
            }),
          };
        } catch {
          return {
            success: true,
            output: JSON.stringify({ path: targetPath, exists: false }),
          };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'dir_list',
      description:
        'List files and directories in a given path with size and type information',
      params: [
        stringParam(
          'path',
          'Directory path to list (default: current directory)'
        ),
        booleanParam('recursive', 'List recursively (default: false)'),
        stringParam('pattern', 'Optional glob pattern to filter results'),
      ],
      aliases: ['ls', 'list_dir'],
      tags: [TT.FILE],
      execute: (input) => {
        const fs = require('fs');
        const path = require('path');
        const dirPath = (input.path as string) || process.cwd();
        const recursive = input.recursive === true;

        function listDir(dir: string, depth: number): any[] {
          if (depth > 3)
            return [{ name: '...(max depth reached)', type: 'truncated' }];
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            return entries.map((e: any) => {
              const fullPath = path.join(dir, e.name);
              const info: any = {
                name: e.name,
                type: e.isDirectory() ? 'directory' : 'file',
              };
              if (e.isDirectory() && recursive) {
                info.children = listDir(fullPath, depth + 1);
              }
              if (e.isFile()) {
                try {
                  info.size = fs.statSync(fullPath).size;
                } catch {}
              }
              return info;
            });
          } catch (e: any) {
            return [{ name: `Error: ${e.message}`, type: 'error' }];
          }
        }

        const entries = listDir(dirPath, 0);
        return {
          success: true,
          output: JSON.stringify({
            path: dirPath,
            count: entries.length,
            entries,
          }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'file_hash',
      description:
        'Compute file checksum hash (SHA256 or MD5) for verifying file integrity',
      params: [
        stringParam('path', 'File path', true),
        stringParam('algorithm', 'Hash algorithm: sha256 (default), md5, sha1'),
      ],
      aliases: ['checksum', 'file_checksum'],
      tags: [TT.FILE],
      execute: (input) => {
        const fs = require('fs');
        const crypto = require('crypto');
        const filePath = input.path as string;
        if (!filePath) return { success: false, error: 'path is required' };
        const algorithm = (input.algorithm as string) || 'sha256';
        try {
          const content = fs.readFileSync(filePath);
          const hash = crypto
            .createHash(algorithm)
            .update(content)
            .digest('hex');
          return {
            success: true,
            output: JSON.stringify({
              path: filePath,
              algorithm,
              hash,
              size: content.length,
            }),
          };
        } catch (e: any) {
          return { success: false, error: `File hash failed: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'file_copy',
      description: 'Copy a file from source to destination path',
      params: [
        stringParam('source', 'Source file path', true),
        stringParam('destination', 'Destination file path', true),
        booleanParam('overwrite', 'Overwrite if exists (default: false)'),
      ],
      aliases: ['cp', 'copy_file'],
      tags: [TT.FILE],
      execute: (input) => {
        const fs = require('fs');
        const src = input.source as string;
        const dest = input.destination as string;
        if (!src || !dest)
          return {
            success: false,
            error: 'source and destination are required',
          };
        try {
          if (!input.overwrite && fs.existsSync(dest)) {
            return {
              success: false,
              error:
                'Destination already exists. Set overwrite=true to overwrite.',
            };
          }
          fs.copyFileSync(src, dest);
          return { success: true, output: `Copied "${src}" → "${dest}"` };
        } catch (e: any) {
          return { success: false, error: `Copy failed: ${e.message}` };
        }
      },
    })
  );

  tools.push(
    makeTool({
      name: 'temp_file',
      description:
        'Create a temporary file with specified content and get its path',
      params: [
        stringParam('content', 'File content to write', true),
        stringParam('suffix', 'File suffix/extension (default: ".tmp")'),
        stringParam('prefix', 'File prefix (default: "tmp-")'),
      ],
      aliases: ['mktemp', 'create_temp'],
      tags: [TT.FILE],
      execute: (input) => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const content = input.content as string;
        if (content === undefined)
          return { success: false, error: 'content is required' };
        const suffix = (input.suffix as string) || '.tmp';
        const prefix = (input.prefix as string) || 'tmp-';
        try {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
          const tmpFile = path.join(tmpDir, `file${suffix}`);
          fs.writeFileSync(tmpFile, content, 'utf-8');
          return {
            success: true,
            output: JSON.stringify({
              path: tmpFile,
              size: content.length,
              dir: tmpDir,
            }),
          };
        } catch (e: any) {
          return {
            success: false,
            error: `Temp file creation failed: ${e.message}`,
          };
        }
      },
    })
  );

  // ========== 颜色/样式工具 (2) ==========

  tools.push(
    makeTool({
      name: 'color_hex_to_rgb',
      description: 'Convert hex color code (e.g., "#FF0000") to RGB values',
      params: [
        stringParam('hex', 'Hex color (e.g., "#FF0000", "FF0000")', true),
      ],
      aliases: ['hex2rgb'],
      tags: [TT.CODE],
      execute: (input) => {
        let hex = input.hex as string;
        if (!hex) return { success: false, error: 'hex is required' };
        hex = hex.replace('#', '');
        if (hex.length === 3)
          hex = hex
            .split('')
            .map((c) => c + c)
            .join('');
        if (hex.length !== 6)
          return { success: false, error: 'Invalid hex color' };
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b))
          return { success: false, error: 'Invalid hex color' };
        return {
          success: true,
          output: JSON.stringify({ hex: `#${hex}`, rgb: { r, g, b } }),
        };
      },
    })
  );

  tools.push(
    makeTool({
      name: 'color_rgb_to_hex',
      description:
        'Convert RGB color values to hex code (e.g., rgb(255,0,0) → "#FF0000")',
      params: [
        numberParam('r', 'Red value (0-255)', true),
        numberParam('g', 'Green value (0-255)', true),
        numberParam('b', 'Blue value (0-255)', true),
      ],
      aliases: ['rgb2hex'],
      tags: [TT.CODE],
      execute: (input) => {
        const r = input.r as number;
        const g = input.g as number;
        const b = input.b as number;
        if (r === undefined || g === undefined || b === undefined) {
          return { success: false, error: 'r, g, b are required' };
        }
        if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
          return {
            success: false,
            error: 'RGB values must be between 0 and 255',
          };
        }
        const hex =
          '#' +
          [r, g, b]
            .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
            .join('');
        return { success: true, output: hex };
      },
    })
  );

  // ========== 思考/记录工具 (2) ==========

  tools.push(
    makeTool({
      name: 'note',
      description:
        'Record a persistent note or observation during a session. Notes are stored and can be retrieved later',
      params: [
        stringParam('action', 'Action: add, list, clear (default: add)', false),
        stringParam(
          'content',
          'Note content to record (required for add)',
          false
        ),
      ],
      aliases: ['memo', 'reminder'],
      tags: [TT.CODE],
      execute: (() => {
        const notes: string[] = [];
        return (input: Record<string, unknown>) => {
          const action = (input.action as string) || 'add';
          switch (action) {
            case 'add': {
              const content = input.content as string;
              if (!content)
                return { success: false, error: 'content is required for add' };
              const idx = notes.push(content);
              return { success: true, output: `Note #${idx} recorded` };
            }
            case 'list':
              return {
                success: true,
                output:
                  notes.length === 0
                    ? 'No notes'
                    : notes.map((n, i) => `${i + 1}. ${n}`).join('\n'),
              };
            case 'clear':
              notes.length = 0;
              return { success: true, output: 'All notes cleared' };
            default:
              return {
                success: false,
                error: `Unknown action: ${action}. Use add, list, or clear`,
              };
          }
        };
      })(),
    })
  );

  // ========== 输出/格式化工具 (2) ==========

  tools.push(
    makeTool({
      name: 'echo',
      description:
        'Echo/print the input text back. Useful for testing pipeline or formatting output',
      params: [stringParam('text', 'Text to echo back', true)],
      aliases: ['print', 'say'],
      tags: [TT.CODE],
      execute: (input) => ({ success: true, output: input.text as string }),
    })
  );

  tools.push(
    makeTool({
      name: 'table_format',
      description:
        'Format tabular data from JSON array into a readable text table with aligned columns',
      params: [
        stringParam('data', 'JSON array of objects to display as table', true),
      ],
      aliases: ['table', 'format_table'],
      tags: [TT.CODE],
      execute: (input) => {
        const dataStr = input.data as string;
        if (!dataStr) return { success: false, error: 'data is required' };
        try {
          const data = JSON.parse(dataStr);
          if (!Array.isArray(data) || data.length === 0) {
            return {
              success: false,
              error: 'data must be a non-empty JSON array',
            };
          }
          const headers = Object.keys(data[0]);
          const colWidths = headers.map((h) =>
            Math.max(
              h.length,
              ...data.map((r: any) => String(r[h] ?? '').length)
            )
          );
          const line = headers
            .map((h, i) => h.padEnd(colWidths[i]))
            .join(' | ');
          const sep = colWidths.map((w) => '-'.repeat(w)).join('-+-');
          const rows = data.map((r: any) =>
            headers
              .map((h, i) => String(r[h] ?? '').padEnd(colWidths[i]))
              .join(' | ')
          );
          return { success: true, output: [line, sep, ...rows].join('\n') };
        } catch (e: any) {
          return { success: false, error: `Table format error: ${e.message}` };
        }
      },
    })
  );

  // Soul / User profile update tool
  tools.push(
    makeTool({
      name: 'update_soul_or_user',
      description:
        'Update the AI personality (SOUL.md) or user profile (USER.md) when the user shares relevant information. Use this when the user mentions their preferences, background, communication style, or any information that should be remembered, or when giving feedback about the AI personality, tone, or behavior.',
      params: [
        {
          name: 'target',
          type: 'string',
          description:
            'Which file to update: "soul" for AI personality (SOUL.md), "user" for user profile (USER.md)',
          required: true,
          enum: ['soul', 'user'],
        },
        {
          name: 'section',
          type: 'string',
          description:
            'Section header to update (e.g. "基本信息", "核心信念", "语气"). If omitted, replaces the entire file.',
          required: false,
        },
        {
          name: 'content',
          type: 'string',
          description:
            'The new content for the specified section or entire file. Use Markdown list items or paragraphs.',
          required: true,
        },
      ],
      execute: async (input) => {
        const target = input.target as string;
        const section = input.section as string | undefined;
        const content = input.content as string;

        if (!content) {
          return { success: false, error: 'content is required' };
        }

        try {
          if (target === 'soul') {
            if (section) {
              const currentContent = readSoulMd();
              const newContent = updateMarkdownSection(
                currentContent,
                section,
                content
              );
              writeSoulMd(newContent);
            } else {
              writeSoulMd(content);
            }
            return { success: true, output: 'SOUL.md updated successfully' };
          }

          if (target === 'user') {
            if (section) {
              const currentContent = readUserMd();
              const newContent = updateMarkdownSection(
                currentContent,
                section,
                content
              );
              writeUserMd(newContent);
            } else {
              writeUserMd(content);
            }
            return { success: true, output: 'USER.md updated successfully' };
          }

          return { success: false, error: `Invalid target: ${target}` };
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          return { success: false, error: `Update failed: ${message}` };
        }
      },
    })
  );

  return tools;
}

/**
 * 更新 Markdown 文档中的指定段落
 * 查找 ## sectionName 段落并替换其内容，若不存在则追加到末尾
 */
function updateMarkdownSection(
  content: string,
  sectionName: string,
  sectionContent: string
): string {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(## ${escapedName}\\n\\n)[\\s\\S]*?(?=\\n## |\\n*$)`,
    'm'
  );
  if (regex.test(content)) {
    return content.replace(regex, `$1${sectionContent}`);
  }
  return (
    content.replace(/\n*$/, '') + `\n\n## ${sectionName}\n\n${sectionContent}\n`
  );
}
