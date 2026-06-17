import { makeTool, booleanParam, stringParam, numberParam, anyParam, type ToolExecResult } from './utility-helpers';
import type { Tool } from './types/Tool';
import { ToolTag as TT } from './types/Tool';

export function collectDataTools(tools: Tool[]): void {
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

}
