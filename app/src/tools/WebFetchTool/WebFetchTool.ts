/**
 * WebFetch 工具
 *
 * 提供网页内容获取功能
 * 使用系统内置的 fetch API (Node.js 18+)
 */

import { z } from 'zod';
import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  InterruptBehavior,
  ValidationResult,
} from '../types/index';
import { createToolResult } from '../types/ToolResult';
import { resolveDownloadsDir, resolveInboundDir } from '@modules/core';
import { sanitizeFileName } from '@modules/services/file/fileNaming';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { checkSsrf } from './ssrf.js';
const logger = getLogger('tools:WebFetchTool:WebFetchTool');

/** 手动重定向最多跳数（对标 RemoteSkillHubAdapter httpGetText 的 3 跳限制） */
const MAX_REDIRECT_HOPS = 3;
/** 需要手动跟随并逐跳 SSRF 校验的状态码 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * WebFetch 输入模式
 */
const WebFetchInputSchema = z.strictObject({
  url: z
    .string()
    .url('URL格式无效')
    .min(1, 'URL不能为空')
    .describe('要获取内容的URL'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
    .optional()
    .default('GET')
    .describe('HTTP请求方法'),
  headers: z.record(z.string()).optional().default({}).describe('HTTP请求头'),
  body: z.string().optional().describe('POST/PUT请求体'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(120000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒）'),
  maxContentLength: z
    .number()
    .int()
    .positive()
    .max(5000000)
    .optional()
    .default(500000)
    .describe('最大内容长度（字符数）'),
});

export class WebFetchTool extends BaseTool {
  name = 'web_fetch';
  description =
    'Fetch content from a URL. Use to retrieve web page content, API responses, or other HTTP resources.';

  override tags = [ToolTag.NETWORK, ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'url',
      type: 'string',
      description: 'The URL to fetch content from',
      required: true,
      default: '',
    },
    {
      name: 'method',
      type: 'string',
      description: 'HTTP method to use',
      required: false,
      default: 'GET',
    },
    {
      name: 'headers',
      type: 'object',
      description: 'HTTP headers to send',
      required: false,
      default: {},
    },
    {
      name: 'body',
      type: 'string',
      description: 'Request body for POST/PUT requests',
      required: false,
      default: '',
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds',
      required: false,
      default: 30000,
    },
    {
      name: 'maxContentLength',
      type: 'number',
      description: 'Maximum content length in characters',
      required: false,
      default: 500000,
    },
    {
      name: 'saveToFile',
      type: 'boolean',
      description: '将抓取内容保存到文件并注册到文件系统',
      required: false,
      default: false,
    },
  ];

  override aliases = ['fetch', 'curl', 'wget', 'http_get'];
  override searchHint = 'Fetch content from a URL';
  override maxResultSizeChars = 500000;

  constructor() {
    super();
  }

  override validateInput(input: any): ValidationResult {
    const result = WebFetchInputSchema.safeParse(input);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return { result: false, message: `WebFetch输入验证失败: ${errors}` };
    }
    return { result: true };
  }

  override isReadOnly(input?: Record<string, unknown>): boolean {
    const method = (input?.method as string)?.toUpperCase() || 'GET';
    return ['GET', 'HEAD', 'OPTIONS'].includes(method);
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return this.isReadOnly(input);
  }

  override interruptBehavior(): InterruptBehavior {
    return 'cancel';
  }

  override getPath(input: Record<string, unknown>): string {
    return (input?.url as string) || '';
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const url = input.url as string;
      const method = (input.method as string)?.toUpperCase() || 'GET';
      const headers = (input.headers as Record<string, string>) || {};
      const body = input.body as string | undefined;
      const timeout = (input.timeout as number) || 30000;
      const maxContentLength = (input.maxContentLength as number) || 500000;

      if (!url) {
        return createToolResult('url is required', {
          newMessages: [
            {
              role: 'system',
              content: 'Error: url is required',
            },
          ],
        });
      }

      if (!this.isValidUrl(url)) {
        return createToolResult('Invalid URL format', {
          newMessages: [
            {
              role: 'system',
              content: 'Error: Invalid URL format',
            },
          ],
        });
      }

      // SSRF 防护（对标 Hermes url_safety）：云元数据/内网/回环/链路本地地址一律拦截
      const ssrfResult = await checkSsrf(url);
      if (ssrfResult.blocked) {
        logger.warn('WebFetch 被 SSRF 拦截', {
          url,
          reason: ssrfResult.reason,
        });
        onProgress?.({
          toolUseID: context.toolUseId || 'web-fetch-tool',
          data: {
            type: 'web_fetch',
            url,
            method,
            error: `SSRF 拦截: ${ssrfResult.reason}`,
            isRunning: false,
            isComplete: true,
          },
        });
        return createToolResult(
          `该 URL 因安全策略被拦截（SSRF）：${ssrfResult.reason}`,
          {
            newMessages: [
              {
                role: 'system',
                content: `Error: URL blocked by SSRF protection: ${ssrfResult.reason}`,
              },
            ],
          }
        );
      }

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'web-fetch-tool',
        data: {
          type: 'web_fetch',
          url,
          method,
          isRunning: true,
          isComplete: false,
        },
      });

      const fetchOptions: RequestInit = {
        method,
        headers: {
          'User-Agent': 'Liri/1.0 (PowerShell AI Assistant)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          ...headers,
        },
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = body;
        if (!headers['Content-Type']) {
          fetchOptions.headers = {
            ...fetchOptions.headers,
            'Content-Type': 'application/json',
          };
        }
      }

      const response = await this.fetchWithRedirectGuard(
        url,
        fetchOptions,
        timeout
      );

      const status = response.status;
      const statusText = response.statusText;

      if (!response.ok && status !== 304) {
        const errorBody = await response.text().catch(() => '');
        // 报告执行错误
        onProgress?.({
          toolUseID: context.toolUseId || 'web-fetch-tool',
          data: {
            type: 'web_fetch',
            url,
            method,
            error: `HTTP ${status} ${statusText}: ${errorBody.substring(0, 500)}`,
            isRunning: false,
            isComplete: true,
          },
        });

        return createToolResult(
          `HTTP ${status} ${statusText}: ${errorBody.substring(0, 500)}`,
          {
            newMessages: [
              {
                role: 'system',
                content: `Error: Failed to fetch ${url}: ${status} ${statusText}`,
              },
            ],
          }
        );
      }

      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (contentType.includes('application/json')) {
        const jsonData = await response.json();
        content = JSON.stringify(jsonData, null, 2);
      } else {
        content = await response.text();
      }

      if (content.length > maxContentLength) {
        content =
          content.substring(0, maxContentLength) +
          `\n\n[Content truncated. Original length: ${content.length} characters]`;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result: WebFetchResult = {
        url,
        status,
        statusText,
        headers: responseHeaders,
        content,
        contentLength: content.length,
        contentType,
      };

      // 报告执行完成
      onProgress?.({
        toolUseID: context.toolUseId || 'web-fetch-tool',
        data: {
          type: 'web_fetch',
          url,
          method,
          status,
          isRunning: false,
          isComplete: true,
        },
      });

      // 若开启 saveToFile，保存到 downloads 目录并注册到 FileRegistry
      const saveToFile = input.saveToFile as boolean;
      if (saveToFile && content.length > 0) {
        this.saveToFileAndRegister(url, content, contentType, startTime).catch(
          () => {}
        );
      }

      return createToolResult(result, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully fetched content from ${url} in ${Date.now() - startTime}ms`,
          },
        ],
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        // 报告执行超时
        onProgress?.({
          toolUseID: context.toolUseId || 'web-fetch-tool',
          data: {
            type: 'web_fetch',
            error: `Request timed out after ${input.timeout || 30000}ms`,
            isRunning: false,
            isComplete: true,
          },
        });

        return createToolResult(
          `Request timed out after ${input.timeout || 30000}ms`,
          {
            newMessages: [
              {
                role: 'system',
                content: `Error: Request timed out after ${input.timeout || 30000}ms`,
              },
            ],
          }
        );
      }

      // 报告执行错误
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.({
        toolUseID: context.toolUseId || 'web-fetch-tool',
        data: {
          type: 'web_fetch',
          error: msg,
          isRunning: false,
          isComplete: true,
        },
      });

      return createToolResult(msg, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${msg}`,
          },
        ],
      });
    }
  }

  /**
   * 验证 URL 格式
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * SSRF 防护的 fetch：重定向手动处理，逐跳校验目标 URL。
   *
   * fetch 默认 redirect: 'follow' 会静默跟随任意跳转——公共 URL 302 到
   * 内网/云元数据（169.254.169.254 等）即被打穿。改为 manual 后每跳
   * 重新执行 checkSsrf，再校验通过才继续（对标 Hermes _ssrf_redirect_guard）。
   */
  private async fetchWithRedirectGuard(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = url;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const response = await fetch(currentUrl, {
          ...options,
          signal: controller.signal,
          redirect: 'manual',
        });
        if (!REDIRECT_STATUSES.has(response.status)) {
          return response;
        }
        // 排空重定向响应体，释放连接（undici 要求）
        await response.text().catch(() => {});
        const location = response.headers.get('location');
        if (!location) break;
        const nextUrl = new URL(location, currentUrl).href;
        const redirectCheck = await checkSsrf(nextUrl);
        if (redirectCheck.blocked) {
          throw new Error(`重定向目标被 SSRF 拦截：${redirectCheck.reason}`);
        }
        currentUrl = nextUrl;
      }
      throw new Error(`重定向次数超过限制（最多 ${MAX_REDIRECT_HOPS} 跳）`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return {
      url: input.url,
      method: input.method || 'GET',
    };
  }

  /**
   * 检查是否为读取命令
   */
  override isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: false, isRead: true };
  }

  /**
   * 将获取的内容保存到 downloads 目录并注册到 FileRegistry
   */
  private async saveToFileAndRegister(
    url: string,
    content: string,
    contentType: string,
    startTime: number
  ): Promise<void> {
    try {
      const downloadsDir = resolveDownloadsDir();
      await mkdir(downloadsDir, { recursive: true });

      // 从 URL 提取文件名
      const urlObj = new URL(url);
      let fileName =
        urlObj.pathname.split('/').filter(Boolean).pop() || 'index';
      if (!fileName.includes('.')) {
        const ext = contentType.includes('json')
          ? '.json'
          : contentType.includes('html')
            ? '.html'
            : contentType.includes('xml')
              ? '.xml'
              : '.txt';
        fileName += ext;
      }
      // 添加时间戳前缀防重名
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeName = `${ts}_${sanitizeFileName(fileName)}`;
      const filePath = join(downloadsDir, safeName);

      await writeFile(filePath, content, 'utf-8');

      // 注册到 FileRegistry
      const { FileRegistry } =
        await import('@modules/services/file/FileRegistry');
      const { FileSource } = await import('@modules/services/file/types');
      const registry = FileRegistry.getInstance();
      await registry.initDatabase();
      await registry.registerFile({
        originalName: fileName,
        content,
        source: FileSource.TOOL_DOWNLOAD,
        sourceId: url,
        description: `WebFetch 下载: ${url}`,
        mimeType: contentType,
        storeZone: 'inbound',
      });
    } catch (err) {
      handleError(err, { module: 'tools:webFetch', action: 'registerFile' });
    }
  }
}

export interface WebFetchResult {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  content: string;
  contentLength: number;
  contentType: string;
}

/**
 * 创建WebFetch工具实例
 * @returns WebFetch工具实例
 */
export function createWebFetchTool(): WebFetchTool {
  return new WebFetchTool();
}
