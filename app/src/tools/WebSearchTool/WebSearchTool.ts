/**
 * WebSearch 工具
 *
 * 提供网络搜索功能
 * 使用 Bing 搜索 API
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
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import type { SearchResult } from './providers';

const logger = getLogger('tools:webSearch');

/**
 * WebSearch 输入模式
 */
const WebSearchInputSchema = z.strictObject({
  query: z.string().min(1, '搜索查询不能为空').describe('搜索查询关键词'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(10)
    .describe('最大返回结果数'),
  language: z
    .string()
    .optional()
    .default('zh-CN')
    .describe('语言代码（如 "zh-CN", "en-US"），默认中文'),
  safeSearch: z
    .boolean()
    .optional()
    .default(true)
    .describe('启用安全搜索过滤成人内容'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(120000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒）'),
});

export class WebSearchTool extends BaseTool {
  name = 'web_search';
  description =
    'Search the web for information. Use to find current events, facts, documentation, or any topic that requires up-to-date internet resources.';

  override tags = [ToolTag.NETWORK, ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'query',
      type: 'string',
      description: 'The search query',
      required: true,
      default: '',
    },
    {
      name: 'maxResults',
      type: 'number',
      description: 'Maximum number of results to return',
      required: false,
      default: 10,
    },
    {
      name: 'language',
      type: 'string',
      description: 'Language code for results (e.g., "zh-CN", "en-US")',
      required: false,
      default: 'zh-CN',
    },
    {
      name: 'safeSearch',
      type: 'boolean',
      description: 'Enable safe search to filter adult content',
      required: false,
      default: true,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds',
      required: false,
      default: 30000,
    },
  ];

  override aliases = ['search', 'google', 'ddg', 'duckduckgo', 'bing'];
  override searchHint = 'Search the web for information';
  override maxResultSizeChars = 100000;

  constructor() {
    super();
  }

  override validateInput(input: any): ValidationResult {
    const result = WebSearchInputSchema.safeParse(input);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return { result: false, message: `WebSearch输入验证失败: ${errors}` };
    }
    return { result: true };
  }

  override isReadOnly(input?: Record<string, unknown>): boolean {
    return true;
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return true;
  }

  override interruptBehavior(): InterruptBehavior {
    return 'cancel';
  }

  override getPath(input: Record<string, unknown>): string {
    return (input?.query as string) || '';
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const query = input.query as string;
      const maxResults = (input.maxResults as number) || 10;
      const language = (input.language as string) || 'zh-CN';
      const safeSearch = input.safeSearch !== false;
      const timeout = (input.timeout as number) || 30000;

      if (!query) {
        return createToolResult('query is required', {
          newMessages: [
            {
              role: 'system',
              content: 'Error: query is required',
            },
          ],
        });
      }

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'web-search-tool',
        data: {
          type: 'web_search',
          query,
          isRunning: true,
          isComplete: false,
        },
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const encodedQuery = encodeURIComponent(query);
      // 使用 Bing 搜索 API
      const apiUrl = `https://www.bing.com/search?q=${encodedQuery}&count=${maxResults}&setlang=${language}`;

      logger.debug(`Searching with query: ${query}`);
      logger.debug(`API URL: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Liri/1.0 (PowerShell AI Assistant)',
            Accept: 'text/html',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        logger.debug(`Response status: ${response.status}`);

        if (!response.ok) {
          // 报告执行错误
          onProgress?.({
            toolUseID: context.toolUseId || 'web-search-tool',
            data: {
              type: 'web_search',
              query,
              error: `Search failed: HTTP ${response.status}`,
              isRunning: false,
              isComplete: true,
            },
          });

          return createToolResult(`Search failed: HTTP ${response.status}`, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Search failed: HTTP ${response.status}`,
              },
            ],
          });
        }

        const html = await response.text();
        logger.debug('Response received, parsing HTML...');

        // 解析 Bing 搜索结果
        const results = this.parseBingResults(html, maxResults);
        logger.debug(`Total results found: ${results.length}`);

        if (results.length === 0) {
          // 报告执行完成
          onProgress?.({
            toolUseID: context.toolUseId || 'web-search-tool',
            data: {
              type: 'web_search',
              query,
              totalResults: 0,
              isRunning: false,
              isComplete: true,
            },
          });

          return createToolResult(
            {
              query,
              results: [],
              totalResults: 0,
              message: 'No results found for this query',
            },
            {
              newMessages: [
                {
                  role: 'system',
                  content: 'No results found for this query',
                },
              ],
            }
          );
        }

        const result: WebSearchResult = {
          query,
          results: results.slice(0, maxResults),
          totalResults: results.length,
          searchUrl: apiUrl,
          safeSearch,
        };

        // 报告执行完成
        onProgress?.({
          toolUseID: context.toolUseId || 'web-search-tool',
          data: {
            type: 'web_search',
            query,
            totalResults: results.length,
            isRunning: false,
            isComplete: true,
          },
        });

        logger.debug(
          'Returning search results',
          JSON.stringify(result, null, 2)
        );

        return createToolResult(result, {
          newMessages: [
            {
              role: 'system',
              content: `Successfully searched for "${query}" and found ${results.length} results in ${Date.now() - startTime}ms`,
            },
          ],
        });
      } catch (networkError) {
        clearTimeout(timeoutId);
        await handleError(networkError, {
          module: 'tools:webSearch',
          action: '网络错误',
        });

        const nwMsg =
          networkError instanceof Error
            ? networkError.message
            : String(networkError);
        const nwCode = (networkError as NodeJS.ErrnoException).code;

        // 报告执行错误
        onProgress?.({
          toolUseID: context.toolUseId || 'web-search-tool',
          data: {
            type: 'web_search',
            query,
            error: nwMsg,
            isRunning: false,
            isComplete: true,
          },
        });

        // 处理网络连接错误
        if (
          nwCode === 'ConnectionRefused' ||
          nwMsg.includes('Unable to connect')
        ) {
          return createToolResult(
            '网络连接失败，无法访问搜索服务。请检查网络连接后重试。',
            {
              newMessages: [
                {
                  role: 'system',
                  content:
                    'Error: 网络连接失败，无法访问搜索服务。请检查网络连接后重试。',
                },
              ],
            }
          );
        }

        // 处理超时错误
        if (
          networkError instanceof Error &&
          networkError.name === 'AbortError'
        ) {
          return createToolResult(
            `搜索超时，请检查网络连接或尝试更短的超时时间。`,
            {
              newMessages: [
                {
                  role: 'system',
                  content:
                    'Error: 搜索超时，请检查网络连接或尝试更短的超时时间。',
                },
              ],
            }
          );
        }

        // 其他网络错误
        return createToolResult(`搜索失败：${nwMsg}`, {
          newMessages: [
            {
              role: 'system',
              content: `Error: 搜索失败：${nwMsg}`,
            },
          ],
        });
      }
    } catch (error) {
      await handleError(error, {
        module: 'tools:webSearch',
        action: '搜索错误',
      });

      const msg = error instanceof Error ? error.message : String(error);

      // 报告执行错误
      onProgress?.({
        toolUseID: context.toolUseId || 'web-search-tool',
        data: {
          type: 'web_search',
          error: msg,
          isRunning: false,
          isComplete: true,
        },
      });

      return createToolResult(`搜索功能出现错误：${msg}`, {
        newMessages: [
          {
            role: 'system',
            content: `Error: 搜索功能出现错误：${msg}`,
          },
        ],
      });
    }
  }

  /**
   * 解析 Bing 搜索结果
   */
  private parseBingResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // 简单的 HTML 解析，提取搜索结果
    // 注意：这种方法可能会因 Bing 页面结构变化而失效

    // 尝试不同的模式来匹配搜索结果
    const patterns = [
      // 模式1: 匹配带有 class 的搜索结果项
      /<li[^>]*class="[^"\n]*b_algo[^"\n]*"[^>]*>(.*?)<\/li>/gs,
      // 模式2: 匹配带有 data-idx 属性的搜索结果项
      /<li[^>]*data-idx="[0-9]+"[^>]*>(.*?)<\/li>/gs,
      // 模式3: 匹配包含 h2 标签的搜索结果项
      /<li[^>]*>(.*?<h2>.*?)<\/li>/gs,
    ];

    for (const pattern of patterns) {
      let match;
      while (
        (match = pattern.exec(html)) !== null &&
        results.length < maxResults
      ) {
        const resultHtml = match[1];

        // 提取标题和URL
        const titleMatch =
          /<h2[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<\/h2>/s.exec(
            resultHtml
          );
        if (!titleMatch) continue;

        const url = titleMatch[1];
        const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();

        // 提取摘要
        let snippet = '';
        const snippetMatch =
          /<div[^>]*class="[^"\n]*b_caption[^"\n]*"[^>]*>(.*?)<\/div>/s.exec(
            resultHtml
          );
        if (!snippetMatch) {
          // 尝试其他摘要模式
          const snippetMatch2 = /<p[^>]*>(.*?)<\/p>/s.exec(resultHtml);
          if (snippetMatch2) {
            snippet = snippetMatch2[1].replace(/<[^>]+>/g, '').trim();
          }
        } else {
          snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        if (title && url) {
          // 避免重复结果
          const isDuplicate = results.some(
            (r) => r.url === url || r.title === title
          );
          if (!isDuplicate) {
            results.push({
              title,
              url,
              snippet,
              source: 'bing',
            });
          }
        }
      }

      if (results.length >= maxResults) break;
    }

    // 如果仍然没有结果，尝试提取页面中的所有链接
    if (results.length === 0) {
      const linkRegex = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
      let match;
      while (
        (match = linkRegex.exec(html)) !== null &&
        results.length < maxResults
      ) {
        const url = match[1];
        const title = match[2].replace(/<[^>]+>/g, '').trim();

        // 过滤掉不相关的链接
        if (url.startsWith('http') && title.length > 5) {
          results.push({
            title,
            url,
            snippet: '',
            source: 'bing',
          });
        }
      }
    }

    return results;
  }

  /**
   * 从文本中提取标题
   */
  private extractTitle(text: string): string {
    const colonIndex = text.indexOf(':');
    if (colonIndex > 0 && colonIndex < 100) {
      return text.substring(0, colonIndex).trim();
    }
    const dotIndex = text.indexOf('.');
    if (dotIndex > 0 && dotIndex < 100) {
      return text.substring(0, dotIndex).trim();
    }
    return text.length > 100 ? text.substring(0, 97) + '...' : text;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return {
      query: input.query,
      maxResults: input.maxResults || 10,
    };
  }

  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const query = (input?.query as string) || '';
    if (query) {
      return `Web Search: ${query}`;
    }
    return this.name;
  }

  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const query = (input?.query as string) || '';
    if (query) {
      return `Searching the web for: ${query}`;
    }
    return null;
  }

  override getToolUseSummary(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const query = (input?.query as string) || '';
    if (query) {
      return `Search web for: ${query}`;
    }
    return null;
  }

  /**
   * 获取工具使用摘要文本
   */
  getToolUseSummaryText(input: Record<string, unknown>): string {
    const query = (input?.query as string) || '';
    return `Searching for: ${query}`;
  }

  override isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: true, isRead: true };
  }
}

export interface WebSearchResult {
  query: string;
  results: SearchResult[];
  totalResults: number;
  searchUrl: string;
  safeSearch: boolean;
}

/**
 * 创建WebSearch工具实例
 * @returns WebSearch工具实例
 */
export function createWebSearchTool(): WebSearchTool {
  return new WebSearchTool();
}
