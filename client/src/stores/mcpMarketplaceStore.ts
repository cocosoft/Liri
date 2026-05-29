import { create } from 'zustand';
import {
  mcpMarketplaceService,
  type SearchResult,
  type InstalledMCPServer,
  type ServerDetail,
  type MCPCategory,
} from '../services/mcpMarketplaceService';

interface MCPMarketplaceStore {
  searchResults: SearchResult[];
  installedServers: InstalledMCPServer[];
  categories: MCPCategory[];
  selectedServerDetail: ServerDetail | null;
  searchQuery: string;
  categoryFilter: string;
  isLoading: boolean;
  installing: string | null;
  error: string | null;

  search: (query: string, category?: string) => Promise<void>;
  getInstalled: () => Promise<void>;
  getCategories: () => Promise<void>;
  getServerDetail: (serverId: string) => Promise<void>;
  install: (serverId: string) => Promise<void>;
  uninstall: (serverId: string) => Promise<void>;
  toggleServer: (serverId: string, enabled: boolean) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (category: string) => void;
  clearDetail: () => void;
  clearError: () => void;
}

export const useMCPMarketplaceStore = create<MCPMarketplaceStore>((set, get) => ({
  searchResults: [],
  installedServers: [],
  categories: [],
  selectedServerDetail: null,
  searchQuery: '',
  categoryFilter: '',
  isLoading: false,
  installing: null,
  error: null,

  search: async (query, category) => {
    set({ isLoading: true, error: null });
    try {
      const results = await mcpMarketplaceService.search({ query, category });
      set({ searchResults: results });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '搜索失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  getInstalled: async () => {
    try {
      const servers = await mcpMarketplaceService.getInstalledServers();
      set({ installedServers: servers });
    } catch {
      // 静默失败，保留上次数据
    }
  },

  getCategories: async () => {
    try {
      const categories = await mcpMarketplaceService.getCategories();
      set({ categories });
    } catch {
      // 静默失败
    }
  },

  getServerDetail: async (serverId) => {
    set({ isLoading: true, error: null });
    try {
      const detail = await mcpMarketplaceService.getServerDetail(serverId);
      set({ selectedServerDetail: detail });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取详情失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  install: async (serverId) => {
    set({ installing: serverId, error: null });
    try {
      await mcpMarketplaceService.install(serverId);
      await get().getInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '安装失败' });
    } finally {
      set({ installing: null });
    }
  },

  uninstall: async (serverId) => {
    set({ installing: serverId, error: null });
    try {
      await mcpMarketplaceService.uninstall(serverId);
      await get().getInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '卸载失败' });
    } finally {
      set({ installing: null });
    }
  },

  toggleServer: async (serverId, enabled) => {
    set({ error: null });
    try {
      await mcpMarketplaceService.toggleServer(serverId, enabled);
      await get().getInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '切换状态失败' });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setCategoryFilter: (category) => set({ categoryFilter: category }),
  clearDetail: () => set({ selectedServerDetail: null }),
  clearError: () => set({ error: null }),
}));
