/**
 * 统一根 Store (useRootStore)
 *
 * 合并 Workspace/Session/Feature/ModuleContext 四个核心 Slice。
 * 通过 subscribeWithSelector + persist 实现持久化和跨 Store 联动。
 *
 * GitStore、ChannelStore、chatStore 等高频 IO 型 Store 保持独立，
 * 通过 subscribeWithSelector 与根 Store 联动。
 */

import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";
import {
  createWorkspaceSlice,
  type WorkspaceSlice,
  SYSTEM_WORKSPACES,
} from "./workspaceSlice";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";
import { createFeatureSlice, type FeatureSlice } from "./featureSlice";
import {
  createModuleContextSlice,
  type ModuleContextState,
  type ModuleContextActions,
  inferModuleTypeFromWorkspaceId,
  isProjectWorkspace,
} from "./moduleContextSlice";
import { loggingMiddleware } from "../middleware/logging";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store");

// ─── 版本迁移定义 ─────────────────────────────────────
// 链式版本数组：每条迁移声明 from→to 版本段，migrate 按 from 升序执行。
// 新增版本只需在末尾 append，禁止修改既有条目（避免破坏历史迁移顺序）。

interface Migration {
  from: number;
  to: number;
  fn: (state: RootState) => void;
}

// ─── F-17b 存量清理（2026-10-28，一次性） ────────────────

/**
 * 旧 workspace 链路残留的**幽灵 worktree**（一次性清理名单）。
 *
 * 判定依据（逐条核对，非猜测）：
 * - `GET /v1/projects` 与 `GET /v1/workspaces` 均无对应记录；
 * - `<data>/projects` 下也没有这些 id 的目录；
 * - `GET /v1/sessions` 中**没有任何会话**引用这些 id（故删除不会孤立任何历史会话）。
 *
 * 它们被 `openWorkspace()` 的失败兜底反复重建（该兜底已在本批一并移除），
 * 只从 localStorage 删会被任何存活实例的内存态回写，所以放在**水合后**统一摘除。
 * 存量清完后本段可整体删除。
 */
const LEGACY_PHANTOM_WORKTREE_IDS = [
  "wt-1789397997212-vfeyzg",
  "wt-1789973973634-up1lmi",
  "wt-1790479146397-v7f862",
  "wt-1790488674240-iu23d9",
  "wt-1792681884524-brvgpd",
  // `plan-e2e`：2026-09 的 e2e 用例残留（path 在系统 Temp），
  // `<data>/projects/<id>` 只剩 `items.db`（无 project.json ⇒ 不可被 `/v1/projects` 列出），
  // 且其唯一会话已于 2026-10-28 删除（0 消息空壳）。磁盘文件保留、仅摘除本地入口。
  "proj_1789352729390_8i8adn",
] as const;

/** 水合后摘除幽灵 worktree（含 recentWorkspaceIds 中的对应引用） */
function pruneLegacyPhantomWorktrees(state: RootState): void {
  for (const id of LEGACY_PHANTOM_WORKTREE_IDS) {
    delete state.worktrees?.[id];
  }
  if (state.recentWorkspaceIds) {
    state.recentWorkspaceIds = state.recentWorkspaceIds.filter(
      (id) => !(LEGACY_PHANTOM_WORKTREE_IDS as readonly string[]).includes(id),
    );
  }
}

const MIGRATIONS: Migration[] = [
  // v0→v1: 清理 worktrees 中 gitRepo.path 的失效标记字段
  {
    from: 0,
    to: 1,
    fn: (state) => {
      if (state.worktrees) {
        for (const wt of Object.values(state.worktrees)) {
          if (wt.gitRepo?.path) {
            (wt.gitRepo as Record<string, unknown>)._pathValid = undefined;
          }
        }
      }
    },
  },
  // v2→v3: 清空 chatSessions（每次刷新从 API 获取，不持久化）
  {
    from: 2,
    to: 3,
    fn: (state) => {
      state.chatSessions = [];
    },
  },
  // v3→v4: 补全 moduleType/projectId；清空 chatSessions 旧残留
  {
    from: 3,
    to: 4,
    fn: (state) => {
      if (state.sessions) {
        for (const s of Object.values(state.sessions)) {
          // 补全 moduleType（旧 Hub 条目不包含此字段）
          if (!s.moduleType) {
            (s as unknown as Record<string, unknown>).moduleType =
              inferModuleTypeFromWorkspaceId(s.workspaceId);
          }
          // 补全 projectId（仅 project 类 worktree，避免 media/office 被误判）
          if (!s.projectId && isProjectWorkspace(s.workspaceId)) {
            (s as unknown as Record<string, unknown>).projectId = s.workspaceId;
          }
        }
      }
      state.chatSessions = [];
    },
  },
];

// ─── 根 State 类型 ─────────────────────────────────────

export interface RootState
  extends
    WorkspaceSlice,
    SessionSlice,
    FeatureSlice,
    ModuleContextState,
    ModuleContextActions {}

// ─── 根 Store 创建 ─────────────────────────────────────

export const useRootStore = create<RootState>()(
  subscribeWithSelector(
    persist(
      loggingMiddleware((...args) => ({
        ...createWorkspaceSlice(...args),
        ...createSessionSlice(...args),
        ...createFeatureSlice(...args),
        ...createModuleContextSlice(...args),
      })),
      {
        name: "liri-root-store",
        version: 4,

        /** 仅持久化需要跨会话保留的状态 */
        partialize: (state) => ({
          currentWorkspaceId: state.currentWorkspaceId,
          currentSessionId: state.currentSessionId,
          sessions: state.sessions,
          moduleContext: state.moduleContext, // 新增：模块上下文持久化
          // chatSessions 每次刷新从 API 获取，不持久化
          worktrees: Object.fromEntries(
            Object.entries(state.worktrees).filter(
              ([, wt]) => wt.workspaceSource === "user",
            ),
          ),
          recentWorkspaceIds: state.recentWorkspaceIds,
          moduleOrder: state.moduleOrder,
          pinnedModuleIds: state.pinnedModuleIds,
        }),

        /** 版本迁移：按 MIGRATIONS 数组链式执行（from 升序），与版本无关的清理逻辑保留在此 */
        migrate: (persisted, version) => {
          const state = persisted as RootState;

          // 执行所有未完成的迁移段（version < to 表示该段尚未执行）
          for (const migration of MIGRATIONS) {
            if (version < migration.to) {
              migration.fn(state);
            }
          }

          // 清理孤儿数据
          if (state.sessions) {
            const systemIds = new Set(Object.keys(SYSTEM_WORKSPACES));
            const validWtIds = new Set([
              ...Object.keys(state.worktrees ?? {}),
              ...systemIds,
              "",
            ]);
            const filtered: Record<string, (typeof state.sessions)[string]> =
              {};
            for (const [id, s] of Object.entries(state.sessions)) {
              if (validWtIds.has(s.workspaceId)) {
                filtered[id] = s;
              }
            }
            (state as unknown as Record<string, unknown>).sessions = filtered;
          }

          return state;
        },

        /** 水合后：合并系统工作空间，标记上下文未就绪 */
        onRehydrateStorage: () => (state) => {
          if (state) {
            state.worktrees = { ...SYSTEM_WORKSPACES, ...state.worktrees };
            // F-17b：水合后摘除旧 workspace 链路残留的幽灵 worktree（一次性名单）
            pruneLegacyPhantomWorktrees(state);
            // 等待页面 mount 后 enterModule 覆盖才标记就绪，避免刷新时闪现旧模块会话
            state._contextReady = false;
          }
          setTimeout(() => {
            useRootStore.getState().loadChatSessions();
          }, 0);
        },
      },
    ),
  ),
);

// ─── 初始化日志 ────────────────────────────────────────

logger.info("Root Store 初始化完成", {
  persistedKeys: [
    "currentWorkspaceId",
    "currentSessionId",
    "sessions",
    "worktrees",
    "recentWorkspaceIds",
    "moduleOrder",
    "pinnedModuleIds",
    "moduleContext",
  ],
});
