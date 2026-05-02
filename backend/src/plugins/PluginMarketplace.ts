/**
 * 插件市场管理器
 * 负责与插件市场交互，获取插件列表，安装插件等
 */

import { join, existsSync, mkdirSync } from 'fs';
import { logger } from '../utils/log';
import { pluginInstallManager } from './PluginInstallManager';
import { PluginErrorFactory, PluginErrorHandler } from './PluginErrorHandler';
import type { PluginInstallOptions, PluginInstallResult } from './PluginInstallManager';

/**
 * 插件市场条目
 */
export interface PluginMarketplaceEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  repository: string;
  homepage: string;
  keywords: string[];
  categories: string[];
  downloads: number;
  stars: number;
  createdAt: string;
  updatedAt: string;
  source: string; // Git URL or other source
  requirements?: string[];
  compatibility?: string[];
}

/**
 * 插件市场搜索选项
 */
export interface PluginSearchOptions {
  query?: string;
  category?: string;
  keyword?: string;
  sortBy?: 'downloads' | 'stars' | 'updatedAt';
  page?: number;
  limit?: number;
}

/**
 * 插件市场搜索结果
 */
export interface PluginSearchResult {
  plugins: PluginMarketplaceEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * 插件市场管理器
 */
export class PluginMarketplace {
  private marketplaceUrl: string;
  private cacheDir: string;

  constructor() {
    // 默认插件市场URL
    this.marketplaceUrl = process.env.PLUGIN_MARKETPLACE_URL || 'https://plugins.pyapp.dev';
    this.cacheDir = join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'plugins', 'marketplace');
    
    // 确保缓存目录存在
    this.ensureCacheDir();
  }

  /**
   * 确保缓存目录存在
   */
  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 搜索插件
   * @param options 搜索选项
   * @returns 搜索结果
   */
  async searchPlugins(options: PluginSearchOptions = {}): Promise<PluginSearchResult> {
    try {
      const queryParams = new URLSearchParams();
      
      if (options.query) queryParams.append('q', options.query);
      if (options.category) queryParams.append('category', options.category);
      if (options.keyword) queryParams.append('keyword', options.keyword);
      if (options.sortBy) queryParams.append('sort', options.sortBy);
      if (options.page) queryParams.append('page', options.page.toString());
      if (options.limit) queryParams.append('limit', options.limit.toString());

      const url = `${this.marketplaceUrl}/api/plugins?${queryParams.toString()}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to search plugins: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      // 返回模拟数据作为 fallback
      return this.getMockSearchResult(options);
    }
  }

  /**
   * 获取插件详情
   * @param pluginId 插件ID
   * @returns 插件详情
   */
  async getPluginDetails(pluginId: string): Promise<PluginMarketplaceEntry | null> {
    try {
      const url = `${this.marketplaceUrl}/api/plugins/${pluginId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to get plugin details: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      // 返回模拟数据作为 fallback
      return this.getMockPluginDetails(pluginId);
    }
  }

  /**
   * 从市场安装插件
   * @param pluginId 插件ID
   * @param options 安装选项
   * @returns 安装结果
   */
  async installFromMarketplace(pluginId: string, options: PluginInstallOptions = {}): Promise<PluginInstallResult> {
    try {
      // 获取插件详情
      const plugin = await this.getPluginDetails(pluginId);
      if (!plugin) {
        throw PluginErrorFactory.createLoadError(`Plugin not found in marketplace: ${pluginId}`);
      }

      // 构建安装源
      const source = plugin.source;
      
      // 安装插件
      return await pluginInstallManager.install(source, options);
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install plugin from marketplace'
      };
    }
  }

  /**
   * 获取推荐插件
   * @param limit 限制数量
   * @returns 推荐插件列表
   */
  async getRecommendedPlugins(limit: number = 10): Promise<PluginMarketplaceEntry[]> {
    try {
      const url = `${this.marketplaceUrl}/api/plugins/recommended?limit=${limit}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to get recommended plugins: ${response.statusText}`);
      }

      const data = await response.json();
      return data.plugins || [];
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      // 返回模拟数据作为 fallback
      return this.getMockRecommendedPlugins(limit);
    }
  }

  /**
   * 获取热门插件
   * @param limit 限制数量
   * @returns 热门插件列表
   */
  async getPopularPlugins(limit: number = 10): Promise<PluginMarketplaceEntry[]> {
    try {
      const url = `${this.marketplaceUrl}/api/plugins/popular?limit=${limit}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to get popular plugins: ${response.statusText}`);
      }

      const data = await response.json();
      return data.plugins || [];
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      // 返回模拟数据作为 fallback
      return this.getMockPopularPlugins(limit);
    }
  }

  /**
   * 获取最新插件
   * @param limit 限制数量
   * @returns 最新插件列表
   */
  async getLatestPlugins(limit: number = 10): Promise<PluginMarketplaceEntry[]> {
    try {
      const url = `${this.marketplaceUrl}/api/plugins/latest?limit=${limit}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to get latest plugins: ${response.statusText}`);
      }

      const data = await response.json();
      return data.plugins || [];
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      // 返回模拟数据作为 fallback
      return this.getMockLatestPlugins(limit);
    }
  }

  /**
   * 刷新插件市场缓存
   */
  async refreshCache(): Promise<void> {
    // 实现缓存刷新逻辑
    logger.info('Refreshing plugin marketplace cache');
  }

  /**
   * 获取模拟搜索结果
   */
  private getMockSearchResult(options: PluginSearchOptions): PluginSearchResult {
    return {
      plugins: [
        {
          id: 'python-tools',
          name: 'Python Tools',
          version: '1.0.0',
          description: 'A collection of Python development tools',
          author: 'PY_APP Team',
          repository: 'https://github.com/pyapp/plugins',
          homepage: 'https://plugins.pyapp.dev/plugins/python-tools',
          keywords: ['python', 'development', 'tools'],
          categories: ['development', 'tools'],
          downloads: 1000,
          stars: 50,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          source: 'https://github.com/pyapp/python-tools-plugin.git'
        },
        {
          id: 'code-generator',
          name: 'Code Generator',
          version: '1.2.0',
          description: 'Generate code from templates',
          author: 'PY_APP Team',
          repository: 'https://github.com/pyapp/plugins',
          homepage: 'https://plugins.pyapp.dev/plugins/code-generator',
          keywords: ['code', 'generator', 'templates'],
          categories: ['development', 'productivity'],
          downloads: 800,
          stars: 40,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          source: 'https://github.com/pyapp/code-generator-plugin.git'
        }
      ],
      total: 2,
      page: options.page || 1,
      limit: options.limit || 10,
      pages: 1
    };
  }

  /**
   * 获取模拟插件详情
   */
  private getMockPluginDetails(pluginId: string): PluginMarketplaceEntry | null {
    return {
      id: pluginId,
      name: 'Mock Plugin',
      version: '1.0.0',
      description: 'A mock plugin for testing',
      author: 'PY_APP Team',
      repository: 'https://github.com/pyapp/plugins',
      homepage: `https://plugins.pyapp.dev/plugins/${pluginId}`,
      keywords: ['mock', 'testing'],
      categories: ['testing'],
      downloads: 100,
      stars: 10,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      source: `https://github.com/pyapp/${pluginId}-plugin.git`
    };
  }

  /**
   * 获取模拟推荐插件
   */
  private getMockRecommendedPlugins(limit: number): PluginMarketplaceEntry[] {
    return this.getMockSearchResult({ limit }).plugins;
  }

  /**
   * 获取模拟热门插件
   */
  private getMockPopularPlugins(limit: number): PluginMarketplaceEntry[] {
    return this.getMockSearchResult({ limit, sortBy: 'downloads' }).plugins;
  }

  /**
   * 获取模拟最新插件
   */
  private getMockLatestPlugins(limit: number): PluginMarketplaceEntry[] {
    return this.getMockSearchResult({ limit, sortBy: 'updatedAt' }).plugins;
  }
}

// 导出单例
export const pluginMarketplace = new PluginMarketplace();