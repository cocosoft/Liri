import { create } from "zustand";
import {
  pluginMarketplaceService,
  type MarketplacePlugin,
  type InstalledPlugin,
} from "../services/pluginMarketplaceService";
import { handleClientError } from "@/utils/handleError";

interface PluginStoreState {
  /** 市场搜索结果 */
  searchResults: MarketplacePlugin[];
  /** 搜索总数 */
  total: number;
  /** 已安装插件 */
  installedPlugins: InstalledPlugin[];
  /** 搜索关键字 */
  query: string;
  /** 加载状态 */
  isLoading: boolean;
  /** 操作中的插件 ID */
  operatingId: string | null;
  /** 错误信息 */
  error: string | null;
  /** 当前详情 */
  selectedPlugin: MarketplacePlugin | null;
  /** 详情弹窗 */
  showDetail: boolean;
  /** 卸载确认 */
  confirmUninstallId: string | null;
  /** 分页 */
  page: number;
  pageSize: number;

  searchMarket: (query?: string) => Promise<void>;
  loadInstalled: () => Promise<void>;
  install: (pluginId: string) => Promise<void>;
  uninstall: (pluginId: string) => Promise<void>;
  getPluginDetail: (pluginId: string) => Promise<void>;
  setQuery: (query: string) => void;
  clearError: () => void;
  closeDetail: () => void;
  promptUninstall: (pluginId: string) => void;
  cancelUninstall: () => void;
  setPage: (page: number) => void;
  isInstalled: (name: string) => boolean;
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  searchResults: [],
  total: 0,
  installedPlugins: [],
  query: "",
  isLoading: false,
  operatingId: null,
  error: null,
  selectedPlugin: null,
  showDetail: false,
  confirmUninstallId: null,
  page: 1,
  pageSize: 20,

  searchMarket: async (query) => {
    const { page, pageSize } = get();
    set({ isLoading: true, error: null });
    try {
      const result = await pluginMarketplaceService.search({
        query,
        page,
        pageSize,
      });
      set({
        searchResults: result.plugins,
        total: result.total,
        isLoading: false,
      });
    } catch (err) {
      handleClientError(err, {
        module: "stores:plugins",
        action: "searchMarket",
      });
      set({ error: String(err), isLoading: false });
    }
  },

  loadInstalled: async () => {
    try {
      const plugins = await pluginMarketplaceService.getInstalledPlugins();
      set({ installedPlugins: plugins });
    } catch (err) {
      handleClientError(err, {
        module: "stores:plugins",
        action: "loadInstalled",
      });
      set({ error: String(err) });
    }
  },

  install: async (pluginId) => {
    set({ operatingId: pluginId, error: null });
    try {
      await pluginMarketplaceService.install(pluginId);
      await get().loadInstalled();
      await get().searchMarket(get().query);
    } catch (err) {
      handleClientError(err, { module: "stores:plugins", action: "install" });
      set({ error: String(err) });
    } finally {
      set({ operatingId: null });
    }
  },

  uninstall: async (pluginId) => {
    set({ operatingId: pluginId, error: null });
    try {
      await pluginMarketplaceService.uninstall(pluginId);
      await get().loadInstalled();
      await get().searchMarket(get().query);
      set({ confirmUninstallId: null });
    } catch (err) {
      handleClientError(err, { module: "stores:plugins", action: "uninstall" });
      set({ error: String(err) });
    } finally {
      set({ operatingId: null });
    }
  },

  getPluginDetail: async (pluginId) => {
    set({ error: null });
    try {
      const detail = await pluginMarketplaceService.getPluginDetail(pluginId);
      set({ selectedPlugin: detail.plugin, showDetail: true });
    } catch (err) {
      handleClientError(err, {
        module: "stores:plugins",
        action: "getPluginDetail",
      });
      set({ error: String(err) });
    }
  },

  setQuery: (query) => set({ query }),
  clearError: () => set({ error: null }),
  closeDetail: () => set({ showDetail: false, selectedPlugin: null }),
  promptUninstall: (pluginId) => set({ confirmUninstallId: pluginId }),
  cancelUninstall: () => set({ confirmUninstallId: null }),
  setPage: (page) => set({ page }, false),

  isInstalled: (name) =>
    get().installedPlugins.some(
      (p) => p.name === name || p.id === name || (p.path || "").includes(name),
    ),
}));
