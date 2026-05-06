/**
 * Grep命令
 * 对标CC源码实现，支持丰富的搜索选项
 */

import type { Command } from '../../types/index.js';
import { grep } from '@modules/tools/GrepTool/GrepTool.js';

/**
 * 解析grep命令参数，支持 --option value 格式
 * @param args 原始参数字符串
 * @returns 解析后的搜索选项
 */
function parseGrepArgs(args: string): Record<string, any> {
  const options: Record<string, any> = {};
  const tokens: string[] = [];
  let i = 0;

  const parts = args.trim().split(/\s+/);
  while (i < parts.length) {
    const part = parts[i];
    if (part.startsWith('--')) {
      const key = part.slice(2);
      const val = i + 1 < parts.length && !parts[i + 1].startsWith('--') ? parts[i + 1] : undefined;
      if (val !== undefined) {
        switch (key) {
          case 'outputMode':
            if (['content', 'files_with_matches', 'count'].includes(val)) {
              options.outputMode = val as 'content' | 'files_with_matches' | 'count';
            }
            i += 2;
            break;
          case 'headLimit':
          case 'offset':
          case 'contextBefore':
          case 'contextAfter':
          case 'contextAround':
            options[key] = parseInt(val, 10) || undefined;
            i += 2;
            break;
          case 'searchPath':
          case 'include':
          case 'type':
            options[key] = val;
            i += 2;
            break;
          case 'caseInsensitive':
          case 'showLineNumbers':
          case 'multiline':
            options[key] = val === 'true' || val === 'yes' || true;
            i += 2;
            break;
          default:
            tokens.push(part);
            i++;
            break;
        }
      } else {
        switch (key) {
          case 'caseInsensitive':
          case 'showLineNumbers':
          case 'multiline':
            options[key] = true;
            i++;
            break;
          default:
            tokens.push(part);
            i++;
            break;
        }
      }
    } else {
      tokens.push(part);
      i++;
    }
  }

  if (tokens.length > 0) {
    options.pattern = tokens[0];
  }
  if (tokens.length > 1) {
    options.searchPath = tokens.slice(1).join(' ');
  }

  return options;
}

/**
 * 格式化搜索结果输出
 */
function formatResult(result: { matches: string[]; matchCount: number; fileCount: number; truncated: boolean; durationMs: number }): string {
  const parts: string[] = [];

  if (result.matches.length > 0) {
    parts.push(result.matches.join('\n'));
  }
  parts.push(`\n--- ${result.matchCount} matches in ${result.fileCount} files (${result.durationMs}ms)`);
  if (result.truncated) {
    parts.push('(结果已截断，请使用 --headLimit 增加限制)');
  }

  return parts.join('\n');
}

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
    '支持完整的正则表达式语法',
  ].join('\n'),
  load: async () => ({
    execute: async (args: string) => {
      if (!args.trim()) {
        return {
          success: false,
          error: [
            '用法: /grep [选项] <pattern> [searchPath]',
            '',
            '使用正则表达式在文件中搜索文本内容。',
            '',
            '选项:',
            '  --outputMode <mode>      输出模式: content(默认), files_with_matches, count',
            '  --searchPath <path>      搜索目录路径（默认当前目录）',
            '  --include <pattern>      文件包含模式（通配符，如 *.ts）',
            '  --headLimit <num>        最大返回结果数（默认 200）',
            '  --offset <num>           结果偏移量',
            '  --caseInsensitive        忽略大小写',
            '  --showLineNumbers        显示行号（默认启用）',
            '  --multiline              启用多行匹配',
            '  --contextBefore <num>    匹配前显示的行数',
            '  --contextAfter <num>     匹配后显示的行数',
            '  --contextAround <num>    匹配前后显示的行数',
            '  --type <filetype>        文件类型过滤（如 ts, js, rs）',
            '',
            '示例:',
            '  /grep function',
            '  /grep "class.*Factory" src/',
            '  /grep --outputMode count --include "*.ts" function',
            '  /grep --caseInsensitive --headLimit 50 error src/',
            '  /grep --outputMode files_with_matches export',
          ].join('\n'),
        };
      }

      const options = parseGrepArgs(args);

      if (!options.pattern) {
        return {
          success: false,
          error: '错误: 必须指定搜索模式 pattern\n用法: /grep [选项] <pattern> [searchPath]',
        };
      }

      try {
        const result = grep({
          pattern: options.pattern,
          searchPath: options.searchPath || process.cwd(),
          include: options.include,
          outputMode: options.outputMode || 'content',
          contextBefore: options.contextBefore,
          contextAfter: options.contextAfter,
          contextAround: options.contextAround,
          showLineNumbers: options.showLineNumbers !== false,
          caseInsensitive: options.caseInsensitive,
          type: options.type,
          headLimit: options.headLimit || 200,
          offset: options.offset,
          multiline: options.multiline,
        });

        if (result.matchCount > 0) {
          return {
            success: true,
            message: formatResult(result),
          };
        } else {
          return {
            success: true,
            message: `未找到匹配: ${options.pattern}`,
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default grepCommand;
