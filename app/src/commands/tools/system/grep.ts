/**
 * Grep命令
 * 对标CC源码 cc_code/backend/tools/GrepTool/GrepTool.ts 实现
 * 支持丰富的搜索选项，包含短标志、上下文行、分页等
 */

import type { Command, CommandImplementation } from '@modules/commands';
import { grep, type GrepOutputMode } from '@modules/tools/GrepTool/grep.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:tools:system:grep', level: LogLevel.INFO });

/**
 * 构建帮助文本
 * @returns 完整帮助信息
 */
function buildHelpText(): string {
  return [
    '用法: /grep [选项] <pattern> [searchPath]',
    '',
    '使用正则表达式在文件中搜索文本内容，基于 ripgrep 模式实现。',
    '',
    '选项:',
    '  -h, --help                   显示此帮助信息',
    '  -i, --caseInsensitive        忽略大小写搜索',
    '  -n, --showLineNumbers        显示行号（默认启用）',
    '  --multiline                  启用多行匹配（. 可匹配换行符）',
    '  --outputMode <mode>          输出模式: content, files_with_matches(默认), count',
    '  --searchPath <path>          搜索目录路径（默认当前目录）',
    '  --pattern <pattern>          显式指定搜索模式',
    '  --include <pattern>          文件包含模式（通配符，如 *.ts, *.{ts,tsx}）',
    '  --type <filetype>            文件类型过滤（如 ts, js, rs, py）',
    '  --headLimit <num>            最大返回结果数（默认 250，0 表示无限制）',
    '  --offset <num>               结果偏移量，用于分页',
    '  -C, --context <num>          匹配前后各显示的行数',
    '  --contextAround <num>        匹配前后各显示的行数（--context 的别名）',
    '  -B <num>                     匹配前显示的行数',
    '  -A <num>                     匹配后显示的行数',
    '',
    '输出模式说明:',
    '  content             显示匹配的具体内容行（含文件名和行号）',
    '  files_with_matches  仅显示包含匹配的文件名（默认）',
    '  count               显示每个文件的匹配次数统计',
    '',
    '分页说明:',
    '  使用 --headLimit 和 --offset 组合可实现分页遍历大量结果。',
    '  例如: /grep --headLimit 50 --offset 0 pattern',
    '        /grep --headLimit 50 --offset 50 pattern',
    '',
    '示例:',
    '  /grep function',
    '  /grep "class.*Factory" src/',
    '  /grep -i "error" src/',
    '  /grep --outputMode count --include "*.ts" function',
    '  /grep -i --headLimit 50 error src/',
    '  /grep --outputMode files_with_matches export',
    '  /grep -C 3 "TODO" src/',
    '  /grep --type ts "interface.*Props"',
    '  /grep --headLimit 100 --offset 50 pattern src/',
    '',
    '别名: /search, /regex',
  ].join('\n');
}

/**
 * 解析grep命令参数，支持 --option value 和 -x 短标志格式
 * @param args 原始参数字符串
 * @returns 解析后的搜索选项
 */
function parseGrepArgs(args: string): {
  options: Record<string, unknown>;
  showHelp: boolean;
} {
  const options: Record<string, unknown> = {};
  const tokens: string[] = [];
  let i = 0;
  let showHelp = false;

  const parts = args.trim().split(/\s+/);
  while (i < parts.length) {
    const part = parts[i];

    // 处理 -h / --help
    if (part === '-h' || part === '--help') {
      showHelp = true;
      i++;
      continue;
    }

    // 处理短标志 -i, -n, -C, -B, -A
    if (part.startsWith('-') && !part.startsWith('--') && part.length === 2) {
      const flag = part[1];
      switch (flag) {
        case 'i':
          options.caseInsensitive = true;
          i++;
          continue;
        case 'n':
          options.showLineNumbers = true;
          i++;
          continue;
        case 'C':
          if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
            const val = parseInt(parts[i + 1], 10);
            if (!isNaN(val) && val >= 0) {
              options.contextAround = val;
            }
            i += 2;
          } else {
            options.contextAround = 3;
            i++;
          }
          continue;
        case 'B':
          if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
            const val = parseInt(parts[i + 1], 10);
            if (!isNaN(val) && val >= 0) {
              options.contextBefore = val;
            }
            i += 2;
          } else {
            i++;
          }
          continue;
        case 'A':
          if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
            const val = parseInt(parts[i + 1], 10);
            if (!isNaN(val) && val >= 0) {
              options.contextAfter = val;
            }
            i += 2;
          } else {
            i++;
          }
          continue;
        default:
          tokens.push(part);
          i++;
          continue;
      }
    }

    // 处理 --long-option 格式
    if (part.startsWith('--')) {
      const key = part.slice(2);
      const nextIsValue = i + 1 < parts.length && !parts[i + 1].startsWith('-');
      const val = nextIsValue ? parts[i + 1] : undefined;

      switch (key) {
        case 'pattern':
          if (val !== undefined) {
            options.pattern = val;
            i += 2;
          } else {
            i++;
          }
          break;

        case 'outputMode':
          if (
            val !== undefined &&
            ['content', 'files_with_matches', 'count'].includes(val)
          ) {
            options.outputMode = val as
              | 'content'
              | 'files_with_matches'
              | 'count';
          }
          i += val !== undefined ? 2 : 1;
          break;

        case 'headLimit':
        case 'offset':
          if (val !== undefined) {
            const num = parseInt(val, 10);
            options[key] = isNaN(num) ? undefined : num;
          }
          i += val !== undefined ? 2 : 1;
          break;

        case 'contextBefore':
        case 'contextAfter':
        case 'contextAround':
          if (val !== undefined) {
            const num = parseInt(val, 10);
            options[key] = isNaN(num) ? undefined : num;
          }
          i += val !== undefined ? 2 : 1;
          break;

        case 'context':
          if (val !== undefined) {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 0) {
              options.contextAround = num;
            }
          } else {
            options.contextAround = 3;
          }
          i += val !== undefined ? 2 : 1;
          break;

        case 'searchPath':
        case 'include':
        case 'type':
          if (val !== undefined) {
            options[key] = val;
          }
          i += val !== undefined ? 2 : 1;
          break;

        case 'caseInsensitive':
        case 'showLineNumbers':
        case 'multiline':
          if (val !== undefined && (val === 'false' || val === 'no')) {
            options[key] = false;
          } else {
            options[key] = true;
          }
          i += val !== undefined ? 2 : 1;
          break;

        default:
          tokens.push(part);
          i++;
          break;
      }
    } else {
      tokens.push(part);
      i++;
    }
  }

  // 从位置参数提取 pattern 和 searchPath
  if (options.pattern === undefined && tokens.length > 0) {
    options.pattern = tokens[0];
  }
  if (tokens.length > 1) {
    options.searchPath = tokens.slice(1).join(' ');
  }

  return { options, showHelp };
}

/**
 * 格式化搜索结果输出
 * 对标CC源码 GrepTool.mapToolResultToToolResultBlockParam 格式
 */
function formatResult(
  result: {
    matches: string[];
    matchCount: number;
    fileCount: number;
    truncated: boolean;
    durationMs: number;
  },
  outputMode: string,
  headLimit: number | undefined,
  offset: number | undefined
): string {
  const parts: string[] = [];

  if (result.matches.length > 0) {
    parts.push(result.matches.join('\n'));
  }

  if (outputMode === 'content') {
    parts.push(
      `\n--- ${result.matchCount} matches in ${result.fileCount} files (${result.durationMs}ms)`
    );
  } else if (outputMode === 'files_with_matches') {
    parts.push(
      `\n--- Found ${result.fileCount} files with matches (${result.durationMs}ms)`
    );
  } else if (outputMode === 'count') {
    parts.push(
      `\n--- ${result.matchCount} total occurrences across ${result.fileCount} files (${result.durationMs}ms)`
    );
  }

  if (result.truncated) {
    const limitInfo = [];
    if (headLimit) limitInfo.push(`limit: ${headLimit}`);
    if (offset) limitInfo.push(`offset: ${offset}`);
    parts.push(
      `(结果已截断，Showing results with pagination = ${limitInfo.join(', ')})`
    );
    parts.push('使用 --headLimit <num> 和 --offset <num> 分页查看更多结果');
  }

  return parts.join('\n');
}

/**
 * Grep命令实现
 */
const grepImplementation: CommandImplementation = {
  execute: async (args: string) => {
    if (!args.trim()) {
      return {
        success: false,
        error: buildHelpText(),
      };
    }

    const { options, showHelp } = parseGrepArgs(args);

    if (showHelp) {
      return {
        success: true,
        message: buildHelpText(),
      };
    }

    if (!options.pattern) {
      return {
        success: false,
        error:
          '错误: 必须指定搜索模式 pattern\n用法: /grep [选项] <pattern> [searchPath]\n使用 /grep --help 查看详细帮助',
      };
    }

    try {
      const o = options as Record<string, unknown>;
      const result = grep({
        pattern: o.pattern as string,
        searchPath: (o.searchPath as string) || process.cwd(),
        include: o.include as string | undefined,
        outputMode: (o.outputMode as GrepOutputMode) || 'files_with_matches',
        contextBefore: o.contextBefore as number | undefined,
        contextAfter: o.contextAfter as number | undefined,
        contextAround: o.contextAround as number | undefined,
        showLineNumbers: o.showLineNumbers !== false,
        caseInsensitive: o.caseInsensitive as boolean | undefined,
        type: o.type as string | undefined,
        headLimit: (o.headLimit as number) ?? 250,
        offset: o.offset as number | undefined,
        multiline: o.multiline as boolean | undefined,
      });

      if (result.matchCount > 0) {
        return {
          success: true,
          message: formatResult(
            result,
            (o.outputMode as string) || 'files_with_matches',
            (o.headLimit as number) ?? 250,
            o.offset as number | undefined
          ),
        };
      } else {
        return {
          success: true,
          message: `未找到匹配: ${o.pattern as string}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Grep命令
 */
export const grepCommand: Command = {
  type: 'action',
  name: 'grep',
  description: '搜索文本 - 使用正则表达式在文件中搜索',
  aliases: ['search', 'regex'],
  argumentHint: '[选项] <pattern> [searchPath]',
  whenToUse: [
    '当你需要在文件中搜索特定文本、符号或字符串时',
    '优先使用此命令而非终端 grep/rg，它更快且遵循 .gitignore',
    '支持完整的正则表达式语法和文件类型过滤',
  ].join('\n'),
  getPromptForCommand: (_args: string) =>
    Promise.resolve([
      {
        type: 'text',
        text: [
          '# Grep命令使用指南',
          '',
          '/grep 命令用于在文件中搜索文本内容，支持丰富的选项：',
          '',
          '| 选项 | 说明 |',
          '|------|------|',
          '| `-i` | 忽略大小写 |',
          '| `-n` | 显示行号（默认启用） |',
          '| `-C <num>` | 匹配前后各显示的行数 |',
          '| `-B <num>` | 匹配前显示的行数 |',
          '| `-A <num>` | 匹配后显示的行数 |',
          '| `--outputMode <mode>` | 输出模式: content/files_with_matches/count |',
          '| `--include <pattern>` | 文件通配符过滤 |',
          '| `--type <filetype>` | 文件类型过滤（ts, js, rs, py 等） |',
          '| `--headLimit <num>` | 最大结果数（默认 250） |',
          '| `--offset <num>` | 分页偏移量 |',
          '| `--multiline` | 多行匹配模式 |',
          '',
          '示例：',
          '- `/grep function`',
          '- `/grep -i "error" src/`',
          '- `/grep -C 3 "TODO"`',
          '- `/grep --type ts "interface.*Props"`',
          '- `/grep --outputMode count --include "*.ts" export`',
        ].join('\n'),
      },
    ]),
  load: async () => grepImplementation,
};

export default grepCommand;
