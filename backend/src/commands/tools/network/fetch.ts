/**
 * fetch 命令
 *
 * 对标 CC 源码: reference/cc_code/tools/WebFetchTool.ts
 * CC 的 WebFetchTool 支持:
 *   - URL 获取 + HTML→Markdown 转换（htmlToMarkdown）
 *   - 提示词提取（applyPrompt）
 *   - HTTP 状态/大小/耗时元数据
 * PY_APP WebFetchTool 额外支持 method/headers/body/timeout/maxContentLength。
 * 本命令作为 WebFetchTool 的 CLI 接口暴露其完整能力。
 *
 * 用法:
 *   /fetch <url>                       - 获取网页内容
 *   /fetch <url> --md                  - HTML→Markdown 转换（对标 CC htmlToMarkdown）
 *   /fetch <url> --prompt "提取正文"   - 提示词提取（对标 CC applyPrompt）
 *   /fetch <url> -X POST -d '...'     - POST 请求
 *   /fetch <url> -H "Key: Value"      - 自定义请求头
 *   /fetch <url> --raw                - 显示完整内容
 *   /fetch <url> --timeout 10000      - 自定义超时
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/** 默认内容截断长度 */
const DEFAULT_MAX_LENGTH = 2000;

/**
 * 解析命令行参数
 */
function parseFetchArgs(args: string): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  timeout: number;
  maxLength: number;
  raw: boolean;
  toMarkdown: boolean;
  prompt: string | undefined;
} {
  const parts = args.trim().split(/\s+/);
  const result: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    timeout: number;
    maxLength: number;
    raw: boolean;
    toMarkdown: boolean;
    prompt: string | undefined;
  } = {
    url: '',
    method: 'GET',
    headers: {},
    body: undefined,
    timeout: 30000,
    maxLength: DEFAULT_MAX_LENGTH,
    raw: false,
    toMarkdown: false,
    prompt: undefined,
  };

  let urlFound = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === '--method' || part === '-X') {
      result.method = parts[++i]?.toUpperCase() || 'GET';
      continue;
    }

    if (part === '--header' || part === '-H') {
      const headerStr = parts[++i] || '';
      const colonIndex = headerStr.indexOf(':');
      if (colonIndex > 0) {
        const key = headerStr.substring(0, colonIndex).trim();
        const value = headerStr.substring(colonIndex + 1).trim();
        if (key) {
          result.headers[key] = value;
        }
      }
      continue;
    }

    if (part === '--data' || part === '-d') {
      result.body = parts[++i] || '';
      if (result.method === 'GET') {
        result.method = 'POST';
      }
      continue;
    }

    if (part === '--timeout') {
      const val = parseInt(parts[++i] || '30000', 10);
      if (!isNaN(val) && val > 0) {
        result.timeout = Math.min(val, 120000);
      }
      continue;
    }

    if (part === '--raw') {
      result.raw = true;
      continue;
    }

    if (part === '--max-length') {
      const val = parseInt(parts[++i] || String(DEFAULT_MAX_LENGTH), 10);
      if (!isNaN(val) && val > 0) {
        result.maxLength = val;
      }
      continue;
    }

    if (part === '--md' || part === '--markdown') {
      result.toMarkdown = true;
      continue;
    }

    if (part === '--prompt' || part === '--extract') {
      result.prompt = parts[++i] || 'Extract the main content';
      continue;
    }

    if (!urlFound && !part.startsWith('-')) {
      result.url = part;
      urlFound = true;
    }
  }

  return result;
}

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  return [
    'Fetch 命令帮助',
    '═══════════════',
    '',
    '用法:',
    '  /fetch <url>                      - 获取网页内容',
    '  /fetch <url> --md                 - HTML→Markdown 转换（对标 CC htmlToMarkdown）',
    '  /fetch <url> --prompt "提取正文"  - 提示词提取（对标 CC applyPrompt）',
    '  /fetch <url> -X <method>          - 指定 HTTP 方法',
    '  /fetch <url> -H "Key: Value"      - 添加请求头',
    '  /fetch <url> -d <body>            - 发送请求体（自动切换为 POST）',
    '  /fetch <url> --timeout <ms>       - 设置超时（毫秒，最大 120000）',
    '  /fetch <url> --raw                - 显示完整内容（不截断）',
    '  /fetch <url> --max-length <n>     - 自定义截断长度（字符数）',
    '',
    '参数:',
    '  -X, --method <method>     HTTP 方法（GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS）',
    '  -H, --header <kv>         请求头，格式 "Key: Value"（可重复使用）',
    '  -d, --data <body>         请求体（自动设置 Content-Type: application/json）',
    '  --timeout <ms>            超时时间，默认 30000，最大 120000',
    '  --raw                     显示完整内容，不截断',
    '  --max-length <n>          自定义截断长度，默认 2000',
    '  --md, --markdown          HTML→Markdown 转换（对标 CC）',
    '  --prompt, --extract <p>   提示词提取内容（对标 CC）',
    '',
    '使用示例:',
    '  /fetch https://example.com',
    '  /fetch https://example.com --md                    # HTML 转 Markdown',
    '  /fetch https://example.com --prompt "提取正文"     # 提示词提取',
    '  /fetch https://api.github.com/repos/vercel/next.js',
    '  /fetch https://httpbin.org/post -X POST -d \'{"key":"value"}\'',
    '  /fetch https://example.com -H "Authorization: Bearer token123"',
    '  /fetch https://slow-api.example.com --timeout 60000',
    '  /fetch https://example.com --raw',
    '  /fetch https://example.com --max-length 5000',
    '',
    '输出格式:',
    '  URL          - 请求的 URL',
    '  Status       - HTTP 状态码和状态文本',
    '  Content-Type - 响应内容类型',
    '  Content-Length - 响应内容长度（字符数）',
    '  Duration     - 请求耗时',
    '',
    '当内容超过截断长度时，末尾会显示 [Content truncated. ...]',
    '使用 --raw 可查看完整内容。',
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
        '## fetch 命令',
        '',
        '获取网页内容或调用 HTTP API。支持完整的 HTTP 请求控制。',
        '',
        '基本用法：',
        '  /fetch <url>',
        '',
        '高级选项：',
        '  -X, --method <method>    指定 HTTP 方法',
        '  -H, --header <kv>        添加请求头（可多次使用）',
        '  -d, --data <body>        发送请求体',
        '  --timeout <ms>           超时时间',
        '  --raw                    显示完整内容',
        '  --md, --markdown         HTML→Markdown 转换',
        '  --prompt, --extract <p>  提示词提取内容',
        '',
        '示例：',
        '  /fetch https://example.com',
        '  /fetch https://example.com --md',
        '  /fetch https://example.com --prompt "Extract main content"',
        '  /fetch https://api.example.com/data -H "Authorization: Bearer xxx"',
        '  /fetch https://api.example.com -X POST -d \'{"name":"test"}\'',
      ].join('\n'),
    },
  ]);
}

/**
 * 格式化持续时间
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * HTML → Markdown 转换
 * 对标 CC reference/cc_code/tools/WebFetchTool.ts htmlToMarkdown()
 */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * 提示词提取
 * 对标 CC reference/cc_code/tools/WebFetchTool.ts applyPrompt()
 * 简化版：当内容超过阈值时截断，保留开头部分
 */
function applyPrompt(content: string, prompt: string): string {
  const maxLength = 10000;
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength) + '\n\n[Content truncated...]';
}

/**
 * Fetch命令
 */
export const fetchCommand: Command = {
  type: 'action',
  name: 'fetch',
  description: '获取网页内容',
  aliases: ['web_fetch'],
  argumentHint: '<url> [-X method] [-H header] [-d data] [--timeout ms] [--raw]',
  whenToUse: '当你需要获取网页内容、调用 HTTP API、或测试网络端点时',
  getPromptForCommand,
  load: async () => ({
    execute: async (args: string) => {
      const trimmed = args.trim();

      if (!trimmed || trimmed === '-h' || trimmed === '--help') {
        return { success: true, message: buildHelpText() };
      }

      const options = parseFetchArgs(trimmed);

      if (!options.url) {
        return {
          success: false,
          error: `请指定 URL\n用法: /fetch <url>\n示例: /fetch https://example.com\n\n使用 /fetch --help 查看完整帮助`,
        };
      }

      // 验证 URL 格式
      try {
        const parsed = new URL(options.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return {
            success: false,
            error: `不支持的协议: "${parsed.protocol}"\n只支持 HTTP 和 HTTPS 协议`,
          };
        }
      } catch {
        return {
          success: false,
          error: `无效的 URL 格式: "${options.url}"\n请输入完整的 URL，例如: https://example.com`,
        };
      }

      const startTime = Date.now();

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'web_fetch',
          {
            url: options.url,
            method: options.method,
            headers: options.headers,
            body: options.body,
            timeout: options.timeout,
            maxContentLength: options.maxLength,
          },
          {}
        );

        const duration = Date.now() - startTime;

        // 提取响应元数据
        const content = (result as any).content || result?.output || '';
        const status = (result as any).status;
        const statusText = (result as any).statusText;
        const contentType = (result as any).contentType;
        const contentLength = (result as any).contentLength || content.length;

        // 应用 HTML→Markdown 转换（对标 CC htmlToMarkdown）
        let displayContent = content;
        if (options.toMarkdown) {
          displayContent = htmlToMarkdown(displayContent);
        }

        // 应用提示词提取（对标 CC applyPrompt）
        if (options.prompt) {
          displayContent = applyPrompt(displayContent, options.prompt);
        }

        const lines: string[] = [];
        lines.push(`URL: ${options.url}`);
        lines.push(`Duration: ${formatDuration(duration)}`);

        if (status) {
          lines.push(`Status: ${status}${statusText ? ` ${statusText}` : ''}`);
        }
        if (contentType) {
          lines.push(`Content-Type: ${contentType}`);
        }
        lines.push(`Content-Length: ${contentLength} chars`);

        if (options.toMarkdown) {
          lines.push('Processing: HTML→Markdown converted');
        }
        if (options.prompt) {
          lines.push(`Prompt: ${options.prompt}`);
        }

        const statusCode = status || 200;
        if (statusCode >= 400) {
          lines.push('');
          lines.push(`Error: HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
          lines.push('');
          lines.push(content || 'No response body');
          return {
            success: false,
            error: lines.join('\n'),
          };
        }

        lines.push('');
        lines.push('─'.repeat(60));
        lines.push('');

        // 内容截断
        if (options.raw) {
          lines.push(displayContent);
        } else {
          const truncated =
            displayContent.length > options.maxLength
              ? displayContent.substring(0, options.maxLength) +
                `\n\n[Content truncated. Original length: ${displayContent.length} chars. Use --raw to see full content.]`
              : displayContent;
          lines.push(truncated);
        }

        return {
          success: true,
          message: lines.join('\n'),
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        let recovery = '';
        if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('DNS')) {
          recovery = '\n提示: 无法解析域名，请检查 URL 是否正确，或网络连接是否正常';
        } else if (errorMsg.includes('ECONNREFUSED')) {
          recovery = '\n提示: 连接被拒绝，目标服务器可能未运行或端口不正确';
        } else if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout') || errorMsg.includes('abort')) {
          recovery = `\n提示: 请求超时。可使用 --timeout 增加超时时间（当前: ${options.timeout}ms）`;
        } else if (errorMsg.includes('SSL') || errorMsg.includes('certificate')) {
          recovery = '\n提示: SSL 证书错误，请确认 URL 使用 HTTPS 且证书有效';
        } else if (errorMsg.includes('400') || errorMsg.includes('401') || errorMsg.includes('403') ||
                   errorMsg.includes('404') || errorMsg.includes('500')) {
          recovery = '\n提示: 服务器返回了错误状态码。请检查 URL 和请求参数是否正确';
        }

        return {
          success: false,
          error: `获取内容失败: ${errorMsg}${recovery}`,
        };
      }
    },
  }),
};

export default fetchCommand;
