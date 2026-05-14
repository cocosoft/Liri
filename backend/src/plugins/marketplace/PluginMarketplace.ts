/**
 * PluginMarketplace 插件市场
 * 提供插件市场的浏览、搜索、安装功能
 */

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
 * ClawHub 插件市场
 * 对标 OpenClaw 的 ClawHub 市场系统
 */
export class PluginMarketplace {
  private plugins: Map<string, MarketplacePlugin> = new Map();
  private catalogUrl: string;

  constructor(catalogUrl?: string) {
    this.catalogUrl = catalogUrl || 'https://registry.pyapp.dev/plugins';
    this.initializeDefaultCatalog();
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
          p.tags.some((t) => t.toLowerCase().includes(q))
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
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
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
   * 从远程同步市场数据
   */
  async syncFromRemote(): Promise<boolean> {
    try {
      const response = await fetch(this.catalogUrl);
      if (!response.ok) return false;
      const plugins: MarketplacePlugin[] = await response.json();
      for (const plugin of plugins) {
        this.plugins.set(plugin.id, plugin);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 初始化默认市场目录
   */
  private initializeDefaultCatalog(): void {
    const defaultPlugins: MarketplacePlugin[] = [
      {
        id: 'pyapp.code-analyzer',
        name: 'Code Analyzer',
        description: '代码质量分析与优化建议',
        version: '1.0.0',
        author: 'PY_APP',
        tags: ['analysis', 'code', 'quality'],
        downloads: 1520,
        rating: 4.5,
        updatedAt: '2026-05-01',
      },
      {
        id: 'pyapp.git-manager',
        name: 'Git Manager',
        description: 'Git 操作管理与可视化',
        version: '1.2.0',
        author: 'PY_APP',
        tags: ['git', 'vcs', 'manager'],
        downloads: 2340,
        rating: 4.8,
        updatedAt: '2026-05-10',
      },
      {
        id: 'pyapp.theme-editor',
        name: 'Theme Editor',
        description: '主题自定义编辑器',
        version: '0.9.0',
        author: 'PY_APP',
        tags: ['theme', 'ui', 'editor'],
        downloads: 890,
        rating: 4.2,
        updatedAt: '2026-04-20',
      },
      {
        id: 'pyapp.terminal-plus',
        name: 'Terminal Plus',
        description: '增强终端模拟器',
        version: '2.1.0',
        author: 'PY_APP',
        tags: ['terminal', 'ui', 'tool'],
        downloads: 3100,
        rating: 4.9,
        updatedAt: '2026-05-14',
      },
      {
        id: 'pyapp.export-tools',
        name: 'Export Tools',
        description: '多格式导出工具集',
        version: '1.0.0',
        author: 'PY_APP',
        tags: ['export', 'pdf', 'markdown', 'html'],
        downloads: 1200,
        rating: 4.3,
        updatedAt: '2026-05-05',
      },
    ];

    for (const plugin of defaultPlugins) {
      this.plugins.set(plugin.id, plugin);
    }
  }
}

export const pluginMarketplace = new PluginMarketplace();
