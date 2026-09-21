/**
 * 集中派生 Selector
 *
 * 所有跨 Slice 的派生数据计算统一放在此文件，
 * 组件中使用 shallow 作为 equalityFn 避免不必要的 re-render。
 *
 * 使用方式: useRootStore(selectCurrentWorkspace, shallow)
 */

import type { RootState } from "./root-store";
import type { SessionRecord, Workspace } from "./root-store/types";

// ─── Workspace Selectors ────────────────────────────────

/** 当前工作空间 */
export const selectCurrentWorkspace = (state: RootState): Workspace | null => {
  return state.currentWorkspaceId
    ? (state.worktrees[state.currentWorkspaceId] ?? null)
    : null;
};

/** 当前工作空间的 Git 状态 */
export const selectCurrentGitStatus = (state: RootState) => {
  const wt = selectCurrentWorkspace(state);
  return wt?.gitRepo ?? null;
};

/** 最近使用的工作空间列表 */
export const selectRecentWorkspaces = (state: RootState): Workspace[] => {
  return state.recentWorkspaceIds
    .map((id) => state.worktrees[id])
    .filter(Boolean) as Workspace[];
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
export const selectSessionsByCurrentWorkspaceAndType =
  (moduleType: string) =>
  (state: RootState): SessionRecord[] => {
    const wtId = state.currentWorkspaceId;
    if (!wtId) return [];
    return Object.values(state.sessions).filter(
      (s) => s.workspaceId === wtId && s.moduleType === moduleType,
    );
  };

/**
 * N-62（2026-09-20）：会话归属工作区（项目）的**唯一解析口径**。
 *
 * 背景：会话的 `workspaceId` 可能为空串（实测 998/1043 条），而 `??` **对空串不兜底**
 * ⇒ 若 Hub 记录与会话自身都为空，调用方会拿到 `""` 并用它与项目 id 比较而必然失败，
 * 由此产生"项目卡片 2 个会话 / 项目页侧栏 0 条"这类不一致。
 * 统一规则：**Hub 值优先，空串/纯空白回退到会话自身的值**。
 *
 * 消费方：`ProjectsPage.getSessionCount`、删除项目时的会话筛选、
 * `SessionHistorySidebar` 的项目作用域过滤与分组键。
 */
export function resolveSessionWorkspaceId(
  fromSession?: string,
  fromHub?: string,
): string {
  return (fromHub ?? "").trim() || (fromSession ?? "").trim();
}

/** 当前 worktree 下所有 session */
export const selectSessionsByCurrentWorkspace = (
  state: RootState,
): SessionRecord[] => {
  const wtId = state.currentWorkspaceId;
  if (!wtId) return [];
  return Object.values(state.sessions).filter((s) => s.workspaceId === wtId);
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

/** 已启用的功能模块列表（按当前版本 tier 过滤，base 版不含 pro 模块） */
export const selectEnabledModules = (state: RootState) => {
  return state.getVisibleModules().filter((m) => m.enabled);
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
