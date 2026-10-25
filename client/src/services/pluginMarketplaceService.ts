import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";

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

/**
 * 插件能力状态（T25-08 P2，`GET/PUT /v1/plugins/marketplace/plugins/{id}/capabilities`）。
 *
 * `declared` 来自清单；`granted` 是**展示视角**（env 与 UI 写入的文件取并集）；
 * `available` 才是可以勾选的集合（未实现的能力在 `unimplemented` 里，不可勾选）。
 */
export interface PluginCapabilityState {
  pluginId: string;
  declared: string[];
  granted: string[];
  missing: string[];
  unimplemented: string[];
  available: string[];
  enforced: boolean;
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
      ENDPOINTS.plugins.marketplaceSearch,
      { params: queryParams },
    );
  }

  async getCategories(): Promise<Array<{ name: string; count: number }>> {
    return http.get<Array<{ name: string; count: number }>>(
      ENDPOINTS.plugins.marketplaceCategories,
    );
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    return http.get<InstalledPlugin[]>(ENDPOINTS.plugins.marketplaceInstalled);
  }

  /** 获取响应式挂起的插件列表（inject 必需服务缺失等待中，4.4） */
  async getPendingPlugins(): Promise<PendingPlugin[]> {
    return http.get<PendingPlugin[]>(ENDPOINTS.plugins.marketplacePending);
  }

  async getPluginDetail(pluginId: string): Promise<{
    plugin: MarketplacePlugin | null;
    versions: Array<{ version: string; publishedAt: string }>;
  }> {
    return http.get<{
      plugin: MarketplacePlugin | null;
      versions: Array<{ version: string; publishedAt: string }>;
    }>(ENDPOINTS.plugins.marketplacePlugin(pluginId));
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
    }>(ENDPOINTS.plugins.marketplacePluginInstall(pluginId));
  }

  async uninstall(pluginId: string): Promise<{
    success: boolean;
    name: string;
  }> {
    return http.post<{ success: boolean; name: string }>(
      ENDPOINTS.plugins.marketplacePluginUninstall(pluginId),
    );
  }

  /** T25-08 P2：能力状态（声明 / 已授权 / 未实现 / 可授权） */
  async getCapabilities(pluginId: string): Promise<PluginCapabilityState> {
    return http.get<PluginCapabilityState>(
      ENDPOINTS.plugins.marketplacePluginCapabilities(pluginId),
    );
  }

  /** T25-08 P2：覆盖该插件的授权集合（空数组 = 收回全部） */
  async setCapabilities(
    pluginId: string,
    granted: string[],
  ): Promise<PluginCapabilityState> {
    return http.put<PluginCapabilityState>(
      ENDPOINTS.plugins.marketplacePluginCapabilities(pluginId),
      { granted },
    );
  }
}

export const pluginMarketplaceService = new PluginMarketplaceService();
