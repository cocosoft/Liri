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
