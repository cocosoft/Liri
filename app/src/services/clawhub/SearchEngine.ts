/**
 * SearchEngine
 * 技能搜索模块，支持从 ClawHub 远程市场和未来其他来源（如 Hermes）搜索技能。
 * 采用可扩展的 Source 架构，允许动态添加新的搜索源。
 */

import https from 'node:https';
import http from 'node:http';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { ClawHubSkillMeta, SkillSearchResult } from './ClawHubAdapter';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 搜索源接口
 * 所有远程搜索源需实现此接口
 */
export interface SearchSource {
  /** 搜索源名称 */
  readonly name: string;
  /** 执行搜索 */
  search(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<SkillSearchResult[]>;
}

/**
 * ClawHub 市场搜索源
 */
interface ClawHubSearchResponse {
  skills: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license?: string;
    category?: string;
    tags?: string[];
    icon?: string;
    readme?: string;
    dependencies?: string[];
    permissions?: string[];
    manifestVersion?: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * SearchEngine 配置
 */
export interface SearchEngineConfig {
  /** ClawHub API 基础地址 */
  apiBaseUrl?: string;
  /** 请求超时（毫秒） */
  timeout?: number;
}

/**
 * SearchEngine
 * 技能搜索引擎，聚合多个搜索源的结果。
 */
export class SearchEngine {
  private apiBaseUrl: string;
  private timeout: number;
  private sources: Map<string, SearchSource> = new Map();

  /**
   * 构造函数
   * @param config 搜索配置
   */
  constructor(config: SearchEngineConfig = {}) {
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.clawhub.com/v1';
    this.timeout = config.timeout || 10000;

    this.registerDefaultSources();
  }

  /**
   * 注册默认搜索源
   */
  private registerDefaultSources(): void {
    this.sources.set(
      'clawhub',
      new ClawHubSearchSource(this.apiBaseUrl, this.timeout)
    );
    this.sources.set('github', new GitHubSearchSource(this.timeout));
  }

  /**
   * 注册自定义搜索源
   * 用于扩展支持其他生态（如 Hermes）
   * @param name 搜索源名称
   * @param source 搜索源实例
   */
  registerSource(name: string, source: SearchSource): void {
    if (this.sources.has(name)) {
      logger.warn(`搜索源已存在，将被覆盖: ${name}`);
    }
    this.sources.set(name, source);
    logger.info(`已注册搜索源: ${name}`);
  }

  /**
   * 注销搜索源
   * @param name 搜索源名称
   */
  unregisterSource(name: string): void {
    this.sources.delete(name);
  }

  /**
   * 获取所有已注册的搜索源名称
   * @returns 搜索源名称列表
   */
  getSourceNames(): string[] {
    return Array.from(this.sources.keys());
  }

  /**
   * 搜索远程技能
   * 聚合所有已注册搜索源的结果
   * @param query 搜索关键词
   * @param options 搜索选项
   * @returns 合并后的搜索结果
   */
  async searchRemote(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<SkillSearchResult[]> {
    const sources = Array.from(this.sources.values());
    const results = await Promise.allSettled(
      sources.map((source) => source.search(query, options))
    );

    const merged: SkillSearchResult[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const sourceName = sources[i].name;

      if (result.status === 'fulfilled') {
        for (const item of result.value) {
          if (!seenIds.has(item.skill.id)) {
            seenIds.add(item.skill.id);
            merged.push({ ...item, source: sourceName });
          }
        }
      } else {
        logger.warn(`搜索源 ${sourceName} 搜索失败`, result.reason as Error);
      }
    }

    return merged;
  }

  /**
   * 从 ClawHub 获取技能详情
   * @param skillId 技能 ID
   * @returns 技能元数据或 null
   */
  async getSkillDetail(skillId: string): Promise<ClawHubSkillMeta | null> {
    try {
      const url = `${this.apiBaseUrl}/skills/${encodeURIComponent(skillId)}`;
      const data = await this.httpGet(url);
      return this.mapToSkillMeta(data);
    } catch (error) {
      logger.error(`获取技能详情失败: ${skillId}`, error as Error);
      return null;
    }
  }

  /**
   * 发起 HTTP GET 请求
   * @param url 请求地址
   * @returns 解析后的 JSON 数据
   */
  private httpGet(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      const req = client.get(url, { timeout: this.timeout }, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(JSON.parse(body));
            } else {
              reject(
                new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
              );
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }

  /**
   * 将 API 返回数据映射为 ClawHubSkillMeta
   * @param data API 返回的原始数据
   * @returns 标准化的技能元数据
   */
  private mapToSkillMeta(data: any): ClawHubSkillMeta {
    return {
      id: data.id || '',
      name: data.name || '',
      version: data.version || '1.0.0',
      description: data.description || '',
      author: data.author || '',
      license: data.license,
      category: data.category,
      tags: data.tags || [],
      icon: data.icon,
      readme: data.readme,
      dependencies: data.dependencies,
      permissions: data.permissions,
      manifestVersion: data.manifestVersion || '1.0',
      source: 'third_party',
    };
  }
}

/**
 * ClawHub 远程搜索源实现
 */
class ClawHubSearchSource implements SearchSource {
  readonly name = 'clawhub';

  private apiBaseUrl: string;
  private timeout: number;

  constructor(apiBaseUrl: string, timeout: number) {
    this.apiBaseUrl = apiBaseUrl;
    this.timeout = timeout;
  }

  /**
   * 执行 ClawHub 市场搜索
   * @param query 搜索关键词
   * @param options 搜索选项
   * @returns 搜索结果
   */
  async search(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<SkillSearchResult[]> {
    const params = new URLSearchParams();
    if (query) {
      params.set('q', query);
    }
    if (options?.category) {
      params.set('category', options.category);
    }
    if (options?.tags?.length) {
      params.set('tags', options.tags.join(','));
    }
    params.set('pageSize', '50');

    try {
      const url = `${this.apiBaseUrl}/skills/search?${params.toString()}`;
      const response = await this.httpGet(url);

      const data = response as ClawHubSearchResponse;
      return (data.skills || []).map((item) => ({
        skill: {
          id: item.id,
          name: item.name,
          version: item.version || '1.0.0',
          description: item.description,
          author: item.author,
          license: item.license,
          category: item.category,
          tags: item.tags || [],
          icon: item.icon,
          readme: item.readme,
          dependencies: item.dependencies,
          permissions: item.permissions,
          manifestVersion: item.manifestVersion || '1.0',
          source: 'third_party',
        },
        source: 'third_party',
      }));
    } catch (error) {
      logger.warn('ClawHub 远程搜索失败，返回空结果', error as Error);
      return [];
    }
  }

  /**
   * 发起 HTTP GET 请求
   */
  private httpGet(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      const req = client.get(url, { timeout: this.timeout }, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(JSON.parse(body));
            } else {
              reject(
                new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
              );
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }
}

/**
 * 搜索结果的缓存条目
 */
interface CacheEntry {
  data: SkillSearchResult[];
  timestamp: number;
}

/**
 * GitHub 生态搜索源
 * 通过 GitHub API 搜索公开仓库中的 ClawHub 技能
 * 支持以 "clawhub-skill" 或 "py-app-skill" 主题标记的技能仓库
 */
class GitHubSearchSource implements SearchSource {
  readonly name = 'github';

  private timeout: number;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTL = 5 * 60 * 1000;

  /**
   * 构造函数
   * @param timeout HTTP 请求超时时间（毫秒）
   */
  constructor(timeout: number) {
    this.timeout = timeout;
  }

  /**
   * 搜索 GitHub 上的技能仓库
   * @param query 搜索关键词
   * @param _options 搜索选项（当前未使用）
   * @returns 搜索结果
   */
  async search(
    query: string,
    _options?: { category?: string; tags?: string[] }
  ): Promise<SkillSearchResult[]> {
    const cacheKey = query || '__all__';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      const searchQuery = this.buildSearchQuery(query);
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=20`;
      const data = await this.httpGet(searchUrl);
      const results = this.parseGitHubResponse(data);

      this.cache.set(cacheKey, { data: results, timestamp: Date.now() });

      return results;
    } catch (error) {
      logger.warn('GitHub 搜索失败，返回空结果', error as Error);
      return [];
    }
  }

  /**
   * 构建 GitHub 搜索查询
   * 组合主题标签和用户搜索词
   * @param query 用户输入的搜索词
   * @returns GitHub 搜索查询字符串
   */
  private buildSearchQuery(query: string): string {
    const topics = ['topic:clawhub-skill', 'topic:py-app-skill'];
    const baseQuery = topics.join('+');

    if (query) {
      return `${query}+${baseQuery}`;
    }

    return baseQuery;
  }

  /**
   * 解析 GitHub API 返回的仓库搜索结果
   * @param data GitHub API 响应数据
   * @returns 标准化的技能搜索结果列表
   */
  private parseGitHubResponse(data: any): SkillSearchResult[] {
    const items = data.items || [];

    return items.map((item: any) => ({
      skill: {
        id: `github:${item.full_name}`,
        name: item.name,
        version: '1.0.0',
        description: item.description || '',
        author: item.owner?.login || 'unknown',
        license: item.license?.spdx_id || undefined,
        category: 'community',
        tags: item.topics || [],
        icon: item.owner?.avatar_url,
        readme: item.html_url
          ? `${item.html_url}/blob/main/README.md`
          : undefined,
        dependencies: [],
        permissions: [],
        manifestVersion: '1.0',
        source: 'third_party',
      },
      source: 'third_party',
      score: item.score || 0,
    }));
  }

  /**
   * 发起 HTTP GET 请求（带 User-Agent）
   * @param url 请求地址
   * @returns 解析后的 JSON 数据
   */
  private httpGet(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      const req = client.get(
        url,
        {
          timeout: this.timeout,
          headers: { 'User-Agent': 'PY_APP-ClawHub/1.0' },
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf-8');

              if (res.statusCode === 403) {
                logger.warn('GitHub API 速率限制，跳过 GitHub 搜索');
                resolve({ items: [] });
                return;
              }

              if (
                res.statusCode &&
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve(JSON.parse(body));
              } else {
                resolve({ items: [] });
              }
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }
}
