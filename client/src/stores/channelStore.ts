import { create } from "zustand";
import type { Channel, UpdateChannelRequest } from "../types";
import { channelService } from "../services/channelService";

// ─── 筛选类型 ──────────────────────────────────────────

type StatusFilter =
  | "all"
  | "connected"
  | "disconnected"
  | "enabled"
  | "disabled";

interface ChannelFilters {
  search: string;
  status: StatusFilter;
  type: string;
}

// ─── 统计类型 ──────────────────────────────────────────

interface ChannelStats {
  total: number;
  connected: number;
  enabled: number;
  disabled: number;
}

// ─── Store 接口 ────────────────────────────────────────

interface ChannelStore {
  /** 渠道列表 */
  channels: Channel[];
  /** 加载状态 */
  isLoading: boolean;
  /** 刷新状态（区别于首次加载） */
  isRefreshing: boolean;
  /** 保存状态 */
  isSaving: boolean;
  /** 应用配置状态 */
  isApplying: boolean;
  /** 错误信息 */
  error: string | null;
  /** 筛选条件 */
  filters: ChannelFilters;
  /** 当前编辑的渠道 */
  editingChannel: Channel | null;
  /** 编辑模态框是否显示 */
  showFormModal: boolean;
  /** 删除确认目标 ID */
  confirmDeleteId: string | null;
  /** 已安装插件名称列表 */
  installedPlugins: string[];
  /** 插件安装中 */
  isInstallingPlugin: boolean;
  /** 微信 weixin-cli 状态 */
  wechatCliStatus: {
    state: string;
    running: boolean;
    qrBase64: string | null;
    qrRaw: string | null;
    lastError: string | null;
    uptimeSec: number | null;
  } | null;

  /** 加载渠道列表 */
  loadChannels: () => Promise<void>;
  /** 刷新渠道列表（不显示骨架屏） */
  refreshChannels: () => Promise<void>;
  /** 启用/禁用渠道 */
  toggleChannel: (id: string, enabled: boolean) => Promise<void>;
  /** 删除渠道 */
  deleteChannel: (id: string) => Promise<void>;
  /** 更新筛选条件 */
  setFilters: (partial: Partial<ChannelFilters>) => void;
  /** 清除错误 */
  clearError: () => void;

  /** 打开编辑模态框 */
  openEditModal: (channel: Channel) => void;
  /** 关闭编辑模态框 */
  closeFormModal: () => void;
  /** 保存渠道配置 */
  saveChannel: (data: UpdateChannelRequest) => Promise<void>;
  /** 保存并应用渠道配置 */
  saveAndApplyChannel: (data: UpdateChannelRequest) => Promise<void>;
  /** 打开删除确认 */
  promptDelete: (id: string) => void;
  /** 取消删除确认 */
  cancelDelete: () => void;

  /** 刷新插件列表 */
  refreshPlugins: () => Promise<void>;
  /** 判断渠道插件是否已安装 */
  isChannelPluginInstalled: (channelType: string) => boolean;
  /** 安装渠道插件 */
  installChannelPlugin: (channelType: string) => Promise<void>;
  /** 获取微信 weixin-cli 状态 */
  fetchWechatCliStatus: () => Promise<void>;

  /** 筛选后的渠道列表 */
  getFilteredChannels: () => Channel[];
  /** 统计数据 */
  getStats: () => ChannelStats;
}

// ─── 筛选逻辑 ──────────────────────────────────────────

function filterChannels(
  channels: Channel[],
  filters: ChannelFilters,
): Channel[] {
  return channels.filter((ch) => {
    // 关键词过滤
    if (filters.search) {
      const kw = filters.search.toLowerCase();
      if (
        !ch.name.toLowerCase().includes(kw) &&
        !ch.type.toLowerCase().includes(kw)
      ) {
        return false;
      }
    }

    // 类型过滤
    if (filters.type && ch.type !== filters.type) {
      return false;
    }

    // 状态过滤
    switch (filters.status) {
      case "connected":
        return ch.connected;
      case "disconnected":
        return !ch.connected;
      case "enabled":
        return ch.enabled;
      case "disabled":
        return !ch.enabled;
      default:
        return true;
    }
  });
}

// ─── 统计计算 ──────────────────────────────────────────

function computeStats(channels: Channel[]): ChannelStats {
  return {
    total: channels.length,
    connected: channels.filter((c) => c.connected).length,
    enabled: channels.filter((c) => c.enabled).length,
    disabled: channels.filter((c) => !c.enabled).length,
  };
}

// ─── Store 实现 ────────────────────────────────────────

export const useChannelStore = create<ChannelStore>((set, get) => ({
  channels: [],
  isLoading: false,
  isRefreshing: false,
  isSaving: false,
  isApplying: false,
  error: null,
  filters: {
    search: "",
    status: "all",
    type: "",
  },
  editingChannel: null,
  showFormModal: false,
  confirmDeleteId: null,
  installedPlugins: [],
  isInstallingPlugin: false,
  wechatCliStatus: null,

  // ── 数据加载 ──

  loadChannels: async () => {
    set({ isLoading: true, error: null });
    try {
      const channels = await channelService.list();
      set({ channels, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  refreshChannels: async () => {
    set({ isRefreshing: true, error: null });
    try {
      const channels = await channelService.list();
      set({ channels, isRefreshing: false });
    } catch (e) {
      set({ error: String(e), isRefreshing: false });
    }
  },

  // ── 渠道操作 ──

  toggleChannel: async (id, enabled) => {
    try {
      await channelService.toggle(id, enabled);
      set({
        channels: get().channels.map((c) =>
          c.id === id ? { ...c, enabled } : c,
        ),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteChannel: async (id) => {
    try {
      await channelService.delete(id);
      set({
        channels: get().channels.filter((c) => c.id !== id),
        confirmDeleteId: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── 编辑模态框 ──

  openEditModal: (channel) => {
    set({ editingChannel: channel, showFormModal: true });
  },

  closeFormModal: () => {
    set({ editingChannel: null, showFormModal: false });
  },

  // ── 保存逻辑 ──

  saveChannel: async (data) => {
    const { editingChannel } = get();
    if (!editingChannel) return;
    set({ isSaving: true, error: null });
    try {
      const updated = await channelService.update(editingChannel.id, data);
      set((s) => ({
        channels: s.channels.map((c) => (c.id === updated.id ? updated : c)),
        showFormModal: false,
        editingChannel: null,
      }));
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isSaving: false });
    }
  },

  saveAndApplyChannel: async (data) => {
    const { editingChannel } = get();
    if (!editingChannel) return;
    set({ isSaving: true, error: null });
    try {
      // 先保存
      const updated = await channelService.update(editingChannel.id, data);
      set((s) => ({
        channels: s.channels.map((c) => (c.id === updated.id ? updated : c)),
      }));
      // 再应用
      set({ isApplying: true, isSaving: false });
      try {
        await channelService.applyConfig();
      } catch {
        // apply 可能触发连接重置，忽略连接错误
      }
      // 等待 Gateway 重连后刷新
      await new Promise((r) => setTimeout(r, 2000));
      await get().refreshChannels();
      set({ showFormModal: false, editingChannel: null });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isSaving: false, isApplying: false });
    }
  },

  // ── 删除确认 ──

  promptDelete: (id) => {
    set({ confirmDeleteId: id });
  },

  cancelDelete: () => {
    set({ confirmDeleteId: null });
  },

  // ── 插件管理 ──

  refreshPlugins: async () => {
    try {
      const plugins = await channelService.listPlugins();
      set({
        installedPlugins: plugins.filter((p) => p.installed).map((p) => p.name),
      });
    } catch {
      // 后端可能不支持，静默失败
    }
  },

  isChannelPluginInstalled: (channelType) => {
    /** 渠道→插件包名映射 */
    /** 需要外部 npm 插件包的渠道映射（其余渠道使用 Node.js 内置 API） */
    const CHANNEL_PLUGIN_MAP: Record<string, string[]> = {
      wechat: ["@tencent-weixin/openclaw-weixin-cli"],
    };

    const required = CHANNEL_PLUGIN_MAP[channelType];
    if (!required) return true; // 无需插件的渠道默认视为已安装
    const installedSet = new Set(get().installedPlugins);
    return required.some((pkg) => installedSet.has(pkg));
  },

  installChannelPlugin: async (channelType) => {
    /** 需要外部 npm 插件包的渠道映射（其余渠道使用 Node.js 内置 API） */
    const CHANNEL_PLUGIN_MAP: Record<string, string[]> = {
      wechat: ["@tencent-weixin/openclaw-weixin-cli"],
    };

    const packages = CHANNEL_PLUGIN_MAP[channelType];
    if (!packages || packages.length === 0) return;

    set({ isInstallingPlugin: true, error: null });
    try {
      // 依次尝试安装，首个成功即停止
      let lastError: string | undefined;
      for (const pkg of packages) {
        try {
          const result = await channelService.installPlugin(pkg);
          if (result.success) {
            // 刷新插件列表
            await get().refreshPlugins();
            return;
          }
          lastError = result.name || pkg;
        } catch {
          // 继续尝试下一个
        }
      }
      set({
        error: lastError
          ? `插件安装失败: ${lastError}，请手动执行 npm install`
          : "插件安装失败，请手动执行 npm install",
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isInstallingPlugin: false });
    }
  },

  // ── 微信 weixin-cli 状态 ──

  fetchWechatCliStatus: async () => {
    try {
      const result = await channelService.getWechatCliStatus();
      if (result.success) {
        set({ wechatCliStatus: result.data });
      }
    } catch {
      // 服务可能暂未支持，静默失败
    }
  },

  // ── 筛选与工具 ──

  setFilters: (partial) => {
    set({ filters: { ...get().filters, ...partial } });
  },

  clearError: () => {
    set({ error: null });
  },

  getFilteredChannels: () => {
    return filterChannels(get().channels, get().filters);
  },

  getStats: () => {
    return computeStats(get().channels);
  },
}));
