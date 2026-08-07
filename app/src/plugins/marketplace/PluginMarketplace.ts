/**
 * PluginMarketplace 插件市场
 * 提供插件市场的浏览、搜索、安装功能
 * 支持多版本、本地缓存、远程同步和更新检查
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { resolvePluginsCacheDir } from '@modules/core';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:marketplace:PluginMarketplace',
  level: LogLevel.INFO,
});

/**
 * 市场插件信息
 */
export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
  updatedAt: string;
  repository?: string;
  homepage?: string;
  license?: string;
}

/**
 * 插件版本元数据
 */
export interface MarketPluginVersion {
  version: string;
  releaseNotes?: string;
  publishedAt: string;
  minimumEngineVersion?: string;
  dependencies?: Array<{ name: string; version: string }>;
}

/**
 * 市场搜索选项
 */
export interface MarketplaceSearchOptions {
  query?: string;
  tags?: string[];
  author?: string;
  sortBy?: 'downloads' | 'rating' | 'updated' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * 市场搜索结果
 */
export interface MarketplaceSearchResult {
  plugins: MarketplacePlugin[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * 更新检查结果
 */
export interface MarketUpdateInfo {
  pluginId: string;
  pluginName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
}

/**
 * 缓存元数据
 */
interface CacheMeta {
  cachedAt: number;
  ttlMs: number;
  etag?: string;
}

const DEFAULT_CACHE_TTL_MS = 3600 * 1000;

function getCacheDir(): string {
  // 2026-08-06 路径收敛：市场缓存统一 ~/.pyapp/plugins/cache
  return resolvePluginsCacheDir();
}

function getCacheFilePath(): string {
  return join(getCacheDir(), 'marketplace-catalog.json');
}

function getCacheMetaFilePath(): string {
  return join(getCacheDir(), 'marketplace-catalog-meta.json');
}

/**
 * 市场安装结果
 */
export interface MarketInstallResult {
  success: boolean;
  pluginName: string;
  version: string;
  resolvedDependencies: Array<{ name: string; version: string }>;
  warnings: string[];
  error?: string;
}

/**
 * ClawHub 插件市场
 * 对标 OpenClaw 的 ClawHub 市场系统
 */
export class PluginMarketplace {
  private plugins: Map<string, MarketplacePlugin> = new Map();
  private versions: Map<string, MarketPluginVersion[]> = new Map();
  private catalogUrl: string;
  private cacheDir: string;

  constructor(catalogUrl?: string) {
    this.catalogUrl = catalogUrl || 'https://registry.openliri.com/plugins';
    this.cacheDir = getCacheDir();
    this.loadLocalCache();
  }

  /**
   * 搜索插件
   */
  search(options: MarketplaceSearchOptions): MarketplaceSearchResult {
    let results = Array.from(this.plugins.values());

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.author.toLowerCase().includes(q)
      );
    }

    if (options.tags && options.tags.length > 0) {
      results = results.filter((p) =>
        options.tags!.some((t) => p.tags.includes(t))
      );
    }

    if (options.author) {
      results = results.filter((p) =>
        p.author.toLowerCase().includes(options.author!.toLowerCase())
      );
    }

    const sortBy = options.sortBy || 'downloads';
    const sortOrder = options.sortOrder || 'desc';

    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'downloads':
          cmp = a.downloads - b.downloads;
          break;
        case 'rating':
          cmp = a.rating - b.rating;
          break;
        case 'updated':
          cmp =
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const total = results.length;
    const start = (page - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    return {
      plugins: paged,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  /**
   * 获取插件详情
   */
  getPlugin(id: string): MarketplacePlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * 获取插件的所有可用版本
   */
  getPluginVersions(id: string): MarketPluginVersion[] {
    return this.versions.get(id) || [];
  }

  /**
   * 获取插件的最新版本号
   */
  getLatestVersion(id: string): string | undefined {
    const versions = this.versions.get(id);
    if (!versions || versions.length === 0) {
      const plugin = this.plugins.get(id);
      return plugin?.version;
    }
    return versions[versions.length - 1].version;
  }

  /**
   * 检查是否有可用更新
   */
  checkForUpdates(
    pluginId: string,
    currentVersion: string
  ): MarketUpdateInfo | undefined {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;

    const latestVersion = this.getLatestVersion(pluginId);
    if (!latestVersion) return undefined;

    const updateAvailable =
      this.compareVersions(latestVersion, currentVersion) > 0;

    const versions = this.versions.get(pluginId);
    const latestMeta = versions ? versions[versions.length - 1] : undefined;

    return {
      pluginId,
      pluginName: plugin.name,
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseNotes: latestMeta?.releaseNotes,
    };
  }

  /**
   * 检查所有已安装插件的更新
   */
  checkAllForUpdates(
    installedPlugins: Array<{ id: string; version: string }>
  ): MarketUpdateInfo[] {
    const results: MarketUpdateInfo[] = [];
    for (const installed of installedPlugins) {
      const info = this.checkForUpdates(installed.id, installed.version);
      if (info) {
        results.push(info);
      }
    }
    return results;
  }

  /**
   * 获取分类列表
   */
  getCategories(): Array<{ name: string; count: number }> {
    const tagCount = new Map<string, number>();
    for (const plugin of this.plugins.values()) {
      for (const tag of plugin.tags) {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      }
    }
    return Array.from(tagCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 获取热门插件
   */
  getTopPlugins(limit: number = 10): MarketplacePlugin[] {
    return Array.from(this.plugins.values())
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  /**
   * 获取推荐插件
   */
  getRecommendedPlugins(limit: number = 5): MarketplacePlugin[] {
    return Array.from(this.plugins.values())
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  }

  /**
   * 注册插件到市场
   */
  registerPlugin(plugin: MarketplacePlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * 注册插件版本
   */
  registerPluginVersion(id: string, version: MarketPluginVersion): void {
    const existing = this.versions.get(id) || [];
    const idx = existing.findIndex((v) => v.version === version.version);
    if (idx >= 0) {
      existing[idx] = version;
    } else {
      existing.push(version);
    }
    existing.sort((a, b) => this.compareVersions(a.version, b.version));
    this.versions.set(id, existing);
  }

  /**
   * 从远程同步市场数据（带本地缓存）
   */
  async syncFromRemote(force: boolean = false): Promise<boolean> {
    try {
      if (!force) {
        const meta = this.readCacheMeta();
        if (meta && Date.now() - meta.cachedAt < meta.ttlMs) {
          return true;
        }
      }

      const headers: Record<string, string> = {};
      const meta = this.readCacheMeta();
      if (meta?.etag && !force) {
        headers['If-None-Match'] = meta.etag;
      }

      const response = await fetch(this.catalogUrl, { headers });
      if (response.status === 304) {
        this.writeCacheMeta({
          cachedAt: Date.now(),
          ttlMs: DEFAULT_CACHE_TTL_MS,
          etag: meta?.etag,
        });
        return true;
      }

      if (!response.ok) return false;

      interface RemotePluginData {
        id: string;
        name: string;
        description: string;
        version: string;
        author: string;
        tags: string[];
        downloads: number;
        rating: number;
        updatedAt: string;
        repository?: string;
        homepage?: string;
        license?: string;
        versions?: MarketPluginVersion[];
      }

      const data: RemotePluginData[] = await response.json();
      for (const item of data) {
        const plugin: MarketplacePlugin = {
          id: item.id,
          name: item.name,
          description: item.description,
          version: item.version,
          author: item.author,
          tags: item.tags,
          downloads: item.downloads,
          rating: item.rating,
          updatedAt: item.updatedAt,
          repository: item.repository,
          homepage: item.homepage,
          license: item.license,
        };
        this.plugins.set(plugin.id, plugin);

        if (item.versions && item.versions.length > 0) {
          const sorted = [...item.versions].sort((a, b) =>
            this.compareVersions(a.version, b.version)
          );
          this.versions.set(plugin.id, sorted);
        }
      }

      const etag = response.headers.get('etag') || undefined;
      this.saveCatalogToCache(data);
      this.writeCacheMeta({
        cachedAt: Date.now(),
        ttlMs: DEFAULT_CACHE_TTL_MS,
        etag,
      });

      return true;
    } catch {
      // @ignore-catch — 市场操作失败返回 false（外部网络依赖，失败按不可用处理）
      return false;
    }
  }

  /**
   * 注册插件更新（发布新版本）
   */
  publishPluginVersion(
    id: string,
    name: string,
    description: string,
    author: string,
    tags: string[],
    version: MarketPluginVersion
  ): boolean {
    const existing = this.plugins.get(id);
    if (!existing) {
      const newPlugin: MarketplacePlugin = {
        id,
        name,
        description,
        version: version.version,
        author,
        tags,
        downloads: 0,
        rating: 0,
        updatedAt: version.publishedAt,
      };
      this.plugins.set(id, newPlugin);
    } else {
      if (this.compareVersions(version.version, existing.version) > 0) {
        existing.version = version.version;
        existing.updatedAt = version.publishedAt;
      }
    }

    this.registerPluginVersion(id, version);
    return true;
  }

  /**
   * 获取缓存是否有效
   */
  isCacheValid(): boolean {
    const meta = this.readCacheMeta();
    if (!meta) return false;
    return Date.now() - meta.cachedAt < meta.ttlMs;
  }

  /**
   * 获取缓存过期时间（剩余毫秒）
   */
  getCacheTimeToLive(): number {
    const meta = this.readCacheMeta();
    if (!meta) return 0;
    const remaining = meta.ttlMs - (Date.now() - meta.cachedAt);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 比较两个版本号
   */
  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map((p) => {
      const num = parseInt(p, 10);
      return isNaN(num) ? 0 : num;
    });
    const bParts = b.split('.').map((p) => {
      const num = parseInt(p, 10);
      return isNaN(num) ? 0 : num;
    });

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal > bVal) return 1;
      if (aVal < bVal) return -1;
    }

    return 0;
  }

  /**
   * 保存目录到本地缓存
   */
  private saveCatalogToCache(data: unknown): void {
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
      writeFileSync(getCacheFilePath(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      // 缓存写入失败不中断主流程

      handleError(err, {
        module: 'plugins:marketplace',
        action: 'saveCacheFile',
      });
    }
  }

  /**
   * 从本地缓存加载目录
   */
  private loadLocalCache(): void {
    try {
      const meta = this.readCacheMeta();
      if (!meta || Date.now() - meta.cachedAt >= meta.ttlMs) return;

      const filePath = getCacheFilePath();
      if (!existsSync(filePath)) return;

      const raw = readFileSync(filePath, 'utf-8');

      interface RemotePluginData {
        id: string;
        name: string;
        description: string;
        version: string;
        author: string;
        tags: string[];
        downloads: number;
        rating: number;
        updatedAt: string;
        repository?: string;
        homepage?: string;
        license?: string;
        versions?: MarketPluginVersion[];
      }

      const data: RemotePluginData[] = JSON.parse(raw);
      for (const item of data) {
        const plugin: MarketplacePlugin = {
          id: item.id,
          name: item.name,
          description: item.description,
          version: item.version,
          author: item.author,
          tags: item.tags,
          downloads: item.downloads,
          rating: item.rating,
          updatedAt: item.updatedAt,
          repository: item.repository,
          homepage: item.homepage,
          license: item.license,
        };
        this.plugins.set(plugin.id, plugin);

        if (item.versions && item.versions.length > 0) {
          this.versions.set(plugin.id, item.versions);
        }
      }
    } catch (err) {
      // 缓存加载失败不中断

      handleError(err, {
        module: 'plugins:marketplace',
        action: 'loadCacheFile',
      });
    }
  }

  /**
   * 读取缓存元数据
   */
  private readCacheMeta(): CacheMeta | null {
    try {
      const filePath = getCacheMetaFilePath();
      if (!existsSync(filePath)) return null;
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as CacheMeta;
    } catch {
      // @ignore-catch — 缓存元数据解析失败返回 null（损坏缓存按无缓存处理）
      return null;
    }
  }

  /**
   * 写入缓存元数据
   */
  private writeCacheMeta(meta: CacheMeta): void {
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
      writeFileSync(
        getCacheMetaFilePath(),
        JSON.stringify(meta, null, 2),
        'utf-8'
      );
    } catch (err) {
      // 元数据写入失败不中断

      handleError(err, {
        module: 'plugins:marketplace',
        action: 'saveMetadataFile',
      });
    }
  }

  /**
   * 从市场安装插件并解析依赖
   * 整合 PluginDependencyManager 和 dependencyResolver
   */
  async installFromMarket(
    pluginId: string,
    version?: string
  ): Promise<MarketInstallResult> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return {
        success: false,
        pluginName: pluginId,
        version: version || 'unknown',
        resolvedDependencies: [],
        warnings: [],
        error: `插件 "${pluginId}" 不存在于市场中`,
      };
    }

    const targetVersion =
      version || this.getLatestVersion(pluginId) || plugin.version;
    const warnings: string[] = [];

    const allVersions = this.versions.get(pluginId) || [];
    const targetMeta = allVersions.find((v) => v.version === targetVersion);
    const depList = targetMeta?.dependencies || [];

    const resolvedDependencies: Array<{ name: string; version: string }> = [];

    if (depList.length > 0) {
      try {
        const { resolveDependencyClosure } =
          await import('../utils/dependencyResolver.js');

        const qualifiedId = `${pluginId}@marketplace`;
        const alreadyEnabled = new Set<string>();

        const result = await resolveDependencyClosure(
          qualifiedId,
          async (id: string) => {
            const rawName = id.split('@')[0];
            const marketPlugin = this.plugins.get(rawName);
            if (!marketPlugin) return null;

            const pVersions = this.versions.get(rawName) || [];
            const pLatest = pVersions[pVersions.length - 1];
            const pDeps = pLatest?.dependencies?.map((d) => d.name) || [];

            return { dependencies: pDeps };
          },
          alreadyEnabled
        );

        if (!result.ok) {
          const reason = result.reason;
          if (reason === 'cycle') {
            warnings.push(`依赖检测到循环引用: ${result.chain.join(' -> ')}`);
          } else if (reason === 'not-found') {
            warnings.push(
              `依赖 "${result.missing}" 未找到（由 ${result.requiredBy} 引用）`
            );
          } else if (reason === 'cross-marketplace') {
            warnings.push(
              `跨市场依赖 "${result.dependency}" 不被允许（由 ${result.requiredBy} 引用）`
            );
          }
        } else if (result.ok && result.closure.length > 1) {
          for (const depId of result.closure) {
            if (depId === qualifiedId) continue;
            const rawName = depId.split('@')[0];
            const depPlugin = this.plugins.get(rawName);
            if (depPlugin) {
              resolvedDependencies.push({
                name: rawName,
                version: depPlugin.version,
              });
            }
          }
        }
      } catch (error) {
        warnings.push(
          `依赖解析出错: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      success: true,
      pluginName: plugin.name,
      version: targetVersion,
      resolvedDependencies,
      warnings,
    };
  }
}

export const pluginMarketplace = new PluginMarketplace();
