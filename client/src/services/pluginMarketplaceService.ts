import { httpLegacy as http } from "./httpClient";

/** 市场插件信息（后端 PluginMarketplace.MarketplacePlugin） */
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
  /** 插件类型（PY-6：'python' 表示 Python 插件，市场页显示语言标签） */
  type?: string;
}

/** 已安装插件信息（后端 PluginSystem.getPluginInfoList 的 PluginInfo） */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;
  installed: boolean;
  enabled: boolean;
  path?: string;
}

/** 响应式挂起插件（后端 PluginSystem.getPendingSdkPlugins 快照，4.4） */
export interface PendingPlugin {
  pluginId: string;
  pluginName: string;
  /** 缺失的必需注入服务（等待服务注册后自动激活） */
  missing: string[];
  createdAt: number;
  /** 挂起是否已超时（死锁防护，需手动重试或检查依赖） */
  timedOut: boolean;
  /** 挂起状态（经状态机映射，恒为 pending） */
  state: string;
}

export interface PluginMarketplaceSearchResult {
  plugins: MarketplacePlugin[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

class PluginMarketplaceService {
  async search(params: {
    query?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PluginMarketplaceSearchResult> {
    const queryParams: Record<string, unknown> = {};
    if (params.query) queryParams.query = params.query;
    if (params.page) queryParams.page = params.page;
    if (params.pageSize) queryParams.pageSize = params.pageSize;
    return http.get<PluginMarketplaceSearchResult>(
      "/v1/plugins/marketplace/search",
      { params: queryParams },
    );
  }

  async getCategories(): Promise<Array<{ name: string; count: number }>> {
    return http.get<Array<{ name: string; count: number }>>(
      "/v1/plugins/marketplace/categories",
    );
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    return http.get<InstalledPlugin[]>("/v1/plugins/marketplace/installed");
  }

  /** 获取响应式挂起的插件列表（inject 必需服务缺失等待中，4.4） */
  async getPendingPlugins(): Promise<PendingPlugin[]> {
    return http.get<PendingPlugin[]>("/v1/plugins/marketplace/pending");
  }

  async getPluginDetail(pluginId: string): Promise<{
    plugin: MarketplacePlugin | null;
    versions: Array<{ version: string; publishedAt: string }>;
  }> {
    return http.get<{
      plugin: MarketplacePlugin | null;
      versions: Array<{ version: string; publishedAt: string }>;
    }>(`/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}`);
  }

  async install(pluginId: string): Promise<{
    success: boolean;
    name: string;
    version?: string;
    loaded?: boolean;
  }> {
    return http.post<{
      success: boolean;
      name: string;
      version?: string;
      loaded?: boolean;
    }>(
      `/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}/install`,
    );
  }

  async uninstall(pluginId: string): Promise<{
    success: boolean;
    name: string;
  }> {
    return http.post<{ success: boolean; name: string }>(
      `/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}/uninstall`,
    );
  }
}

export const pluginMarketplaceService = new PluginMarketplaceService();
