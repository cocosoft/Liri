import { create } from "zustand";
import {
  mcpMarketplaceService,
  type SearchResult,
  type InstalledMCPServer,
  type ServerDetail,
  type ThirdPartyRegistry,
} from "../services/mcpMarketplaceService";

// ─── 工具条目类型 ─────────────────────────────────────

interface MCPToolEntry {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
}

// ─── 筛选类型 ──────────────────────────────────────────

type RegistryFilter = "all" | "official" | "third_party";

interface MCPFilters {
  search: string;
  registry: RegistryFilter;
  sourceRegistry: string;
}

// ─── 统计类型 ──────────────────────────────────────────

interface MCPStats {
  total: number;
  enabled: number;
  disabled: number;
  connected: number;
}

// ─── Store 接口 ────────────────────────────────────────

interface MCPStore {
  /** 市场搜索结果 */
  searchResults: SearchResult[];
  /** 已安装服务器列表 */
  installedServers: InstalledMCPServer[];
  /** 筛选条件 */
  filters: MCPFilters;
  /** 加载状态 */
  isLoading: boolean;
  /** 操作中的服务器 ID */
  operatingId: string | null;
  /** 错误信息 */
  error: string | null;
  /** 当前选中的服务器详情 */
  selectedServerDetail: ServerDetail | null;
  /** 详情弹窗是否显示 */
  showDetail: boolean;
  /** 卸载确认目标 */
  confirmUninstallId: string | null;
  /** 配置弹窗目标（null=添加模式，server=编辑模式） */
  configModalTarget: InstalledMCPServer | null;
  /** 配置弹窗是否显示 */
  showConfigModal: boolean;
  /** 批量选择的服务器的 name 集合 */
  selectedServerNames: Set<string>;
  /** 批量操作状态 */
  batchOperating: boolean;
  /** 验证过程中的服务器名 */
  verifyingServer: string | null;
  /** 所有工具列表 */
  allTools: MCPToolEntry[];
  /** 工具加载状态 */
  toolsLoading: boolean;
  /** 工具搜索文本 */
  toolSearch: string;

  /** 搜索市场 */
  searchMarket: (query?: string, registry?: RegistryFilter) => Promise<void>;
  /** 加载可用注册表源列表 */
  loadRegistries: () => Promise<void>;
  /** 设置当前注册表源筛选 */
  setSourceRegistry: (source: string) => void;
  /** 可用注册表源列表 */
  availableRegistries: Array<{
    id: string;
    name: string;
    sourceRegistry: string;
  }>;
  /** 加载已安装列表 */
  loadInstalled: () => Promise<void>;
  /** 安装服务器 */
  install: (serverId: string) => Promise<void>;
  /** 卸载服务器 */
  uninstall: (serverId: string) => Promise<void>;
  /** 开启/禁用服务器 */
  toggleServer: (serverId: string, enabled: boolean) => Promise<void>;
  /** 验证服务器连接 */
  verifyServer: (serverId: string) => Promise<void>;
  /** 获取服务器详情 */
  getServerDetail: (serverId: string) => Promise<void>;
  /** 更新筛选条件 */
  setFilters: (partial: Partial<MCPFilters>) => void;
  /** 清除错误 */
  clearError: () => void;

  /** 关闭详情弹窗 */
  closeDetail: () => void;
  /** 打开卸载确认 */
  promptUninstall: (serverId: string) => void;
  /** 取消卸载确认 */
  cancelUninstall: () => void;

  /** 打开配置弹窗（编辑模式） */
  openConfigModal: (target: InstalledMCPServer | null) => void;
  /** 关闭配置弹窗 */
  closeConfigModal: () => void;

  /** 切换单个选中 */
  toggleSelected: (name: string) => void;
  /** 全选/取消全选 */
  toggleSelectAll: () => void;
  /** 清除选中 */
  clearSelection: () => void;
  /** 批量启用 */
  batchEnable: () => Promise<void>;
  /** 批量禁用 */
  batchDisable: () => Promise<void>;
  /** 批量卸载 */
  batchUninstall: () => Promise<void>;

  /** 加载全局工具列表 */
  loadAllTools: () => Promise<void>;
  /** 切换工具启用/禁用 */
  toggleTool: (
    toolName: string,
    serverName: string,
    enabled: boolean,
  ) => Promise<void>;
  /** 设置工具搜索文本 */
  setToolSearch: (search: string) => void;

  /** 判断服务器是否已安装 */
  isInstalled: (name: string) => boolean;
  /** 获取服务器启用状态 */
  isEnabled: (name: string) => boolean;
  /** 统计数据 */
  getStats: () => MCPStats;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
}

// ─── 统计计算 ──────────────────────────────────────────

function computeStats(servers: InstalledMCPServer[]): MCPStats {
  return {
    total: servers.length,
    enabled: servers.filter((s) => s.enabled).length,
    disabled: servers.filter((s) => !s.enabled).length,
    connected: servers.filter((s) => s.connected).length,
  };
}

// ─── Store 实现 ────────────────────────────────────────

export const useMCPStore = create<MCPStore>((set, get) => ({
  searchResults: [],
  installedServers: [],
  filters: {
    search: "",
    registry: "all",
    sourceRegistry: "",
  },
  isLoading: false,
  operatingId: null,
  error: null,
  selectedServerDetail: null,
  showDetail: false,
  confirmUninstallId: null,
  configModalTarget: null,
  showConfigModal: false,
  selectedServerNames: new Set<string>(),
  availableRegistries: [],
  batchOperating: false,
  verifyingServer: null,
  allTools: [],
  toolsLoading: false,
  toolSearch: "",
  page: 1,
  pageSize: 10,

  // ── 搜索 ──

  searchMarket: async (query, registry) => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const registryParam =
        registry === "official"
          ? "official"
          : registry === "third_party"
            ? "third_party"
            : undefined;
      const sourceReg =
        (filters.sourceRegistry as ThirdPartyRegistry | undefined) || undefined;
      const results = await mcpMarketplaceService.search({
        query: query || undefined,
        registry: registryParam,
        sourceRegistry: sourceReg || undefined,
      });
      set({ searchResults: results, page: 1 });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "搜索失败",
        searchResults: [],
        page: 1,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  // ── 已安装服务器 ──

  loadInstalled: async () => {
    try {
      const servers = await mcpMarketplaceService.getInstalledServers();
      set({ installedServers: servers });
    } catch {
      // 静默失败
    }
  },

  // ── 安装 ──

  install: async (serverId) => {
    set({ operatingId: serverId, error: null });
    try {
      await mcpMarketplaceService.install(serverId);
      await get().loadInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "安装失败" });
    } finally {
      set({ operatingId: null });
    }
  },

  // ── 卸载 ──

  uninstall: async (serverId) => {
    set({ operatingId: serverId, error: null });
    try {
      await mcpMarketplaceService.uninstall(serverId);
      set((s) => ({
        installedServers: s.installedServers.filter(
          (srv) => srv.name !== serverId,
        ),
        confirmUninstallId: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "卸载失败" });
    } finally {
      set({ operatingId: null });
    }
  },

  // ── 启用/禁用 ──

  toggleServer: async (serverId, enabled) => {
    // 乐观更新：先改 UI，后台同步，失败回滚
    const prev = get().installedServers.find((s) => s.name === serverId);
    set((s) => ({
      error: null,
      installedServers: s.installedServers.map((srv) =>
        srv.name === serverId ? { ...srv, enabled } : srv,
      ),
    }));
    try {
      await mcpMarketplaceService.toggleServer(serverId, enabled);
    } catch (e) {
      // 回滚
      if (prev) {
        set((s) => ({
          installedServers: s.installedServers.map((srv) =>
            srv.name === serverId ? prev : srv,
          ),
        }));
      }
      set({ error: e instanceof Error ? e.message : "切换状态失败" });
    }
  },

  // ── 详情 ──

  getServerDetail: async (serverId) => {
    set({ isLoading: true, error: null });
    try {
      const detail = await mcpMarketplaceService.getServerDetail(serverId);
      if (detail) {
        set({ selectedServerDetail: detail, showDetail: true });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取详情失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  // ── 筛选 ──

  setFilters: (partial) => {
    set({ filters: { ...get().filters, ...partial } });
  },

  clearError: () => {
    set({ error: null });
  },

  // ── 注册表源 ──

  loadRegistries: async () => {
    try {
      const registries = await mcpMarketplaceService.getRegistries();
      set({ availableRegistries: registries });
    } catch {
      // 静默失败
    }
  },

  setSourceRegistry: (source) => {
    set({ filters: { ...get().filters, sourceRegistry: source } });
  },

  // ── 弹窗控制 ──

  closeDetail: () => {
    set({ selectedServerDetail: null, showDetail: false });
  },

  promptUninstall: (serverId) => {
    set({ confirmUninstallId: serverId });
  },

  cancelUninstall: () => {
    set({ confirmUninstallId: null });
  },

  // ── 配置弹窗 ──

  openConfigModal: (target) => {
    set({ configModalTarget: target, showConfigModal: true });
  },

  closeConfigModal: () => {
    set({ configModalTarget: null, showConfigModal: false });
  },

  // ── 批量选择 ──

  toggleSelected: (name) => {
    set((s) => {
      const next = new Set(s.selectedServerNames);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return { selectedServerNames: next };
    });
  },

  toggleSelectAll: () => {
    set((s) => {
      const all = s.installedServers.map((srv) => srv.name);
      const allSelected = all.every((n) => s.selectedServerNames.has(n));
      return {
        selectedServerNames: allSelected ? new Set<string>() : new Set(all),
      };
    });
  },

  clearSelection: () => {
    set({ selectedServerNames: new Set<string>() });
  },

  batchEnable: async () => {
    const { selectedServerNames, installedServers } = get();
    if (selectedServerNames.size === 0) return;

    set({ batchOperating: true, error: null });
    try {
      const names = Array.from(selectedServerNames);
      for (const name of names) {
        const srv = installedServers.find((s) => s.name === name);
        if (srv && !srv.enabled) {
          await mcpMarketplaceService.toggleServer(name, true);
        }
      }
      await get().loadInstalled();
      set({ selectedServerNames: new Set<string>() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "批量启用失败" });
    } finally {
      set({ batchOperating: false });
    }
  },

  batchDisable: async () => {
    const { selectedServerNames, installedServers } = get();
    if (selectedServerNames.size === 0) return;

    set({ batchOperating: true, error: null });
    try {
      const names = Array.from(selectedServerNames);
      for (const name of names) {
        const srv = installedServers.find((s) => s.name === name);
        if (srv && srv.enabled) {
          await mcpMarketplaceService.toggleServer(name, false);
        }
      }
      await get().loadInstalled();
      set({ selectedServerNames: new Set<string>() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "批量禁用失败" });
    } finally {
      set({ batchOperating: false });
    }
  },

  batchUninstall: async () => {
    const { selectedServerNames } = get();
    if (selectedServerNames.size === 0) return;

    set({ batchOperating: true, error: null });
    try {
      const names = Array.from(selectedServerNames);
      for (const name of names) {
        await mcpMarketplaceService.uninstall(name);
      }
      set((s) => ({
        installedServers: s.installedServers.filter(
          (srv) => !selectedServerNames.has(srv.name),
        ),
        selectedServerNames: new Set<string>(),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "批量卸载失败" });
    } finally {
      set({ batchOperating: false });
    }
  },

  // ── 验证连接 ──

  verifyServer: async (serverId) => {
    set({ verifyingServer: serverId, error: null });
    try {
      const result = await mcpMarketplaceService.verifyServer(serverId);
      if (!result.connected) {
        set({
          error: `服务器 "${serverId}" 连接失败: ${result.error || result.status}`,
        });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "验证失败" });
    } finally {
      set({ verifyingServer: null });
    }
  },

  // ── 工具管理 ──

  loadAllTools: async () => {
    set({ toolsLoading: true });
    try {
      const result = await mcpMarketplaceService.listTools();
      set({
        allTools: result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          server: t.server,
          inputSchema: t.inputSchema,
          enabled: t.enabled,
        })),
      });
    } catch {
      // 静默失败
    } finally {
      set({ toolsLoading: false });
    }
  },

  toggleTool: async (toolName, serverName, enabled) => {
    try {
      await mcpMarketplaceService.toggleTool(toolName, enabled, serverName);
      set({
        allTools: get().allTools.map((t) =>
          t.server === serverName && t.name === toolName
            ? { ...t, enabled }
            : t,
        ),
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "切换工具状态失败" });
    }
  },

  setToolSearch: (search) => {
    set({ toolSearch: search });
  },

  // ── 工具方法 ──

  isInstalled: (name) => {
    return get().installedServers.some((s) => s.name === name);
  },

  isEnabled: (name) => {
    const server = get().installedServers.find((s) => s.name === name);
    return server ? server.enabled : false;
  },

  getStats: () => {
    return computeStats(get().installedServers);
  },

  setPage: (page) => set({ page }),
}));
