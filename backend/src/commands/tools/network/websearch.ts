/**
 * websearch 命令
 *
 * 对标 CC 源码: reference/cc_code/tools/WebSearchTool.ts
 *               reference/cc_code/backend/tools/WebSearchTool/
 * CC 的 WebSearchTool 使用 Anthropic 内置 web_search_20250305 工具，
 * 支持 query + allowed_domains/blocked_domains 域名过滤；
 * PY_APP WebSearchTool 使用 Bing 搜索，额外支持 maxResults/language/safeSearch/timeout。
 * 本命令作为 WebSearchTool 的 CLI 接口暴露其完整能力。
 *
 * 用法:
 *   /websearch <query>                    - 执行搜索
 *   /websearch <query> -n 5              - 限制返回结果数
 *   /websearch <query> -l zh-CN          - 指定搜索语言
 *   /websearch <query> --allow github.io  - 仅搜索指定域名
 *   /websearch <query> --block twitter    - 排除指定域名
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/** 搜索结果项 */
interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

/** 搜索结果数据 */
interface SearchResultData {
  query: string;
  results: SearchResultItem[];
  totalResults: number;
  searchUrl: string;
  safeSearch: boolean;
}

/**
 * 解析命令行参数
 */
function parseSearchArgs(args: string): {
  query: string;
  maxResults: number;
  language: string;
  safeSearch: boolean;
  timeout: number;
  allowedDomains: string[];
  blockedDomains: string[];
} {
  const parts = args.trim().split(/\s+/);
  const result: {
    query: string;
    maxResults: number;
    language: string;
    safeSearch: boolean;
    timeout: number;
    allowedDomains: string[];
    blockedDomains: string[];
  } = {
    query: '',
    maxResults: 10,
    language: 'zh-CN',
    safeSearch: true,
    timeout: 30000,
    allowedDomains: [],
    blockedDomains: [],
  };

  const queryTokens: string[] = [];
  let inFlags = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === '--count' || part === '-n') {
      const val = parseInt(parts[++i] || '10', 10);
      if (!isNaN(val) && val > 0) {
        result.maxResults = Math.min(val, 100);
      }
      inFlags = true;
      continue;
    }

    if (part === '--lang' || part === '-l') {
      result.language = parts[++i] || 'zh-CN';
      inFlags = true;
      continue;
    }

    if (part === '--no-safe') {
      result.safeSearch = false;
      inFlags = true;
      continue;
    }

    if (part === '--timeout') {
      const val = parseInt(parts[++i] || '30000', 10);
      if (!isNaN(val) && val > 0) {
        result.timeout = Math.min(val, 120000);
      }
      inFlags = true;
      continue;
    }

    if (part === '--allow' || part === '--allow-domain') {
      const domain = parts[++i] || '';
      if (domain) {
        result.allowedDomains.push(domain);
      }
      inFlags = true;
      continue;
    }

    if (part === '--block' || part === '--block-domain') {
      const domain = parts[++i] || '';
      if (domain) {
        result.blockedDomains.push(domain);
      }
      inFlags = true;
      continue;
    }

    if (part.startsWith('-')) {
      inFlags = true;
      continue;
    }

    queryTokens.push(part);
  }

  result.query = queryTokens.join(' ');
  return result;
}

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  return [
    'WebSearch 命令帮助',
    '═══════════════════',
    '',
    '用法:',
    '  /websearch <query>                      - 执行网络搜索',
    '  /websearch <query> -n <count>           - 限制返回结果数',
    '  /websearch <query> -l <lang>            - 指定搜索语言',
    '  /websearch <query> --no-safe            - 关闭安全搜索',
    '  /websearch <query> --timeout <ms>       - 设置超时（毫秒）',
    '  /websearch <query> --allow <domain>     - 仅搜索指定域名（可重复使用）',
    '  /websearch <query> --block <domain>     - 排除指定域名（可重复使用）',
    '',
    '参数:',
    '  -n, --count <count>     返回结果数（1-100，默认 10）',
    '  -l, --lang <lang>       搜索语言代码（如 zh-CN, en-US，默认 zh-CN）',
    '  --no-safe               关闭安全搜索（默认启用）',
    '  --timeout <ms>          超时时间，默认 30000，最大 120000',
    '  --allow, --allow-domain <domain>  仅搜索指定域名（可重复使用）',
    '  --block, --block-domain <domain>  排除指定域名（可重复使用）',
    '',
    '使用示例:',
    '  /websearch Python 异步编程',
    '  /websearch "React server components" -n 5',
    '  /websearch 最新 AI 新闻 -l zh-CN',
    '  /websearch TypeScript 教程 --allow github.io --allow typescriptlang.org',
    '  /websearch "Node.js performance" --block medium.com --block dev.to',
    '',
    '输出格式:',
    '  Search results for "<query>"',
    '  Found: N results',
    '  Duration: X.Xs',
    '  ─────────────────────────────────',
    '',
    '  1. 标题',
    '     URL: https://...',
    '     摘要内容...',
    '',
    '  2. 标题',
    '     URL: https://...',
    '     摘要内容...',
  ].join('\n');
}

/**
 * 获取 AI 模型提示
 */
function getPromptForCommand(): Promise<Array<{ type: 'text'; text: string }>> {
  return Promise.resolve([
    {
      type: 'text',
      text: [
        '## websearch 命令',
        '',
        '执行网络搜索，获取最新的互联网信息。',
        '',
        '基本用法：',
        '  /websearch <查询词>',
        '',
        '高级选项：',
        '  -n, --count <n>      限制返回结果数量',
        '  -l, --lang <lang>    指定搜索语言',
        '  --allow <domain>     仅搜索指定域名',
        '  --block <domain>     排除指定域名',
        '',
        '示例：',
        '  /websearch Python 异步编程',
        '  /websearch "React server components" -n 5',
        '  /websearch TypeScript 教程 --allow github.io',
      ].join('\n'),
    },
  ]);
}

/**
 * 格式化搜索结果
 */
function formatSearchResults(
  data: SearchResultData,
  options: {
    query: string;
    allowedDomains: string[];
    blockedDomains: string[];
  },
  duration: number
): string {
  const lines: string[] = [];

  lines.push(`Search results for "${options.query}"`);
  lines.push(`Found: ${data.totalResults} results`);
  lines.push(`Duration: ${(duration / 1000).toFixed(2)}s`);

  if (options.allowedDomains.length > 0) {
    lines.push(`Allowed domains: ${options.allowedDomains.join(', ')}`);
  }
  if (options.blockedDomains.length > 0) {
    lines.push(`Blocked domains: ${options.blockedDomains.join(', ')}`);
  }

  lines.push('');
  lines.push('─'.repeat(70));
  lines.push('');

  data.results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   URL: ${item.url}`);
    if (item.snippet) {
      lines.push(`   ${item.snippet}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * 获取错误恢复建议
 */
function getRecoverySuggestion(errorMsg: string): string {
  if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('DNS')) {
    return '\n提示: 无法解析域名，请检查网络连接是否正常';
  }
  if (
    errorMsg.includes('ECONNREFUSED') ||
    errorMsg.includes('Unable to connect')
  ) {
    return '\n提示: 连接被拒绝，搜索服务可能暂时不可用';
  }
  if (
    errorMsg.includes('ETIMEDOUT') ||
    errorMsg.includes('timeout') ||
    errorMsg.includes('AbortError')
  ) {
    return '\n提示: 搜索超时。可尝试使用 --timeout 增加超时时间';
  }
  if (errorMsg.includes('400') || errorMsg.includes('429')) {
    return '\n提示: 搜索请求被限流，请稍后重试';
  }
  return '';
}

/**
 * WebSearch命令
 */
export const websearchCommand: Command = {
  type: 'action',
  name: 'websearch',
  description: '执行网络搜索',
  aliases: ['web_search'],
  argumentHint:
    '<query> [-n count] [-l lang] [--allow domain] [--block domain]',
  whenToUse: '当你需要执行网络搜索、查找最新资讯、查询技术文档或获取实时信息时',
  getPromptForCommand,
  load: async () => ({
    execute: async (args: string) => {
      const trimmed = args.trim();

      if (!trimmed || trimmed === '-h' || trimmed === '--help') {
        return { success: true, message: buildHelpText() };
      }

      const options = parseSearchArgs(trimmed);

      if (!options.query) {
        return {
          success: false,
          error: `请指定搜索关键词\n用法: /websearch <query>\n示例: /websearch Python 编程\n\n使用 /websearch --help 查看完整帮助`,
        };
      }

      if (options.query.length < 2) {
        return {
          success: false,
          error: `搜索词太短（最少 2 个字符）\n请提供更具体的搜索词`,
        };
      }

      const startTime = Date.now();

      try {
        const toolManager = getToolManager();

        const toolInput: Record<string, unknown> = {
          query: options.query,
          maxResults: options.maxResults,
          language: options.language,
          safeSearch: options.safeSearch,
          timeout: options.timeout,
        };

        if (options.allowedDomains.length > 0) {
          toolInput.allowed_domains = options.allowedDomains;
        }
        if (options.blockedDomains.length > 0) {
          toolInput.blocked_domains = options.blockedDomains;
        }

        const rawResult = await toolManager.executeTool(
          'web_search',
          toolInput,
          {}
        );

        const duration = Date.now() - startTime;

        // executeTool 返回 ToolResult，实际数据在 data 字段
        const data = rawResult.data as SearchResultData | undefined;

        if (!data || !data.results || data.results.length === 0) {
          return {
            success: true,
            message: [
              `Search results for "${options.query}"`,
              `Duration: ${(duration / 1000).toFixed(2)}s`,
              '',
              'No results found',
              options.allowedDomains.length > 0
                ? `\n注意: 设置了域名过滤 (${options.allowedDomains.join(', ')})，可能没有匹配结果\n尝试移除 --allow 限制以获取更多结果`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          };
        }

        const formatted = formatSearchResults(data, options, duration);

        return {
          success: true,
          message: formatted,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);
        const recovery = getRecoverySuggestion(errorMsg);

        return {
          success: false,
          error: `搜索失败: ${errorMsg}${recovery}`,
        };
      }
    },
  }),
};

export default websearchCommand;
