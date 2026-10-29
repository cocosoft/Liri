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

/**
 * P2（2026-10-29）：判断 id 是否为**后端项目实体**（`proj_<毫秒>_<随机>`，由
 * `ProjectItemStore` 生成）。项目与工作空间是两套实体：项目 id 拿去请求
 * `/v1/workspaces/:id` 必然 404（真机：打开旧会话时 `/v1/workspaces/proj_…` ⇒
 * `Workspace not found`）。消费方据此跳过「会话 → 工作空间」联动。
 */
export function isProjectEntityId(id: string | null | undefined): boolean {
  return /^proj_\d+_[a-z0-9]+$/i.test((id ?? "").trim());
}

/**
 * F-22（2026-10-29）：会话是否属于某项目 —— **唯一判据**。
 *
 * 后端 `effectiveProjectId()` 以 `metadata.projectId` 为权威（N-64），`workspaceId` 仅兜底
 * （本机 28 条会话：10 条只有 `projectId`、6 条只有 `workspaceId`）。此前 `ProjectsPage`
 * 有两套口径：**展示**用「projectId 优先」、**init 的『无会话』判定**只看 `workspaceId`
 * ⇒ 明明已有会话的项目被判成「无会话」，又新建一条 `对话 1`（真机：`proj_1793116653351_d0760e`
 * 已有 311 条消息的会话，仍被新建空壳）。
 *
 * 任何「这个项目有几个会话」的判断都必须走这里，禁止各处自写。
 */
export function sessionBelongsToProject(
  session: { projectId?: string | null; workspaceId?: string | null },
  projectId: string,
): boolean {
  const effective =
    (session.projectId ?? "").trim() ||
    resolveSessionWorkspaceId(session.workspaceId ?? undefined);
  return effective === projectId;
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
