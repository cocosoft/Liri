import {
  makeTool,
  booleanParam,
  stringParam,
  numberParam,
  anyParam,
  updateMarkdownSection,
  type ToolExecResult,
} from './utility-helpers';
import type { Tool } from './types/Tool';
import { ToolTag as TT } from './types/Tool';
import { handleError } from '@modules/error';
import { readSoulMd, writeSoulMd } from '@modules/services/soul/SoulReader';
import { readUserMd, writeUserMd } from '@modules/services/soul/UserReader';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:utility-io-tools', level: LogLevel.INFO });

export function collectIoTools(tools: Tool[]): void {
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
          } catch (err) {
            void handleError(err, {
              module: 'tools:UtilityTools.ts',
              action: 'catch_error',
            });
          }
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
                } catch (err) {
                  void handleError(err, {
                    module: 'tools:UtilityTools.ts',
                    action: 'catch_error',
                  });
                }
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
}
