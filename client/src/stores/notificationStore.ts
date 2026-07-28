/**
 * Notification Store — Zustand
 *
 * 管理通知列表、未读计数、SSE 事件处理。
 */

import { create } from "zustand";
import { notificationService } from "../services/notificationService";
import { handleClientError } from "@/utils/handleError";
import { useConfigStore } from "./configStore";
import type {
  NotificationItem,
  NotificationCountResult,
  NotificationCategory,
  NotificationListParams,
  NotificationStatus,
} from "../types/notification";

/** 从 configStore 读取通知偏好 */
function getPrefs() {
  const raw = (useConfigStore.getState().config.notifications ?? {}) as Record<
    string,
    unknown
  >;
  return {
    dndEnabled: (raw.dndEnabled as boolean) ?? false,
    dndStartHour: (raw.dndStartHour as number) ?? 22,
    dndEndHour: (raw.dndEndHour as number) ?? 8,
    categoryBadges: (raw.categoryBadges as Record<string, boolean>) ?? {
      approval: true,
      todo: true,
      system: true,
      mention: true,
    },
    desktopNotifyMinUnread: (raw.desktopNotifyMinUnread as number) ?? 1,
  };
}

/** 是否在免打扰时段内 */
function isDnd(): boolean {
  const { dndEnabled, dndStartHour, dndEndHour } = getPrefs();
  if (!dndEnabled) return false;
  const hour = new Date().getHours();
  if (dndStartHour <= dndEndHour) {
    return hour >= dndStartHour && hour < dndEndHour;
  }
  // 跨日（如 22:00 - 08:00）
  return hour >= dndStartHour || hour < dndEndHour;
}

/** 按分类角标设置过滤未读数 */
function filterCounts(raw: NotificationCountResult): NotificationCountResult {
  const { categoryBadges } = getPrefs();
  const result = {
    approval: categoryBadges.approval ? raw.approval : 0,
    todo: categoryBadges.todo ? raw.todo : 0,
    system: categoryBadges.system ? raw.system : 0,
    notice: raw.notice,
    mention: categoryBadges.mention ? raw.mention : 0,
  };
  return {
    ...result,
    total:
      result.approval +
      result.todo +
      result.system +
      result.notice +
      result.mention,
  };
}

/** 计算开启角标的分类实际未读总数 */
function filteredTotal(raw: NotificationCountResult): number {
  const f = filterCounts(raw);
  return f.approval + f.todo + f.system + f.notice + f.mention;
}

/** 桌面通知（如果条件满足） */
function maybeShowDesktopNotification(item: NotificationItem): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (isDnd()) return;

  // 按分类角标过滤
  const { categoryBadges } = getPrefs();
  if (
    item.category !== "notice" &&
    !categoryBadges[item.category as keyof typeof categoryBadges]
  )
    return;

  // 阈值检查
  const { desktopNotifyMinUnread } = getPrefs();
  if (desktopNotifyMinUnread > 0) {
    const { counts } = useNotificationStore.getState();
    if (filteredTotal(counts) < desktopNotifyMinUnread) return;
  }

  try {
    new Notification(item.title, {
      body: item.content || undefined,
      tag: item.id,
    });
  } catch {
    /* 桌面通知失败静默 */
  }
}

interface NotificationStore {
  /** 当前 Tab 分类 */
  activeCategory: NotificationCategory | "all";
  /** 通知列表（去重 Map 的数组形式） */
  items: NotificationItem[];
  /** 各分类未读数 */
  counts: NotificationCountResult;
  /** 加载状态 */
  isLoading: boolean;
  /** 是否有更多 */
  hasMore: boolean;
  /** 游标 */
  nextCursor: number | null;
  /** 面板是否打开 */
  panelOpen: boolean;
  /** 全部已读进行中 */
  readingAll: boolean;

  setActiveCategory: (cat: NotificationCategory | "all") => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  loadItems: (reset?: boolean) => Promise<void>;
  loadCounts: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  readAll: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  performAction: (
    id: string,
    action: string,
    actionToken?: string,
  ) => Promise<boolean>;
  deleteNotification: (id: string) => Promise<void>;

  /** SSE 事件处理 */
  handleSseNew: (item: NotificationItem) => void;
  handleSseUpdate: (data: {
    id: string;
    status: string;
    updated_at: number;
  }) => void;
  handleSseDelete: (data: { id: string }) => void;
  handleSseCount: (counts: NotificationCountResult) => void;
}

/** 去重：同一 id 下保留 updated_at 更新的版本 */
function mergeItems(
  existing: NotificationItem[],
  incoming: NotificationItem[],
): NotificationItem[] {
  const map = new Map<string, NotificationItem>();
  for (const item of existing) map.set(item.id, item);
  for (const item of incoming) {
    const prev = map.get(item.id);
    if (!prev || item.updated_at >= prev.updated_at) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.created_at - a.created_at);
}

export const useNotificationStore = create<NotificationStore>()((set, get) => ({
  activeCategory: "all",
  items: [],
  counts: { total: 0, approval: 0, todo: 0, system: 0, notice: 0, mention: 0 },
  isLoading: false,
  hasMore: false,
  nextCursor: null,
  panelOpen: false,
  readingAll: false,

  setActiveCategory: (cat) => {
    set({ activeCategory: cat, items: [], nextCursor: null, hasMore: false });
    get().loadItems(true);
  },

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openPanel: () => {
    set({ panelOpen: true });
    get().loadCounts();
    get().loadItems(true);
  },
  closePanel: () => set({ panelOpen: false }),

  loadItems: async (reset = false) => {
    const { activeCategory, isLoading, hasMore, nextCursor } = get();
    if (isLoading) return;
    if (!reset && !hasMore) return;

    set({ isLoading: true });
    try {
      const params: NotificationListParams = { limit: 20 };
      if (activeCategory !== "all") params.category = activeCategory;
      if (!reset && nextCursor) params.cursor = nextCursor;

      const result = await notificationService.list(params);

      set((s) => ({
        items: reset ? result.items : mergeItems(s.items, result.items),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      }));
    } catch (e) {
      handleClientError(e, {
        module: "stores:notification",
        action: "loadItems",
      });
    } finally {
      set({ isLoading: false });
    }
  },

  loadCounts: async () => {
    try {
      const counts = await notificationService.unreadCount();
      set({ counts: filterCounts(counts) });
    } catch (e) {
      handleClientError(e, {
        module: "stores:notification",
        action: "loadCounts",
      });
    }
  },

  markRead: async (id: string) => {
    try {
      await notificationService.markRead(id);
      set((s) => ({
        items: s.items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "read" as const,
                read_at: Math.floor(Date.now() / 1000),
              }
            : item,
        ),
      }));
      get().loadCounts();
    } catch (e) {
      handleClientError(e, {
        module: "stores:notification",
        action: "markRead",
      });
    }
  },

  readAll: async () => {
    const { activeCategory } = get();
    set({ readingAll: true });
    try {
      await notificationService.readAll(
        activeCategory !== "all" ? activeCategory : undefined,
      );
      set((s) => ({
        items: s.items.map((item) => ({ ...item, status: "read" as const })),
      }));
      get().loadCounts();
    } catch (e) {
      handleClientError(e, {
        module: "stores:notification",
        action: "readAll",
      });
    } finally {
      set({ readingAll: false });
    }
  },

  dismiss: async (id: string) => {
    try {
      await notificationService.dismiss(id);
      set((s) => ({
        items: s.items.filter((item) => item.id !== id),
      }));
      get().loadCounts();
    } catch (e) {
      handleClientError(e, {
        module: "stores:notification",
        action: "dismiss",
      });
    }
  },

  performAction: async (id: string, action: string, actionToken?: string) => {
    try {
      const result = await notificationService.performAction(
        id,
        action,
        actionToken,
      );
      if (result.success) {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "resolved" as const,
                  resolved_at: Math.floor(Date.now() / 1000),
                }
              : item,
          ),
        }));
        get().loadCounts();
      }
      return result.success;
    } catch (e) {
      handleClientError(e, {
        module: "stores:notification",
        action: "performAction",
      });
      return false;
    }
  },

  deleteNotification: async (id: string) => {
    try {
      await notificationService.delete(id);
      set((s) => ({
        items: s.items.filter((item) => item.id !== id),
      }));
      get().loadCounts();
    } catch (e) {
      handleClientError(e, { module: "stores:notification", action: "delete" });
    }
  },

  // ─── SSE 事件处理 ─────────────────────────

  handleSseNew: (item) => {
    set((s) => {
      const existing = s.items.find((i) => i.id === item.id);
      if (existing && existing.updated_at >= item.updated_at) return s;
      const newItems = existing
        ? s.items.map((i) => (i.id === item.id ? item : i))
        : [item, ...s.items];
      return { items: newItems };
    });
    get()
      .loadCounts()
      .catch(() => {
        /* 静默失败：计数刷新非关键路径 */
      });
    // 桌面通知
    maybeShowDesktopNotification(item);
  },

  handleSseUpdate: (data) => {
    set((s) => ({
      items: s.items.map((item) =>
        item.id === data.id
          ? {
              ...item,
              status: data.status as NotificationStatus,
              updated_at: data.updated_at,
            }
          : item,
      ),
    }));
    get().loadCounts();
  },

  handleSseDelete: (data) => {
    set((s) => ({
      items: s.items.filter((item) => item.id !== data.id),
    }));
    get().loadCounts();
  },

  handleSseCount: (counts) => {
    set({ counts: filterCounts(counts) });
  },
}));
