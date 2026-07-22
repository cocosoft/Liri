/**
 * Zustand 日志中间件
 *
 * 拦截所有 set() 调用，自动检测关键状态变更并记录结构化日志。
 * 仅记录关键事件（Worktree 切换、Session 切换、WorkItems 变更），
 * 避免高频更新产生日志噪音。
 *
 * 使用方式：
 *   export const useRootStore = create<RootState>()(
 *     ...loggingMiddleware,
 *     subscribeWithSelector(persist(...))
 *   );
 */

import type { StateCreator } from "zustand";
import type { RootState } from "../root-store";
import { createLogger } from "@/utils/logger";

const storeLogger = createLogger("stores:root");

/**
 * 日志中间件 — 包装 StateCreator，在 set 前后比较并记录关键变更。
 */
export const loggingMiddleware =
  <T extends RootState>(
    config: StateCreator<T, [], []>,
  ): StateCreator<T, [], []> =>
  (set, get, api) => {
    return config(
      (partial, replace) => {
        const prev = get() as unknown as RootState;
        set(partial, replace as any);
        const next = get() as unknown as RootState;

        if (prev.currentWorktreeId !== next.currentWorktreeId) {
          storeLogger.info("Worktree 切换", {
            from: prev.currentWorktreeId,
            to: next.currentWorktreeId,
            transition: next.transition?.status,
          });
        }

        if (prev.currentSessionId !== next.currentSessionId) {
          storeLogger.info("Session 切换", {
            from: prev.currentSessionId,
            to: next.currentSessionId,
          });
        }

        const wtId = next.currentWorktreeId;
        if (wtId && wtId === prev.currentWorktreeId) {
          const nextWt = next.worktrees[wtId];
          const prevWt = prev.worktrees[wtId];
          if (
            nextWt &&
            prevWt &&
            nextWt.workItems?.length !== prevWt.workItems?.length
          ) {
            storeLogger.debug("WorkItems 变更", {
              worktreeId: wtId,
              prevCount: prevWt.workItems?.length,
              nextCount: nextWt.workItems?.length,
            });
          }
        }

        if (!prev.error && next.error) {
          storeLogger.warn("Store 错误", { error: next.error });
        }
      },
      get,
      api,
    );
  };
