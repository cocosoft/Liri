/**
 * Workspace Slice — 工作空间统一状态管理
 *
 * 合并环境隔离 + 任务管理 + 会话历史 + UI 布局为一个 Worktree 模型。
 * 与现有 workspaceStore 并行运行（两套 Store 共存策略）。
 */

import type { StateCreator } from "zustand";
import type {
  Worktree,
  WorktreeLayout,
  WorktreeTransition,
} from "./types";
import type { RootState } from "./index";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store:workspaceSlice");

// ─── Slice 接口 ────────────────────────────────────────

export interface WorkspaceSlice {
  /** 当前工作空间 ID */
  currentWorktreeId: string | null;

  /** 所有工作空间 */
  worktrees: Record<string, Worktree>;

  /** 最近使用的工作空间 ID（方便快速切换） */
  recentWorktreeIds: string[];

  /** 当前 worktree 切换的状态 */
  transition: WorktreeTransition | null;

  /** 加载/切换过程中的错误信息 */
  error: string | null;

  /** 是否正在加载 */
  isLoading: boolean;

  // ─── 动作 ───

  createWorktree: (config: Partial<Pick<Worktree, "name" | "description">>) => string;
  /** 两阶段切换：先标记 pending，并行加载，汇总失败后标记 completed/partial */
  switchWorktree: (id: string) => Promise<void>;
  deleteWorktree: (id: string) => void;
  updateWorktreeLayout: (layout: Partial<WorktreeLayout>) => void;
  bindGitRepo: (worktreeId: string, repoPath: string) => void;
  bindModel: (worktreeId: string, modelId: string, providerId: string) => void;
  bindAgent: (worktreeId: string, agentId: string) => void;
  addKnowledgeBase: (worktreeId: string, kbId: string) => void;
  removeKnowledgeBase: (worktreeId: string, kbId: string) => void;
}

// ─── Slice 实现 ────────────────────────────────────────

const DEFAULT_LAYOUT: WorktreeLayout = {
  activeModuleId: null,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  rightPanelOpen: false,
  uiSnapshots: {},
};

export const createWorkspaceSlice: StateCreator<RootState, [], [], WorkspaceSlice> = (
  set,
  get
) => ({
  currentWorktreeId: null,
  worktrees: {},
  recentWorktreeIds: [],
  transition: null,
  error: null,
  isLoading: false,

  // ─── 创建工作空间 ───
  createWorktree: (config) => {
    const id = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const worktree: Worktree = {
      id,
      name: config.name ?? "未命名工作空间",
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

    logger.info("工作空间创建", { worktreeId: id, name: worktree.name });
    return id;
  },

  // ─── 两阶段切换工作空间 ───
  switchWorktree: async (id) => {
    if (!get().worktrees[id]) {
      set({ error: `工作空间 ${id} 不存在` });
      return;
    }

    // 阶段 1：标记 pending
    set({
      transition: { targetId: id, status: "pending", errors: [] },
      isLoading: true,
      error: null,
    });

    // 阶段 2：并行加载资源（容忍部分失败）
    const loadTasks: Promise<{ source: string; ok: boolean; error?: string }>[] = [];

    // 加载会话列表（内部方法，由 SessionSlice 提供或直接调用 sessionService）
    loadTasks.push(
      (async () => {
        try {
          // 会话列表加载由 SessionSlice.loadSessionsForWorktree 负责，
          // 这里仅触发 — 实际加载逻辑在 sessionSlice 的 subscribe 中
          return { source: "session", ok: true };
        } catch (e) {
          return { source: "session", ok: false, error: String(e) };
        }
      })()
    );

    // Git 状态（由独立 gitStore 负责）
    loadTasks.push(
      (async () => {
        try {
          const wt = get().worktrees[id];
          if (wt?.gitRepo?.path) {
            // gitStore 尚未创建，此处预留调用
            // await useGitStore.getState().refreshStatus(id);
          }
          return { source: "git", ok: true };
        } catch (e) {
          return { source: "git", ok: false, error: String(e) };
        }
      })()
    );

    // 知识库索引
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

    logger.info("工作空间切换", {
      worktreeId: id,
      status: transitionStatus,
      errors: errors.length,
    });
  },

  // ─── 删除工作空间 ───
  deleteWorktree: (id) => {
    const { [id]: _removed, ...rest } = get().worktrees;

    set((state) => ({
      worktrees: rest,
      recentWorktreeIds: state.recentWorktreeIds.filter((rid) => rid !== id),
      currentWorktreeId:
        state.currentWorktreeId === id ? null : state.currentWorktreeId,
    }));

    logger.info("工作空间删除", { worktreeId: id });
  },

  // ─── 布局更新 ───
  updateWorktreeLayout: (layout) => {
    const id = get().currentWorktreeId;
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

  // ─── 绑定 ───
  bindGitRepo: (worktreeId, repoPath) => {
    set((state) => {
      const wt = state.worktrees[worktreeId];
      if (!wt) return state;
      return {
        worktrees: {
          ...state.worktrees,
          [worktreeId]: {
            ...wt,
            gitRepo: { path: repoPath, currentBranch: "" },
            updatedAt: Date.now(),
          },
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
          [worktreeId]: {
            ...wt,
            modelConfig: { modelId, providerId },
            updatedAt: Date.now(),
          },
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
          [worktreeId]: {
            ...wt,
            knowledgeBaseIds: [...wt.knowledgeBaseIds, kbId],
            updatedAt: Date.now(),
          },
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
});
