/**
 * 统一根 Store (useRootStore)
 *
 * 合并 Workspace/Session/Feature 三个低-中频变更的核心 Slice。
 * 通过 subscribeWithSelector + persist 实现持久化和跨 Store 联动。
 *
 * GitStore、ChannelStore、chatStore 等高频 IO 型 Store 保持独立，
 * 通过 subscribeWithSelector 与根 Store 联动。
 *
 * Phase 1：与现有 workspaceStore、sessionStore 并行运行，互不依赖。
 */

import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";
import { createWorkspaceSlice, type WorkspaceSlice } from "./workspaceSlice";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";
import { createFeatureSlice, type FeatureSlice } from "./featureSlice";
import { loggingMiddleware } from "../middleware/logging";
import { createLogger } from "@/utils/logger";

const logger = createLogger("root-store");

// ─── 根 State 类型 ─────────────────────────────────────

export interface RootState extends WorkspaceSlice, SessionSlice, FeatureSlice {}

// ─── 根 Store 创建 ─────────────────────────────────────

export const useRootStore = create<RootState>()(
  subscribeWithSelector(
    persist(
      loggingMiddleware((...args) => ({
        ...createWorkspaceSlice(...args),
        ...createSessionSlice(...args),
        ...createFeatureSlice(...args),
      })),
      {
        name: "liri-root-store",
        version: 1,

        /** 仅持久化需要跨会话保留的状态 */
        partialize: (state) => ({
          currentWorktreeId: state.currentWorktreeId,
          currentSessionId: state.currentSessionId,
          sessions: state.sessions, // 核心：会话记录必须持久化
          chatSessions: state.chatSessions, // 旧 sessionStore 兼容数据
          worktrees: state.worktrees,
          recentWorktreeIds: state.recentWorktreeIds,
          moduleOrder: state.moduleOrder,
          pinnedSessionIds: state.pinnedSessionIds,
          pinnedModuleIds: state.pinnedModuleIds,
        }),

        /** 版本迁移：处理数据结构升级和孤儿数据清理 */
        migrate: (persisted, version) => {
          const state = persisted as RootState;

          if (version < 1) {
            // 验证 gitRepo.path 是否仍有效
            if (state.worktrees) {
              for (const wt of Object.values(state.worktrees)) {
                if (wt.gitRepo?.path) {
                  (wt.gitRepo as Record<string, unknown>)._pathValid =
                    undefined;
                }
              }
            }
          }

          // 清理孤儿数据：session 引用的 worktree 必须存在
          if (state.sessions) {
            const validWtIds = new Set(Object.keys(state.worktrees ?? {}));
            const filtered: Record<string, (typeof state.sessions)[string]> =
              {};
            for (const [id, s] of Object.entries(state.sessions)) {
              if (validWtIds.has(s.worktreeId)) {
                filtered[id] = s;
              }
            }
            (state as unknown as Record<string, unknown>).sessions = filtered;
          }

          // pinned 引用的 session 必须存在
          if (state.pinnedSessionIds && state.sessions) {
            const validSessionIds = new Set(Object.keys(state.sessions));
            (state as unknown as Record<string, unknown>).pinnedSessionIds =
              state.pinnedSessionIds.filter((id: string) =>
                validSessionIds.has(id),
              );
          }

          return state;
        },
      },
    ),
  ),
);

// ─── 初始化日志 ────────────────────────────────────────

logger.info("Root Store 初始化完成", {
  persistedKeys: [
    "currentWorktreeId",
    "currentSessionId",
    "sessions",
    "worktrees",
    "recentWorktreeIds",
    "moduleOrder",
    "pinnedSessionIds",
    "pinnedModuleIds",
  ],
});
