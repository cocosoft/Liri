/**
 * Workspace Slice — 工作空间统一状态管理 + 旧 workspaceStore 状态
 *
 * 合并环境隔离 + 任务管理 + 会话历史 + UI 布局为一个 Worktree 模型。
 * workspaceStore.ts 作为薄镜像，通过 subscribe 自动同步。
 */

import type { StateCreator } from "zustand";
import type {
  Worktree,
  WorktreeLayout,
  WorktreeTransition,
  WorkItem as RootWorkItem,
} from "./types";
import type { RootState } from "./index";
import type { WorkspaceListItem } from "@/services/workspaceService";
import type { WorkItem as OldWorkItem, WorkItemStatus } from "@/stores/workStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store:workspaceSlice");

// ─── Slice 接口 ────────────────────────────────────────

export interface WorkspaceSlice {
  // ── Worktree 字段 ──
  /** 当前工作空间 ID */
  currentWorktreeId: string | null;

  /** 所有工作空间 */
  worktrees: Record<string, Worktree>;

  /** 最近使用的工作空间 ID */
  recentWorktreeIds: string[];

  /** 当前 worktree 切换的状态 */
  transition: WorktreeTransition | null;

  /** 加载/切换过程中的错误信息 */
  error: string | null;

  /** 是否正在加载 */
  isLoading: boolean;

  // ── 旧 workspaceStore 兼容字段 ──
  /** 工作空间列表（workspaceStore 镜像源） */
  workspaceList: WorkspaceListItem[];

  /** 后端 API 是否就绪 */
  backendReady: boolean;

  // ─── Worktree 动作 ───
  createWorktree: (config: { name: string; path: string; description?: string }) => string;
  switchWorktree: (id: string) => Promise<void>;
  deleteWorktree: (id: string) => void;
  /** 更新工作空间名称或路径 */
  updateWorktree: (id: string, updates: { name?: string; path?: string; description?: string }) => void;
  updateWorktreeLayout: (layout: Partial<WorktreeLayout>) => void;
  bindGitRepo: (worktreeId: string, repoPath: string) => void;
  bindModel: (worktreeId: string, modelId: string, providerId: string) => void;
  bindAgent: (worktreeId: string, agentId: string) => void;
  addKnowledgeBase: (worktreeId: string, kbId: string) => void;
  removeKnowledgeBase: (worktreeId: string, kbId: string) => void;

  // ─── 旧 workspaceStore 兼容动作（异步，调用 workspaceService）───
  /** 获取工作空间列表 */
  listWorkspaces: () => Promise<void>;
  /** 打开工作空间：加载信息 + 工作项列表 */
  openWorkspace: (workspaceId: string) => Promise<void>;
  /** 创建工作项 */
  createWorkItem: (title: string) => Promise<void>;
  /** 更新工作项状态 */
  updateWorkItemStatus: (itemId: string, status: WorkItemStatus) => Promise<void>;
  /** 检查后端就绪 */
  checkBackendReady: () => Promise<void>;
  /** 重置状态 */
  resetWorkspace: () => void;
}

// ─── 默认布局 ──────────────────────────────────────────

const DEFAULT_LAYOUT: WorktreeLayout = {
  activeModuleId: null,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  rightPanelOpen: false,
  uiSnapshots: {},
};

// ─── Slice 实现 ────────────────────────────────────────

export const createWorkspaceSlice: StateCreator<RootState, [], [], WorkspaceSlice> = (
  set,
  get
) => ({
  // ── 初始状态 ──
  currentWorktreeId: null,
  worktrees: {},
  recentWorktreeIds: [],
  transition: null,
  error: null,
  isLoading: false,
  workspaceList: [],
  backendReady: false,

  // ─── Worktree 动作 ──────────────────────────────────

  createWorktree: (config) => {
    const id = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const worktree: Worktree = {
      id,
      name: config.name,
      path: config.path,
      description: config.description,
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
      recentWorktreeIds: [id, ...state.recentWorktreeIds].slice(0, 20),
    }));

    logger.info("工作空间创建", { worktreeId: id, name: config.name, path: config.path });
    return id;
  },

  updateWorktree: (id, updates) => {
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
    logger.info("工作空间更新", { worktreeId: id, ...updates });
  },

  switchWorktree: async (id) => {
    if (!get().worktrees[id]) {
      set({ error: `工作空间 ${id} 不存在` });
      return;
    }

    set({
      transition: { targetId: id, status: "pending", errors: [] },
      isLoading: true,
      error: null,
    });

    const loadTasks: Promise<{ source: string; ok: boolean; error?: string }>[] = [];

    loadTasks.push(
      (async () => {
        try {
          return { source: "session", ok: true };
        } catch (e) {
          return { source: "session", ok: false, error: String(e) };
        }
      })()
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
      })()
    );

    loadTasks.push(
      (async () => {
        try {
          return { source: "knowledge", ok: true };
        } catch (e) {
          return { source: "knowledge", ok: false, error: String(e) };
        }
      })()
    );

    const results = await Promise.all(loadTasks);
    const errors = results
      .filter((r) => !r.ok)
      .map((r) => ({ source: r.source, error: r.error! }));

    const transitionStatus = errors.length === 0 ? "completed" : "partial";

    set({
      currentWorktreeId: id,
      recentWorktreeIds: [
        id,
        ...get().recentWorktreeIds.filter((rid) => rid !== id),
      ].slice(0, 20),
      transition: {
        targetId: id,
        status: transitionStatus,
        errors,
      },
      isLoading: false,
      error: errors.length > 0 ? `部分资源加载失败: ${errors.map((e) => e.source).join(", ")}` : null,
    });

    logger.info("工作空间切换", { worktreeId: id, status: transitionStatus, errors: errors.length });
  },

  deleteWorktree: (id) => {
    const { [id]: _removed, ...rest } = get().worktrees;

    set((state) => ({
      worktrees: rest,
      recentWorktreeIds: state.recentWorktreeIds.filter((rid) => rid !== id),
      currentWorktreeId: state.currentWorktreeId === id ? null : state.currentWorktreeId,
    }));

    logger.info("工作空间删除", { worktreeId: id });
  },

  updateWorktreeLayout: (layout) => {
    const id = get().currentWorktreeId;
    if (!id) return;

    set((state) => {
      const wt = state.worktrees[id];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [id]: { ...wt, layout: { ...wt.layout, ...layout }, updatedAt: Date.now() },
        },
      };
    });
  },

  bindGitRepo: (worktreeId, repoPath) => {
    set((state) => {
      const wt = state.worktrees[worktreeId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [worktreeId]: { ...wt, gitRepo: { path: repoPath, currentBranch: "" }, updatedAt: Date.now() },
        },
      };
    });
  },

  bindModel: (worktreeId, modelId, providerId) => {
    set((state) => {
      const wt = state.worktrees[worktreeId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [worktreeId]: { ...wt, modelConfig: { modelId, providerId }, updatedAt: Date.now() },
        },
      };
    });
  },

  bindAgent: (worktreeId, agentId) => {
    set((state) => {
      const wt = state.worktrees[worktreeId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [worktreeId]: { ...wt, agentId, updatedAt: Date.now() },
        },
      };
    });
  },

  addKnowledgeBase: (worktreeId, kbId) => {
    set((state) => {
      const wt = state.worktrees[worktreeId];
      if (!wt) return state;
      if (wt.knowledgeBaseIds.includes(kbId)) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [worktreeId]: { ...wt, knowledgeBaseIds: [...wt.knowledgeBaseIds, kbId], updatedAt: Date.now() },
        },
      };
    });
  },

  removeKnowledgeBase: (worktreeId, kbId) => {
    set((state) => {
      const wt = state.worktrees[worktreeId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [worktreeId]: {
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
      const items: OldWorkItem[] = await workspaceService.getWorkItems(workspaceId);

      const wtId = workspaceId;

      // 确保 worktree 存在
      if (!get().worktrees[wtId]) {
        get().createWorktree({ name: ws?.path ?? "工作空间", path: ws?.path ?? workspaceId });
      }

      // 映射 workItems 到 RootWorkItem
      const mappedItems: RootWorkItem[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        status: item.status,
        worktreeId: wtId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
      }));

      // 使用 set 更新当前 worktree 的 workItems
      set((s) => {
        const wt = s.worktrees[wtId];
        if (!wt) return s;
        return {
          currentWorktreeId: wtId,
          worktrees: {
            ...s.worktrees,
            [wtId]: { ...wt, workItems: mappedItems, updatedAt: Date.now() },
          },
          isLoading: false,
        } as Partial<RootState>;
      });
    } catch (err) {
      if (!get().worktrees[workspaceId]) {
        get().createWorktree({ name: workspaceId, path: workspaceId });
      }
      set({ currentWorktreeId: workspaceId, isLoading: false, error: String(err) });
    }
  },

  createWorkItem: async (title: string) => {
    const wtId = get().currentWorktreeId;
    if (!wtId) return;

    set({ isLoading: true, error: null });

    let sessionId: string | undefined;
    try {
      sessionId = get().currentSessionId ?? undefined;
    } catch { /* ignore */ }

    const { workspaceService } = await import("@/services/workspaceService");
    const item = await workspaceService.createWorkItem(wtId, { title, sessionId });

    set((s) => {
      const wt = s.worktrees[wtId];
      if (!wt) return s;
      const mappedItem: RootWorkItem = {
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        status: item.status,
        worktreeId: wtId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
      };
      return {
        ...s,
        worktrees: {
          ...s.worktrees,
          [wtId]: { ...wt, workItems: [...wt.workItems, mappedItem], updatedAt: Date.now() },
        },
        isLoading: false,
      };
    });
  },

  updateWorkItemStatus: async (itemId: string, status: WorkItemStatus) => {
    const wtId = get().currentWorktreeId;
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
                : item
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
      currentWorktreeId: null,
      worktrees: {},
      workspaceList: [],
      isLoading: false,
      error: null,
    });
  },
});
