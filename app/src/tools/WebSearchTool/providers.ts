/**
 * WebSearch Multi-Provider Support
 * 对标OpenClaw web-search多Provider支持
 * 支持Bing、Google、DuckDuckGo、Brave等多个搜索引擎
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export type SearchProvider =
  | 'bing'
  | 'google'
  | 'duckduckgo'
  | 'brave'
  | 'searxng';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedDate?: string;
  rank?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
  searchTime: number;
  provider: SearchProvider;
}

export interface ProviderConfig {
  name: SearchProvider;
  displayName: string;
  baseUrl: string;
  apiType: 'html' | 'json' | 'rss';
  defaultParams: Record<string, string>;
  requiresApiKey: boolean;
  priority: number;
  rateLimit: number;
}

export interface ProviderFactoryOptions {
  apiKeys?: Partial<Record<SearchProvider, string>>;
  defaultProvider?: SearchProvider;
  searxngBaseUrl?: string;
  timeout?: number;
}

const PROVIDER_CONFIGS: Record<SearchProvider, ProviderConfig> = {
  bing: {
    name: 'bing',
    displayName: 'Bing',
    baseUrl: 'https://www.bing.com/search',
    apiType: 'html',
    defaultParams: { count: '10', setlang: 'en-US' },
    requiresApiKey: false,
    priority: 10,
    rateLimit: 10,
  },
  google: {
    name: 'google',
    displayName: 'Google',
    baseUrl: 'https://www.google.com/search',
    apiType: 'html',
    defaultParams: { num: '10', hl: 'en' },
    requiresApiKey: false,
    priority: 9,
    rateLimit: 5,
  },
  duckduckgo: {
    name: 'duckduckgo',
    displayName: 'DuckDuckGo',
    baseUrl: 'https://html.duckduckgo.com/html',
    apiType: 'html',
    defaultParams: {},
    requiresApiKey: false,
    priority: 8,
    rateLimit: 15,
  },
  brave: {
    name: 'brave',
    displayName: 'Brave Search',
    baseUrl: 'https://search.brave.com/search',
    apiType: 'html',
    defaultParams: { source: 'web' },
    requiresApiKey: false,
    priority: 7,
    rateLimit: 15,
  },
  searxng: {
    name: 'searxng',
    displayName: 'SearXNG',
    baseUrl: 'http://localhost:8888/search',
    apiType: 'json',
    defaultParams: { format: 'json', language: 'auto' },
    requiresApiKey: false,
    priority: 5,
    rateLimit: 30,
  },
};

export class SearchProviderManager {
  private apiKeys: Partial<Record<SearchProvider, string>>;
  private defaultProvider: SearchProvider;
  private searxngBaseUrl: string;
  private timeout: number;
  private rateLimiters: Map<SearchProvider, number[]> = new Map();

  constructor(options?: ProviderFactoryOptions) {
    this.apiKeys = options?.apiKeys ?? {};
    this.defaultProvider = options?.defaultProvider ?? 'bing';
    this.searxngBaseUrl = options?.searxngBaseUrl ?? 'http://localhost:8888';
    this.timeout = options?.timeout ?? 30000;
  }

  getAvailableProviders(): SearchProvider[] {
    return (Object.keys(PROVIDER_CONFIGS) as SearchProvider[]).filter(
      (p) => !PROVIDER_CONFIGS[p].requiresApiKey || !!this.apiKeys[p]
    );
  }

  getProviderConfig(provider: SearchProvider): ProviderConfig {
    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
      throw new AppError(
        `Unknown search provider: ${provider}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { provider }
      );
    }
    return { ...config };
  }

  async search(
    query: string,
    options?: {
      provider?: SearchProvider;
      maxResults?: number;
      language?: string;
      safeSearch?: boolean;
    }
  ): Promise<SearchResponse> {
    const provider = options?.provider ?? this.defaultProvider;
    const config = this.getProviderConfig(provider);

    if (!this.canMakeRequest(provider)) {
      throw new AppError(
        `Rate limit exceeded for provider: ${config.displayName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        'RATE_LIMITED',
        { provider, displayName: config.displayName }
      );
    }

    this.recordRequest(provider);

    const startTime = Date.now();

    try {
      let results: SearchResult[];

      switch (provider) {
        case 'bing':
          results = await this.searchBing(query, options);
          break;
        case 'google':
          results = await this.searchGoogle(query, options);
          break;
        case 'duckduckgo':
          results = await this.searchDuckDuckGo(query, options);
          break;
        case 'brave':
          results = await this.searchBrave(query, options);
          break;
        case 'searxng':
          results = await this.searchSearxng(query, options);
          break;
        default:
          throw new AppError(
            `Unsupported provider: ${provider}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT',
            { provider }
          );
      }

      results.forEach((r, i) => {
        r.rank = i + 1;
        r.source = provider;
      });

      const searchTime = Date.now() - startTime;

      return {
        results: results.slice(0, options?.maxResults ?? 10),
        totalResults: results.length,
        searchTime,
        provider,
      };
    } catch (error) {
      const searchTime = Date.now() - startTime;
      throw error;
    }
  }

  private async searchBing(
    query: string,
    options?: { maxResults?: number; language?: string; safeSearch?: boolean }
  ): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://www.bing.com/search?q=${encoded}&count=${options?.maxResults ?? 10}&setlang=${options?.language ?? 'en-US'}`;

    const html = await this.fetchHtml(url);
    return this.parseBingResults(html);
  }

  private async searchGoogle(
    query: string,
    options?: { maxResults?: number; language?: string; safeSearch?: boolean }
  ): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encoded}&num=${options?.maxResults ?? 10}&hl=${options?.language ?? 'en'}`;

    const html = await this.fetchHtml(url);
    return this.parseGoogleResults(html);
  }

  private async searchDuckDuckGo(
    query: string,
    options?: { maxResults?: number; language?: string; safeSearch?: boolean }
  ): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html?q=${encoded}`;

    const html = await this.fetchHtml(url);
    return this.parseDuckDuckGoResults(html);
  }

  private async searchBrave(
    query: string,
    options?: { maxResults?: number; language?: string; safeSearch?: boolean }
  ): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://search.brave.com/search?q=${encoded}&source=web`;

    const html = await this.fetchHtml(url);
    return this.parseBraveResults(html);
  }

  private async searchSearxng(
    query: string,
    options?: { maxResults?: number; language?: string; safeSearch?: boolean }
  ): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const url = `${this.searxngBaseUrl}/search?q=${encoded}&format=json&language=${options?.language ?? 'auto'}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Liri/2.0 (SearchProvider)' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const data = (await response.json()) as any;
      return (data.results ?? []).map((r: any) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? r.snippet ?? '',
      }));
    } catch {
      clearTimeout(timeoutId);
      return [];
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return '';
      return await response.text();
    } catch {
      clearTimeout(timeoutId);
      return '';
    }
  }

  private parseBingResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const snippetPattern = /<li class="b_algo">([\s\S]*?)<\/li>/gi;
    let match: RegExpExecArray | null;

    while ((match = snippetPattern.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(
        /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

      if (titleMatch) {
        results.push({
          title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
          url: titleMatch[1],
          snippet: snippetMatch
            ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
            : '',
        });
      }
    }

    return results;
  }

  private parseGoogleResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const resultPattern = /<div class="g"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = resultPattern.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(
        /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );
      const snippetMatch = block.match(
        /<div class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      );

      if (titleMatch) {
        results.push({
          title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
          url: titleMatch[1],
          snippet: snippetMatch
            ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
            : '',
        });
      }
    }

    if (results.length === 0) {
      const altPattern =
        /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*><br>\s*<h3[^>]*>([\s\S]*?)<\/h3>/gi;
      while ((match = altPattern.exec(html)) !== null) {
        results.push({
          title: match[2].replace(/<[^>]+>/g, '').trim(),
          url: match[1],
          snippet: '',
        });
      }
    }

    return results;
  }

  private parseDuckDuckGoResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const resultPattern =
      /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = resultPattern.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(
        /<a[^>]*href=["']([^"']+)["'][^>]*class=["']result__a["'][^>]*>([\s\S]*?)<\/a>/i
      );
      const snippetMatch = block.match(
        /<a[^>]*class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>/i
      );

      if (titleMatch) {
        results.push({
          title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
          url: titleMatch[1].startsWith('//')
            ? 'https:' + titleMatch[1]
            : titleMatch[1],
          snippet: snippetMatch
            ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
            : '',
        });
      }
    }

    return results;
  }

  private parseBraveResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const resultPattern =
      /<div class="snippet[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = resultPattern.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(
        /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );
      const snippetMatch = block.match(
        /<p[^>]*class=["'][^"']*snippet-description[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
      );

      if (titleMatch) {
        results.push({
          title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
          url: titleMatch[1],
          snippet: snippetMatch
            ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
            : '',
        });
      }
    }

    return results;
  }

  private canMakeRequest(provider: SearchProvider): boolean {
    const timestamps = this.rateLimiters.get(provider);
    if (!timestamps || timestamps.length === 0) return true;

    const config = PROVIDER_CONFIGS[provider];
    const windowMs = 60000;
    const cutoff = Date.now() - windowMs;
    const recent = timestamps.filter((t) => t > cutoff);

    this.rateLimiters.set(provider, recent);
    return recent.length < config.rateLimit;
  }

  private recordRequest(provider: SearchProvider): void {
    const timestamps = this.rateLimiters.get(provider) ?? [];
    timestamps.push(Date.now());
    this.rateLimiters.set(provider, timestamps);
  }

  getProviderPriority(provider: SearchProvider): number {
    return PROVIDER_CONFIGS[provider]?.priority ?? 0;
  }

  setDefaultProvider(provider: SearchProvider): void {
    this.defaultProvider = provider;
  }

  async tryProviders(
    query: string,
    options?: {
      maxResults?: number;
      language?: string;
      safeSearch?: boolean;
    }
  ): Promise<SearchResponse> {
    const available = this.getAvailableProviders().sort(
      (a, b) => this.getProviderPriority(b) - this.getProviderPriority(a)
    );

    const errors: Array<{ provider: SearchProvider; error: string }> = [];

    for (const provider of available) {
      try {
        return await this.search(query, { ...options, provider });
      } catch (error) {
        errors.push({
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    throw new AppError(
      `All search providers failed. Errors: ${errors.map((e) => `${e.provider}: ${e.error}`).join('; ')}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'ALL_PROVIDERS_FAILED',
      { errors }
    );
  }
}
