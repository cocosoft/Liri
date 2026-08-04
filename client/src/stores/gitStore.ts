/**
 * Git Store — 独立高频 Store（30s 轮询 + 文件变更实时刷新）
 *
 * 不在根 Store 中（避免高频变更污染 selector 颗粒度），
 * 通过 subscribeWithSelector 与 useRootStore 联动。
 *
 * Phase 3: 通过 HTTP /v1/git/status 对接后端 GitContextService。
 */

import { create } from "zustand";
import { httpLegacy as http } from "../services/httpClient";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("stores:gitStore");

// ─── 类型 ─────────────────────────────────────────────

export interface GitStatus {
  staged: number;
  modified: number;
  untracked: number;
  branch: string;
  ahead: number;
  behind: number;
  /** 是否有未提交的变更 */
  hasChanges: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitRepoState {
  path: string;
  status: GitStatus | null;
  branches: string[];
  recentLog: GitLogEntry[];
  isLoading: boolean;
  error: string | null;
}

// ─── Store 接口 ───────────────────────────────────────

export interface GitStore {
  /** 按 workspaceId 索引的仓库状态 */
  repos: Record<string, GitRepoState>;

  /** 轮询定时器 ID（内部用） */
  _pollTimers: Record<string, ReturnType<typeof setInterval>>;

  // 动作
  initRepo: (workspaceId: string, path: string) => Promise<void>;
  refreshStatus: (workspaceId: string) => Promise<void>;
  startPolling: (workspaceId: string, intervalMs?: number) => void;
  stopPolling: (workspaceId: string) => void;
  commit: (workspaceId: string, message: string) => Promise<void>;
  push: (
    workspaceId: string,
    remote?: string,
    branch?: string,
  ) => Promise<void>;
  pull: (workspaceId: string) => Promise<void>;
  checkoutBranch: (workspaceId: string, branch: string) => Promise<void>;
  getLog: (workspaceId: string, count?: number) => Promise<void>;
}

// ─── Store 实现 ───────────────────────────────────────

export const useGitStore = create<GitStore>()((set, get) => ({
  repos: {},
  _pollTimers: {},

  // ─── 初始化仓库 ───
  initRepo: async (workspaceId, path) => {
    set((state) => ({
      repos: {
        ...state.repos,
        [workspaceId]: {
          path,
          status: null,
          branches: [],
          recentLog: [],
          isLoading: true,
          error: null,
        },
      },
    }));

    logger.info("Git 仓库初始化", { workspaceId, path });

    // TODO: 后端对接后，通过 IPC 调用 git init
    // const status = await ipc.invoke("git:init", { workspaceId, path });

    // 模拟初始状态
    set((state) => {
      const repo = state.repos[workspaceId];
      if (!repo) return state;
      return {
        repos: {
          ...state.repos,
          [workspaceId]: { ...repo, isLoading: false },
        },
      };
    });
  },

  // ─── 刷新状态 ───
  refreshStatus: async (workspaceId) => {
    const repo = get().repos[workspaceId];
    if (!repo) return;

    set((state) => ({
      repos: {
        ...state.repos,
        [workspaceId]: { ...repo, isLoading: true, error: null },
      },
    }));

    try {
      // Phase 3: 通过 HTTP 对接后端 GitContextService
      const data = await http.get<{
        isGitRepo: boolean;
        branch?: string;
        status?: string;
        mainBranch?: string;
        recentCommits?: string;
        userName?: string;
      }>(`/v1/git/status`);

      if (!data.isGitRepo) {
        set((state) => {
          const r = state.repos[workspaceId];
          if (!r) return state;
          return {
            repos: {
              ...state.repos,
              [workspaceId]: { ...r, isLoading: false },
            },
          };
        });
        return;
      }

      const gitStatus: GitStatus = {
        branch: data.branch ?? "unknown",
        ahead: 0,
        behind: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
        hasChanges: (data.status?.length ?? 0) > 0,
      };

      set((state) => {
        const r = state.repos[workspaceId];
        if (!r) return state;
        return {
          repos: {
            ...state.repos,
            [workspaceId]: { ...r, status: gitStatus, isLoading: false },
          },
        };
      });

      logger.debug("Git 状态刷新完成", {
        workspaceId,
        branch: gitStatus.branch,
      });
    } catch (e) {
      handleClientError(e, { module: "stores:git", action: "refreshStatus" });
      set((state) => {
        const r = state.repos[workspaceId];
        if (!r) return state;
        return {
          repos: {
            ...state.repos,
            [workspaceId]: { ...r, isLoading: false, error: String(e) },
          },
        };
      });
      logger.error("Git 状态刷新失败", { workspaceId, error: String(e) });
    }
  },

  // ─── 轮询 ───
  startPolling: (workspaceId, intervalMs = 30000) => {
    // 防止重复开启
    const existing = get()._pollTimers[workspaceId];
    if (existing) clearInterval(existing);

    const timer = setInterval(() => {
      get().refreshStatus(workspaceId);
    }, intervalMs);

    set((state) => ({
      _pollTimers: { ...state._pollTimers, [workspaceId]: timer },
    }));

    logger.debug("Git 轮询启动", { workspaceId, intervalMs });
  },

  stopPolling: (workspaceId) => {
    const existing = get()._pollTimers[workspaceId];
    if (existing) {
      clearInterval(existing);
      set((state) => {
        const { [workspaceId]: _, ...rest } = state._pollTimers;
        return { _pollTimers: rest };
      });
      logger.debug("Git 轮询停止", { workspaceId });
    }
  },

  // ─── 提交 ───
  commit: async (workspaceId, message) => {
    const repo = get().repos[workspaceId];
    if (!repo) return;
    logger.info("Git Commit", { workspaceId, message });

    // TODO: 后端对接
    // await ipc.invoke("git:commit", { workspaceId, path: repo.path, message });
    await get().refreshStatus(workspaceId);
  },

  // ─── 推送 ───
  push: async (workspaceId, remote, branch) => {
    const repo = get().repos[workspaceId];
    if (!repo) return;
    logger.info("Git Push", { workspaceId, remote, branch });

    // TODO: 后端对接
    // await ipc.invoke("git:push", { workspaceId, path: repo.path, remote, branch });
    await get().refreshStatus(workspaceId);
  },

  // ─── 拉取 ───
  pull: async (workspaceId) => {
    const repo = get().repos[workspaceId];
    if (!repo) return;
    logger.info("Git Pull", { workspaceId });

    // TODO: 后端对接
    // await ipc.invoke("git:pull", { workspaceId, path: repo.path });
    await get().refreshStatus(workspaceId);
  },

  // ─── 切换分支 ───
  checkoutBranch: async (workspaceId, branch) => {
    const repo = get().repos[workspaceId];
    if (!repo) return;
    logger.info("Git Checkout", { workspaceId, branch });

    // TODO: 后端对接
    // await ipc.invoke("git:checkout", { workspaceId, path: repo.path, branch });
    await get().refreshStatus(workspaceId);
  },

  // ─── 获取日志 ───
  getLog: async (workspaceId, _count = 10) => {
    const repo = get().repos[workspaceId];
    if (!repo) return;

    try {
      // TODO: Phase 3 — 后端对接 GitService
      // const log = await ipc.invoke("git:log", { workspaceId, path: repo.path, count });

      // 后端未对接时，日志列表保持空
      set((state) => {
        const r = state.repos[workspaceId];
        if (!r) return state;
        return {
          repos: {
            ...state.repos,
            [workspaceId]: { ...r, recentLog: [], isLoading: false },
          },
        };
      });
    } catch (e) {
      handleClientError(e, { module: "stores:git", action: "getLog" });
      logger.error("Git 日志获取失败", { workspaceId, error: String(e) });
    }
  },
}));

// ─── 订阅 Workspace 切换，自动刷新 Git 状态 ──────────────
// 应用级长生命周期订阅，组件卸载时无需清理；返回的 unsubscribe 函数由 GC 管理

// 延迟导入避免循环依赖
setTimeout(() => {
  import("./root-store")
    .then(({ useRootStore }) => {
      void useRootStore.subscribe(
        (state) => state.currentWorkspaceId,
        (newId) => {
          if (newId) {
            const wt = useRootStore.getState().worktrees[newId];
            if (wt?.gitRepo?.path) {
              const state = useGitStore.getState();
              // 如果尚未初始化，先 init 再 refresh + 启动轮询
              if (!state.repos[newId]) {
                state
                  .initRepo(newId, wt.gitRepo.path)
                  .then(() => {
                    state.refreshStatus(newId);
                    state.startPolling(newId);
                  })
                  .catch(() => {
                    /* initRepo 失败不影响订阅 */
                  });
              } else {
                state.refreshStatus(newId);
                state.startPolling(newId);
              }
            }
          }
        },
      );
    })
    .catch(() => {
      /* 延迟加载 root-store 失败，Git 状态将不会自动刷新 */
    });
}, 0);
