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
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:WebFetchTool:WebFetchTool', level: LogLevel.INFO });

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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          'User-Agent': 'Liri/1.0 (PowerShell AI Assistant)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          ...headers,
        },
        signal: controller.signal,
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

      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

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
    } catch (error: any) {
      if (error.name === 'AbortError') {
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
      onProgress?.({
        toolUseID: context.toolUseId || 'web-fetch-tool',
        data: {
          type: 'web_fetch',
          error: error.message,
          isRunning: false,
          isComplete: true,
        },
      });

      return createToolResult(error.message, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${error.message}`,
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
      const safeName = `${ts}_${fileName.replace(/[<>:"/\\|?*]/g, '_')}`;
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

      // 静默失败，不干扰主流程

      logger.warn("Operation skipped", { context: "静默失败，不干扰主流程", error: err instanceof Error ? err.message : String(err) });

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
