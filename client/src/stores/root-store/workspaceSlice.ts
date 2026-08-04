/**
 * Workspace Slice — 工作空间统一状态管理 + 旧 workspaceStore 状态
 *
 * 合并环境隔离 + 任务管理 + 会话历史 + UI 布局为一个 Workspace 模型。
 * workspaceStore.ts 作为薄镜像，通过 subscribe 自动同步。
 */

import type { StateCreator } from "zustand";
import type {
  Workspace,
  WorkspaceLayout,
  WorkspaceTransition,
  WorkItem as RootWorkItem,
} from "./types";
import type { RootState } from "./index";
import type { WorkspaceListItem } from "@/services/workspaceService";
import type {
  WorkItem as OldWorkItem,
  WorkItemStatus,
} from "@/stores/workStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store:workspaceSlice");

// ─── 系统工作空间（内置模块，不持久化） ─────────────────

function defaultLayout(): WorkspaceLayout {
  return {
    activeModuleId: null,
    sidebarCollapsed: false,
    sidebarWidth: 280,
    rightPanelOpen: false,
    uiSnapshots: {},
  };
}

function systemWorkspace(
  id: string,
  name: string,
  workspaceType: "chat" | "module",
): Workspace {
  return {
    id,
    name,
    path: "",
    workspaceSource: "system",
    workspaceType,
    modelConfig: { modelId: "", providerId: "" },
    agentId: "",
    knowledgeBaseIds: [],
    workItems: [],
    executionPhase: null,
    sessionIds: [],
    layout: defaultLayout(),
    createdAt: 0,
    updatedAt: 0,
  };
}

export const SYSTEM_WORKSPACES: Record<string, Workspace> = {
  chat: systemWorkspace("chat", "聊天", "chat"),
  media: systemWorkspace("media", "媒体", "module"),
  office: systemWorkspace("office", "办公", "module"),
  calendar: systemWorkspace("calendar", "日历", "module"),
  translation: systemWorkspace("translation", "翻译", "module"),
  knowledge: systemWorkspace("knowledge", "知识库", "module"),
};

// ─── Slice 接口 ────────────────────────────────────────

export interface WorkspaceSlice {
  // ── Workspace 字段 ──
  /** 当前工作空间 ID */
  currentWorkspaceId: string | null;

  /** 所有工作空间 */
  worktrees: Record<string, Workspace>;

  /** 最近使用的工作空间 ID */
  recentWorkspaceIds: string[];

  /** 当前 worktree 切换的状态 */
  transition: WorkspaceTransition | null;

  /** 加载/切换过程中的错误信息 */
  error: string | null;

  /** 是否正在加载 */
  isLoading: boolean;

  // ── 旧 workspaceStore 兼容字段 ──
  /** 工作空间列表（workspaceStore 镜像源） */
  workspaceList: WorkspaceListItem[];

  /** 后端 API 是否就绪 */
  backendReady: boolean;

  // ─── Workspace 动作 ───
  createWorkspace: (config: {
    name: string;
    path: string;
    description?: string;
    workspaceSource?: "system" | "user";
    workspaceType?: "module" | "project" | "chat";
    /** P0b: 使用后端返回的 projectId 作为 worktree ID，统一前后端 */
    id?: string;
  }) => string;
  /** @deprecated 使用 enterModule() 替代模块级操作。此方法仅保留工作空间级联动（gitStore/knowledge）。 */
  switchWorkspace: (id: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  /** 更新工作空间名称或路径 */
  updateWorkspace: (
    id: string,
    updates: { name?: string; path?: string; description?: string },
  ) => void;
  /** S7: 标记项目为已完成 */
  completeWorkspace: (id: string) => void;
  /** S7: 取消项目完成标记 */
  uncompleteWorkspace: (id: string) => void;
  /** P2/S7: 置顶项目 */
  togglePinWorkspace: (id: string) => void;
  updateWorkspaceLayout: (layout: Partial<WorkspaceLayout>) => void;
  bindGitRepo: (workspaceId: string, repoPath: string) => void;
  bindModel: (workspaceId: string, modelId: string, providerId: string) => void;
  bindAgent: (workspaceId: string, agentId: string) => void;
  addKnowledgeBase: (workspaceId: string, kbId: string) => void;
  removeKnowledgeBase: (workspaceId: string, kbId: string) => void;

  // ─── 旧 workspaceStore 兼容动作（异步，调用 workspaceService）───
  /** 获取工作空间列表 */
  listWorkspaces: () => Promise<void>;
  /** 打开工作空间：加载信息 + 工作项列表 */
  openWorkspace: (workspaceId: string) => Promise<void>;
  /** 创建工作项 */
  createWorkItem: (title: string) => Promise<void>;
  /** 更新工作项状态 */
  updateWorkItemStatus: (
    itemId: string,
    status: WorkItemStatus,
  ) => Promise<void>;
  /** 检查后端就绪 */
  checkBackendReady: () => Promise<void>;
  /** 重置状态 */
  resetWorkspace: () => void;
}

// ─── 默认布局 ──────────────────────────────────────────

const DEFAULT_LAYOUT: WorkspaceLayout = {
  activeModuleId: null,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  rightPanelOpen: false,
  uiSnapshots: {},
};

// ─── Slice 实现 ────────────────────────────────────────

export const createWorkspaceSlice: StateCreator<
  RootState,
  [],
  [],
  WorkspaceSlice
> = (set, get) => ({
  // ── 初始状态 ──
  currentWorkspaceId: "chat",
  worktrees: { ...SYSTEM_WORKSPACES },
  recentWorkspaceIds: [],
  transition: null,
  error: null,
  isLoading: false,
  workspaceList: [],
  backendReady: false,

  // ─── Workspace 动作 ──────────────────────────────────

  createWorkspace: (config) => {
    // P0b: 使用后端返回的 projectId，否则自动生成
    const id =
      config.id ?? `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const worktree: Workspace = {
      id,
      name: config.name,
      path: config.path,
      description: config.description,
      workspaceSource: config.workspaceSource ?? "user",
      workspaceType: config.workspaceType ?? "project",
      modelConfig: { modelId: "", providerId: "" },
      agentId: "",
      knowledgeBaseIds: [],
      workItems: [],
      executionPhase: null,
      sessionIds: [],
      layout: { ...DEFAULT_LAYOUT },
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      worktrees: { ...state.worktrees, [id]: worktree },
      recentWorkspaceIds: [id, ...state.recentWorkspaceIds].slice(0, 20),
    }));

    logger.info("工作空间创建", {
      workspaceId: id,
      name: config.name,
      path: config.path,
    });
    return id;
  },

  updateWorkspace: (id, updates) => {
    set((state) => {
      const wt = state.worktrees[id];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [id]: { ...wt, ...updates, updatedAt: Date.now() },
        },
      };
    });
    logger.info("工作空间更新", { workspaceId: id, ...updates });
  },

  completeWorkspace: (id) => {
    set((state) => {
      const wt = state.worktrees[id];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [id]: { ...wt, status: "completed" as const, updatedAt: Date.now() },
        },
      };
    });
    logger.info("项目已标记完成", { workspaceId: id });
  },

  uncompleteWorkspace: (id) => {
    set((state) => {
      const wt = state.worktrees[id];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [id]: { ...wt, status: "active" as const, updatedAt: Date.now() },
        },
      };
    });
    logger.info("项目已取消完成", { workspaceId: id });
  },

  togglePinWorkspace: (id) => {
    set((state) => {
      const wt = state.worktrees[id];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [id]: { ...wt, pinned: !wt.pinned, updatedAt: Date.now() },
        },
      };
    });
    const name = get().worktrees[id]?.name ?? id;
    logger.info(get().worktrees[id]?.pinned ? "项目已置顶" : "取消置顶", {
      workspaceId: id,
      name,
    });
  },

  /** @deprecated 使用 enterModule() 替代模块级操作。此方法仅保留工作空间级联动（gitStore/knowledge）。 */
  switchWorkspace: async (id) => {
    if (import.meta.env.DEV) {
      console.warn(
        "[Deprecated] switchWorkspace() 已标记废弃，模块级操作请用 enterModule()。workspace 级切换仍可用。",
      );
    }
    if (!get().worktrees[id]) {
      set({ error: `工作空间 ${id} 不存在` });
      return;
    }

    set({
      transition: { targetId: id, status: "pending", errors: [] },
      isLoading: true,
      error: null,
    });

    const loadTasks: Promise<{
      source: string;
      ok: boolean;
      error?: string;
    }>[] = [];

    loadTasks.push(
      (async () => {
        try {
          return { source: "session", ok: true };
        } catch (e) {
          return { source: "session", ok: false, error: String(e) };
        }
      })(),
    );

    loadTasks.push(
      (async () => {
        try {
          const wt = get().worktrees[id];
          if (wt?.gitRepo?.path) {
            // gitStore 预留
          }
          return { source: "git", ok: true };
        } catch (e) {
          return { source: "git", ok: false, error: String(e) };
        }
      })(),
    );

    loadTasks.push(
      (async () => {
        try {
          return { source: "knowledge", ok: true };
        } catch (e) {
          return { source: "knowledge", ok: false, error: String(e) };
        }
      })(),
    );

    const results = await Promise.all(loadTasks);
    const errors = results
      .filter((r) => !r.ok)
      .map((r) => ({ source: r.source, error: r.error! }));

    const transitionStatus = errors.length === 0 ? "completed" : "partial";

    set({
      currentWorkspaceId: id,
      recentWorkspaceIds: [
        id,
        ...get().recentWorkspaceIds.filter((rid) => rid !== id),
      ].slice(0, 20),
      transition: {
        targetId: id,
        status: transitionStatus,
        errors,
      },
      isLoading: false,
      error:
        errors.length > 0
          ? `部分资源加载失败: ${errors.map((e) => e.source).join(", ")}`
          : null,
    });

    logger.info("工作空间切换", {
      workspaceId: id,
      status: transitionStatus,
      errors: errors.length,
    });
  },

  deleteWorkspace: async (id) => {
    const wt = get().worktrees[id];
    if (wt?.workspaceSource === "system") {
      logger.warn("禁止删除系统工作空间", { workspaceId: id });
      return;
    }

    // 调用后端 API（失败时仅记录日志，前端状态仍会清理）
    try {
      const { workspaceService } = await import("@/services/workspaceService");
      await workspaceService.deleteWorkspace(id);
    } catch (e) {
      logger.warn("后端删除工作空间失败，继续前端清理", {
        workspaceId: id,
        error: String(e),
      });
    }

    const { [id]: _removed, ...rest } = get().worktrees;

    set((state) => ({
      worktrees: rest,
      recentWorkspaceIds: state.recentWorkspaceIds.filter((rid) => rid !== id),
      currentWorkspaceId:
        state.currentWorkspaceId === id ? "chat" : state.currentWorkspaceId,
    }));

    logger.info("工作空间删除", { workspaceId: id });
  },

  updateWorkspaceLayout: (layout) => {
    const id = get().currentWorkspaceId;
    if (!id) return;

    set((state) => {
      const wt = state.worktrees[id];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [id]: {
            ...wt,
            layout: { ...wt.layout, ...layout },
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  bindGitRepo: (workspaceId, repoPath) => {
    set((state) => {
      const wt = state.worktrees[workspaceId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [workspaceId]: {
            ...wt,
            gitRepo: { path: repoPath, currentBranch: "" },
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  bindModel: (workspaceId, modelId, providerId) => {
    set((state) => {
      const wt = state.worktrees[workspaceId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [workspaceId]: {
            ...wt,
            modelConfig: { modelId, providerId },
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  bindAgent: (workspaceId, agentId) => {
    set((state) => {
      const wt = state.worktrees[workspaceId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [workspaceId]: { ...wt, agentId, updatedAt: Date.now() },
        },
      };
    });
  },

  addKnowledgeBase: (workspaceId, kbId) => {
    set((state) => {
      const wt = state.worktrees[workspaceId];
      if (!wt) return state;
      if (wt.knowledgeBaseIds.includes(kbId)) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [workspaceId]: {
            ...wt,
            knowledgeBaseIds: [...wt.knowledgeBaseIds, kbId],
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  removeKnowledgeBase: (workspaceId, kbId) => {
    set((state) => {
      const wt = state.worktrees[workspaceId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [workspaceId]: {
            ...wt,
            knowledgeBaseIds: wt.knowledgeBaseIds.filter((id) => id !== kbId),
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  // ─── 旧 workspaceStore 兼容动作（异步）───────────────

  listWorkspaces: async () => {
    try {
      const { workspaceService } = await import("@/services/workspaceService");
      const list = await workspaceService.listWorkspaces();
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      set({ workspaceList: list });
    } catch (err) {
      logger.warn("获取工作空间列表失败", err);
      set({ workspaceList: [] });
    }
  },

  openWorkspace: async (workspaceId: string) => {
    set({ isLoading: true, error: null });
    try {
      const { workspaceService } = await import("@/services/workspaceService");
      const ws = await workspaceService.getWorkspace(workspaceId);
      const items: OldWorkItem[] =
        await workspaceService.getWorkItems(workspaceId);

      const wtId = workspaceId;

      // 确保 worktree 存在
      if (!get().worktrees[wtId]) {
        get().createWorkspace({
          name: ws?.path ?? "工作空间",
          path: ws?.path ?? workspaceId,
        });
      }

      // 映射 workItems 到 RootWorkItem
      const mappedItems: RootWorkItem[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        status: item.status,
        workspaceId: wtId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
      }));

      // 使用 set 更新当前 worktree 的 workItems
      set((s) => {
        const wt = s.worktrees[wtId];
        if (!wt) return s;
        return {
          currentWorkspaceId: wtId,
          worktrees: {
            ...s.worktrees,
            [wtId]: { ...wt, workItems: mappedItems, updatedAt: Date.now() },
          },
          isLoading: false,
        } as Partial<RootState>;
      });
    } catch (err) {
      if (!get().worktrees[workspaceId]) {
        get().createWorkspace({ name: workspaceId, path: workspaceId });
      }
      set({
        currentWorkspaceId: workspaceId,
        isLoading: false,
        error: String(err),
      });
    }
  },

  createWorkItem: async (title: string) => {
    const wtId = get().currentWorkspaceId;
    if (!wtId) return;

    set({ isLoading: true, error: null });

    let sessionId: string | undefined;
    try {
      sessionId = get().currentSessionId ?? undefined;
    } catch {
      /* ignore */
    }

    const { workspaceService } = await import("@/services/workspaceService");
    const item = await workspaceService.createWorkItem(wtId, {
      title,
      sessionId,
    });

    set((s) => {
      const wt = s.worktrees[wtId];
      if (!wt) return s;
      const mappedItem: RootWorkItem = {
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        status: item.status,
        workspaceId: wtId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
      };
      return {
        ...s,
        worktrees: {
          ...s.worktrees,
          [wtId]: {
            ...wt,
            workItems: [...wt.workItems, mappedItem],
            updatedAt: Date.now(),
          },
        },
        isLoading: false,
      };
    });
  },

  updateWorkItemStatus: async (itemId: string, status: WorkItemStatus) => {
    const wtId = get().currentWorkspaceId;
    if (!wtId) return;

    // 乐观更新本地
    set((s) => {
      const wt = s.worktrees[wtId];
      if (!wt) return s;
      const now = Date.now();
      return {
        ...s,
        worktrees: {
          ...s.worktrees,
          [wtId]: {
            ...wt,
            workItems: wt.workItems.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    status,
                    updatedAt: now,
                  }
                : item,
            ),
            updatedAt: now,
          },
        },
      };
    });

    const { workspaceService } = await import("@/services/workspaceService");
    await workspaceService.updateWorkItem(wtId, itemId, { status });
  },

  checkBackendReady: async () => {
    const { workspaceService } = await import("@/services/workspaceService");
    const ready = await workspaceService.isBackendReady();
    set({ backendReady: ready });
  },

  resetWorkspace: () => {
    set({
      currentWorkspaceId: "chat",
      worktrees: { ...SYSTEM_WORKSPACES },
      workspaceList: [],
      isLoading: false,
      error: null,
    });
  },
});
