/**
 * 集中派生 Selector
 *
 * 所有跨 Slice 的派生数据计算统一放在此文件，
 * 组件中使用 shallow 作为 equalityFn 避免不必要的 re-render。
 *
 * 使用方式: useRootStore(selectCurrentWorktree, shallow)
 */

import type { RootState } from "./root-store";
import type { SessionRecord, Worktree } from "./root-store/types";

// ─── Worktree Selectors ────────────────────────────────

/** 当前工作空间 */
export const selectCurrentWorktree = (state: RootState): Worktree | null => {
  return state.currentWorktreeId
    ? (state.worktrees[state.currentWorktreeId] ?? null)
    : null;
};

/** 当前工作空间的 Git 状态 */
export const selectCurrentGitStatus = (state: RootState) => {
  const wt = selectCurrentWorktree(state);
  return wt?.gitRepo ?? null;
};

/** 最近使用的工作空间列表 */
export const selectRecentWorktrees = (state: RootState): Worktree[] => {
  return state.recentWorktreeIds
    .map((id) => state.worktrees[id])
    .filter(Boolean) as Worktree[];
};

// ─── Session Selectors ─────────────────────────────────

/** 当前活跃会话 */
export const selectCurrentSession = (
  state: RootState,
): SessionRecord | null => {
  return state.currentSessionId
    ? (state.sessions[state.currentSessionId] ?? null)
    : null;
};

/** 当前 worktree 下指定类型的 session 列表 */
export const selectSessionsByCurrentWorktreeAndType =
  (moduleType: string) =>
  (state: RootState): SessionRecord[] => {
    const wtId = state.currentWorktreeId;
    if (!wtId) return [];
    return Object.values(state.sessions).filter(
      (s) => s.worktreeId === wtId && s.moduleType === moduleType,
    );
  };

/** 当前 worktree 下所有 session */
export const selectSessionsByCurrentWorktree = (
  state: RootState,
): SessionRecord[] => {
  const wtId = state.currentWorktreeId;
  if (!wtId) return [];
  return Object.values(state.sessions).filter((s) => s.worktreeId === wtId);
};

/** 按模块类型筛选的 session 列表 */
export const selectSessionsByModule = (moduleType: string) => {
  return (state: RootState): SessionRecord[] => {
    return Object.values(state.sessions).filter(
      (s) => s.moduleType === moduleType,
    );
  };
};

// ─── Feature Selectors ─────────────────────────────────

/** 已启用的功能模块列表 */
export const selectEnabledModules = (state: RootState) => {
  return state.modules.filter((m) => m.enabled);
};

/** 已固定的模块 ID 列表 */
export const selectPinnedModules = (state: RootState) => {
  return state.modules.filter((m) => m.pinned);
};

// ─── Transition Selectors ──────────────────────────────

/** 当前 worktree 切换状态 */
export const selectTransitionStatus = (state: RootState) => {
  return state.transition;
};

/** 当前是否有部分失败的资源 */
export const selectHasPartialErrors = (state: RootState): boolean => {
  return (state.transition?.errors?.length ?? 0) > 0;
};
