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
          pinnedSessionIds: state.pinnedSessionIds,
          pinnedModuleIds: state.pinnedModuleIds,
        }),

        /** 版本迁移 */
        migrate: (persisted, version) => {
          const state = persisted as RootState;

          if (version < 4) {
            // v3→v4: moduleType + projectId 迁移
            if (state.sessions) {
              for (const s of Object.values(state.sessions)) {
                // 补全 moduleType（旧 Hub 条目不包含此字段）
                if (!s.moduleType) {
                  (s as unknown as Record<string, unknown>).moduleType =
                    inferModuleTypeFromWorkspaceId(s.workspaceId);
                }
                // 补全 projectId（仅 project 类 worktree，避免 media/office 被误判）
                if (!s.projectId && isProjectWorkspace(s.workspaceId)) {
                  (s as unknown as Record<string, unknown>).projectId =
                    s.workspaceId;
                }
              }
            }
            // 清除 chatSessions 旧残留
            state.chatSessions = [];
          }

          if (version < 3) {
            state.chatSessions = [];
          }

          if (version < 1) {
            if (state.worktrees) {
              for (const wt of Object.values(state.worktrees)) {
                if (wt.gitRepo?.path) {
                  (wt.gitRepo as Record<string, unknown>)._pathValid =
                    undefined;
                }
              }
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

          if (state.pinnedSessionIds && state.sessions) {
            const validSessionIds = new Set(Object.keys(state.sessions));
            (state as unknown as Record<string, unknown>).pinnedSessionIds =
              state.pinnedSessionIds.filter((id: string) =>
                validSessionIds.has(id),
              );
          }

          return state;
        },

        /** 水合后：合并系统工作空间，标记上下文未就绪 */
        onRehydrateStorage: () => (state) => {
          if (state) {
            state.worktrees = { ...SYSTEM_WORKSPACES, ...state.worktrees };
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
    "pinnedSessionIds",
    "pinnedModuleIds",
    "moduleContext",
  ],
});
