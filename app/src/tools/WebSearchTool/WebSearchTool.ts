import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
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
  ToolValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { buildUserAgent } from '@openliri/infra/constants';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error/handleError';
import { StringUtils } from '@openliri/infra/common/utils';
import type { SearchResult } from './providers';
import {
  BING_SEARCH_BASE_URL,
  DUCKDUCKGO_HTML_SEARCH_BASE_URL,
} from '../searchSites.js';
import {
  describeOutboundFailure,
  outboundFetch,
} from '@openliri/infra/utils/outboundFetch';

const logger = getLogger('tools:webSearch');

/**
 * DuckDuckGo 的 `kl` 区域码 —— 显式声明"要哪个地区的索引"。
 * 这正是此前被出口 IP 劫持的维度（Bing 只能靠 `setlang`，实际仍按 IP 归属返回中文区）。
 * 未收录的语言回退 `wt-wt`（无区域偏好，由查询与出口自行决定）。
 */
function resolveDuckDuckGoRegion(language: string): string {
  const REGION_MAP: Record<string, string> = {
    'zh-CN': 'cn-zh',
    'zh-TW': 'tw-zh',
    'zh-HK': 'hk-zh',
    en: 'us-en',
    'en-US': 'us-en',
    'en-GB': 'uk-en',
    tr: 'tr-tr',
    ja: 'jp-jp',
    ko: 'kr-kr',
    de: 'de-de',
    fr: 'fr-fr',
    es: 'es-es',
    ru: 'ru-ru',
    pt: 'br-pt',
    it: 'it-it',
    ar: 'xa-ar',
  };
  return REGION_MAP[language] ?? REGION_MAP[language.split('-')[0]] ?? 'wt-wt';
}

function decodeSearchText(raw: string): string {
  // 行内标签（DDG 的 `<b>` 高亮常嵌在词中间，如 `İ<b>stanbul</b>`）必须用空串剥离，
  // 用空格会切出 "İ stanbul" 这类断词
  return StringUtils.unescapeHtml(raw.replace(/<[^>]+>/g, ''))
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DuckDuckGo 的结果链接是 `//duckduckgo.com/l/?uddg=<真实 URL>`，需解出真实地址 */
function resolveDuckDuckGoHref(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const direct = url.searchParams.get('uddg');
    return direct ? decodeURIComponent(direct) : href;
  } catch {
    return href;
  }
}

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

/**
 * U-03（2026-10-19）：模型可见出参结构（下发为 `output_schema`）。
 * 与 `WebSearchResult` 对齐；无结果分支额外带 `message`、且无 `searchUrl/safeSearch`
 * ⇒ 后两者标为可选（不虚构必填）。
 */
const WEB_SEARCH_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '检索词' },
    results: {
      type: 'array',
      description: '检索结果（已按 maxResults 截断）',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '标题' },
          url: { type: 'string', description: '链接' },
          snippet: { type: 'string', description: '摘要' },
          source: { type: 'string', description: '来源站点' },
          publishedDate: { type: 'string', description: '发布时间' },
          rank: { type: 'number', description: '排序位次' },
        },
        required: ['title', 'url', 'snippet'],
      },
    },
    totalResults: { type: 'number', description: '命中总数（未截断）' },
    searchUrl: { type: 'string', description: '实际请求的搜索地址' },
    safeSearch: { type: 'boolean', description: '是否启用安全搜索' },
    message: { type: 'string', description: '无结果时的说明（仅该分支出现）' },
  },
  required: ['query', 'results', 'totalResults'],
};

export class WebSearchTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.web_search;
  description =
    '搜索网络信息。用于查找时事、事实、文档或任何需要最新互联网资源的主题。';

  /** U-03（2026-10-19）：模型可见出参结构 */
  override outputJsonSchema = WEB_SEARCH_OUTPUT_JSON_SCHEMA;

  override tags = [ToolTag.NETWORK, ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'query',
      type: 'string',
      description: '搜索查询关键词',
      required: true,
      default: '',
    },
    {
      name: 'maxResults',
      type: 'number',
      description: '最大返回结果数',
      required: false,
      default: 10,
    },
    {
      name: 'language',
      type: 'string',
      description: '结果语言代码（如 "zh-CN"、"en-US"）',
      required: false,
      default: 'zh-CN',
    },
    {
      name: 'safeSearch',
      type: 'boolean',
      description: '启用安全搜索以过滤成人内容',
      required: false,
      default: true,
    },
    {
      name: 'timeout',
      type: 'number',
      description: '超时时间（毫秒）',
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

  override validateInput(input: any): ToolValidationResult {
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
      // 2026-11-03：主通道 DuckDuckGo HTML（静态可解析），Bing 仅作回退
      //（实测 Bing `/search` 已 JS 渲染：静态页 0 个 `b_algo`，回退基本不会命中）。
      const channels = [
        {
          name: 'duckduckgo',
          url: `${DUCKDUCKGO_HTML_SEARCH_BASE_URL}?q=${encodedQuery}&kl=${resolveDuckDuckGoRegion(language)}`,
          parse: (html: string) =>
            this.parseDuckDuckGoResults(html, maxResults),
        },
        {
          name: 'bing',
          url: `${BING_SEARCH_BASE_URL}?q=${encodedQuery}&count=${maxResults}&setlang=${language}`,
          parse: (html: string) => this.parseBingResults(html, maxResults),
        },
      ];

      logger.debug(`Searching with query: ${query}`);

      let results: SearchResult[] | null = null;
      let channelUsed = channels[0].name;
      let channelUrl = channels[0].url;
      let anyChannelConnected = false;
      let transportError: unknown = null;
      let lastHttpStatus: number | null = null;

      try {
        for (const channel of channels) {
          logger.debug(`API URL (${channel.name}): ${channel.url}`);
          try {
            // 统一出站层：继承 env / Windows 系统代理（2026-11-03）
            const response = await outboundFetch(channel.url, {
              method: 'GET',
              headers: {
                'User-Agent': buildUserAgent('WebSearch'),
                Accept: 'text/html',
              },
              signal: controller.signal,
            });

            logger.debug(
              `Response status (${channel.name}): ${response.status}`
            );

            if (!response.ok) {
              lastHttpStatus = response.status;
              continue;
            }

            anyChannelConnected = true;
            const html = await response.text();
            results = channel.parse(html);
            channelUsed = channel.name;
            channelUrl = channel.url;
            if (results && results.length > 0) break;
          } catch (error) {
            transportError = error;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }

      logger.debug(`Total results found: ${results?.length ?? 'unparsed'}`);

      // 所有通道都没连上 ⇒ 交给外层 catch 的出站分支给出"通道不可达 + 代理来源"
      if (!anyChannelConnected && transportError) {
        throw transportError;
      }
      if (!anyChannelConnected) {
        const failure = `Search failed: HTTP ${lastHttpStatus ?? 'unknown'}`;
        onProgress?.({
          toolUseID: context.toolUseId || 'web-search-tool',
          data: {
            type: 'web_search',
            query,
            error: failure,
            isRunning: false,
            isComplete: true,
          },
        });
        return createToolResult(failure, {
          newMessages: [{ role: 'system', content: `Error: ${failure}` }],
        });
      }

      // 2026-11-03（CS06）：连通但解析不出结构 ⇒ **不是**"零命中"。
      // 原实现这里会走"兜底提取页面所有链接"，把导航栏/壳页链接当成搜索结果
      //（假结果比空结果更糟）；现改为显式区分三态：通道失败 / 解析失败 / 真零结果。
      if (results === null) {
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
            message:
              '已连通搜索服务，但返回页面不是可识别的结果结构（可能是验证页、区域跳转页或站点改版）。这不是"零命中"，请重试或简化关键词。',
          },
          {
            newMessages: [
              {
                role: 'system',
                content:
                  '已连通搜索服务，但未能解析出结果结构（非零命中）。请重试或简化关键词。',
              },
            ],
          }
        );
      }

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
        searchUrl: channelUrl,
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

      logger.debug('Returning search results', JSON.stringify(result, null, 2));

      return createToolResult(result, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully searched for "${query}" via ${channelUsed} and found ${results.length} results in ${Date.now() - startTime}ms`,
          },
        ],
      });
    } catch (error) {
      await handleError(error, {
        module: 'tools:webSearch',
        action: '搜索错误',
      });

      // 2026-11-03：通道不可达要**显式**告诉模型"这是通道问题，不是没有相关内容"，
      // 并附生效代理来源（此前正是这条缺失让"代理没生效"被读成"世界上没有这些内容"）。
      const outboundMessage = describeOutboundFailure(error);
      if (outboundMessage) {
        onProgress?.({
          toolUseID: context.toolUseId || 'web-search-tool',
          data: {
            type: 'web_search',
            // catch 在 try 块外，`query` 不在作用域内：从入参兜底取值
            query: String(input['query'] ?? ''),
            error: outboundMessage,
            isRunning: false,
            isComplete: true,
          },
        });
        return createToolResult(outboundMessage, {
          newMessages: [
            { role: 'system', content: `Error: ${outboundMessage}` },
          ],
        });
      }

      if (error instanceof Error && error.name === 'AbortError') {
        return createToolResult(
          '搜索超时：请检查网络/代理后重试，或缩短查询范围。',
          {
            newMessages: [
              {
                role: 'system',
                content:
                  'Error: 搜索超时：请检查网络/代理后重试，或缩短查询范围。',
              },
            ],
          }
        );
      }

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
   * 解析 DuckDuckGo 的 HTML 结果页（`result__a` / `result__snippet`）。
   *
   * 每条结果自成一块（以下一条 `result__a` 为界），避免依赖嵌套的 `div` 结构
   *（DDG 的 DOM 层级不稳定，按块切分对改版更耐受）。
   * 返回 `null` 表示页面不是结果页（验证码 / 空页 / 改版）——区别于"真零结果"。
   */
  private parseDuckDuckGoResults(
    html: string,
    maxResults: number
  ): SearchResult[] | null {
    const blocks = html.split(/(?=<a[^>]*class="[^"]*result__a)/i).slice(1);
    if (blocks.length === 0) return null;

    const results: SearchResult[] = [];
    for (const block of blocks) {
      if (results.length >= maxResults) break;

      const anchor =
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!anchor) continue;

      const openTag = anchor[0].slice(0, anchor[0].indexOf('>') + 1);
      const href = /href="([^"]+)"/i.exec(openTag)?.[1];
      if (!href) continue;

      const title = decodeSearchText(anchor[1]);
      if (!title) continue;

      const snippetMatch =
        /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
          block
        );

      results.push({
        title,
        url: resolveDuckDuckGoHref(href),
        snippet: snippetMatch ? decodeSearchText(snippetMatch[1]) : '',
        source: 'duckduckgo',
      });
    }

    return results.length > 0 ? results : null;
  }

  private parseBingResults(
    html: string,
    maxResults: number
  ): SearchResult[] | null {
    const results: SearchResult[] = [];

    // 简单的 HTML 解析，提取搜索结果
    // 注意：这种方法可能会因 Bing 页面结构变化而失效

    // 只认**结构化结果块**：`b_algo` 或 `data-idx`。
    // 原实现还有一条"任意 li 含 h2"的宽泛模式，会把导航/侧栏块当结果，已移除。
    const patterns = [
      // 模式1: 匹配带有 class 的搜索结果项
      /<li[^>]*class="[^"\n]*b_algo[^"\n]*"[^>]*>(.*?)<\/li>/gs,
      // 模式2: 匹配带有 data-idx 属性的搜索结果项
      /<li[^>]*data-idx="[0-9]+"[^>]*>(.*?)<\/li>/gs,
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

    // 结构化结果块一个都没命中 ⇒ 页面不是结果页（验证页 / 区域跳转页 / 改版）。
    // 返回 `null` 表示"解析失败"，**不**把全页链接当结果——假结果比空结果更糟。
    return results.length === 0 ? null : results;
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
