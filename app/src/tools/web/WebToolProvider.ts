/**
 * Web 交互工具增强
 * 对标 Hermes web_fetch / web_search / browser_tool
 * 提供统一的 Web 交互抽象层
 */

/**
 * Web 工具类型
 */
export type WebToolType = 'fetch' | 'search' | 'browser' | 'screenshot';

/**
 * Web Fetch 请求
 */
export interface WebFetchRequest {
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  followRedirects: boolean;
  maxContentSize: number;
}

/**
 * Web Fetch 结果
 */
export interface WebFetchResult {
  success: boolean;
  url: string;
  statusCode?: number;
  content: string;
  contentType?: string;
  contentLength: number;
  durationMs: number;
  error?: string;
  headers?: Record<string, string>;
}

/**
 * Web 搜索请求
 */
export interface WebSearchRequest {
  query: string;
  maxResults: number;
  includeSnippet: boolean;
  language?: string;
  region?: string;
}

/**
 * Web 搜索结果条目
 */
export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  relevance: number;
}

/**
 * Web 搜索响应
 */
export interface WebSearchResponse {
  query: string;
  results: WebSearchResultItem[];
  totalResults: number;
  durationMs: number;
  provider: string;
}

/**
 * Web 工具提供者接口
 */
export interface WebToolProvider {
  readonly id: string;
  readonly displayName: string;

  /**
   * Web 抓取
   * @param request 抓取请求
   * @returns 抓取结果
   */
  fetch(request: WebFetchRequest): Promise<WebFetchResult>;

  /**
   * Web 搜索
   * @param request 搜索请求
   * @returns 搜索结果
   */
  search(request: WebSearchRequest): Promise<WebSearchResponse>;
}

/**
 * 默认 Web 抓取工具
 * 使用系统内置 fetch API
 */
export class DefaultWebFetcher implements WebToolProvider {
  readonly id = 'default-fetcher';
  readonly displayName = 'Default Web Fetcher';

  async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);

      const response = await fetch(request.url, {
        method: request.method,
        headers: {
          'User-Agent': 'PY_APP/1.0',
          Accept: 'text/html,text/plain,application/json',
          ...(request.headers || {}),
        },
        body: request.body,
        signal: controller.signal,
        redirect: request.followRedirects ? 'follow' : 'manual',
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || undefined;
      let content = '';

      if (contentType && contentType.includes('text/html')) {
        const text = await response.text();
        content = this.stripHTMLTags(text).slice(0, request.maxContentSize);
      } else if (contentType && contentType.includes('application/json')) {
        content = await response.text();
        content = content.slice(0, request.maxContentSize);
      } else {
        const text = await response.text();
        content = text.slice(0, request.maxContentSize);
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        success: response.ok,
        url: request.url,
        statusCode: response.status,
        content,
        contentType,
        contentLength: content.length,
        durationMs: Date.now() - startTime,
        headers,
      };
    } catch (err) {
      return {
        success: false,
        url: request.url,
        content: '',
        contentLength: 0,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : '抓取失败',
      };
    }
  }

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    return {
      query: request.query,
      results: [],
      totalResults: 0,
      durationMs: 0,
      provider: this.id,
    };
  }

  /**
   * 去除 HTML 标签并提取文本
   * @param html HTML 字符串
   * @returns 纯文本
   */
  private stripHTMLTags(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&\w+;/g, ' ')
      .replace(/\s{2,}/g, '\n')
      .trim();
  }
}

/**
 * Web 工具注册表
 */
export class WebToolRegistry {
  private providers: Map<string, WebToolProvider> = new Map();
  private defaultProvider: WebToolProvider;

  constructor() {
    this.defaultProvider = new DefaultWebFetcher();
  }

  /**
   * 注册提供商
   * @param provider 提供商
   */
  register(provider: WebToolProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * 获取提供商
   * @param id 提供商 ID
   * @returns 提供商
   */
  get(id?: string): WebToolProvider {
    if (id && this.providers.has(id)) {
      return this.providers.get(id)!;
    }

    return this.defaultProvider;
  }

  /**
   * 获取所有提供商
   */
  getAll(): WebToolProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 执行抓取请求
   * @param url URL
   * @param options 选项
   * @returns 抓取结果
   */
  async fetchUrl(
    url: string,
    options?: Partial<WebFetchRequest>
  ): Promise<WebFetchResult> {
    const provider = this.get();

    return provider.fetch({
      url,
      method: 'GET',
      timeoutMs: 15_000,
      followRedirects: true,
      maxContentSize: 500_000,
      ...options,
    });
  }

  /**
   * 执行搜索请求
   * @param query 查询
   * @param options 选项
   * @returns 搜索结果
   */
  async searchWeb(
    query: string,
    options?: Partial<WebSearchRequest>
  ): Promise<WebSearchResponse> {
    const provider = this.get();

    return provider.search({
      query,
      maxResults: 10,
      includeSnippet: true,
      ...options,
    });
  }
}

/**
 * 全局 Web 工具注册表
 */
let globalWebToolRegistry: WebToolRegistry | null = null;

/**
 * 获取全局 Web 工具注册表
 */
export function getWebToolRegistry(): WebToolRegistry {
  if (!globalWebToolRegistry) {
    globalWebToolRegistry = new WebToolRegistry();
  }

  return globalWebToolRegistry;
}
