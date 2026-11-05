/**
 * P0-1（2026-11-05）：会话工作区失效 → 顶部提示条（纯函数）
 *
 * 后端 `GET /v1/sessions/:id` 的 `workspaceStatus` 读时派生（`computeWorkspaceStatus`）。
 * 本模块只决定"要不要提示 / 提示哪一档 / 列哪些路径"，渲染在 `ChatArea`。
 *
 * 为什么在**发消息前**提示：worktree 被清理后，会话的 `metadata.workspacePath` 仍指向死目录，
 * 旧行为是首轮工具调用连续失败（「路径越界 / ENOENT」）才暴露，用户只看到任务莫名停摆。
 */
import type { WorkspaceStatus } from "../types/session";

export interface WorkspaceStatusNotice {
  /** 标题 i18n 键 */
  titleKey: string;
  /** 说明 i18n 键（含 `{{paths}}` 插值） */
  descKey: string;
  /** 展示给用户的失效路径（`invalid` 时可能是全部根） */
  paths: string[];
}

/**
 * 取工作区状态提示；`unbound` / `ok` / 缺省 ⇒ `null`（不打扰）。
 *
 * `invalid` 优先展示 `missingRoots`（后端只在全部失效时才与 `roots` 等长，
 * 但仍兜底回落到 `roots`，避免后端字段缺失时提示里没有路径）。
 */
export function getWorkspaceStatusNotice(
  status: WorkspaceStatus | undefined,
): WorkspaceStatusNotice | null {
  if (!status || status.state === "ok" || status.state === "unbound") {
    return null;
  }
  const paths =
    status.missingRoots && status.missingRoots.length > 0
      ? status.missingRoots
      : status.roots;
  if (status.state === "partial") {
    return {
      titleKey: "chat.workspacePartialTitle",
      descKey: "chat.workspacePartialDesc",
      paths,
    };
  }
  return {
    titleKey: "chat.workspaceInvalidTitle",
    descKey: "chat.workspaceInvalidDesc",
    paths,
  };
}

/**
 * P0-1（2026-11-05）：是否给出「重新定位工作区」入口。
 *
 * 只在 `invalid`（**全部根**失效）时给：此时主根已不可用，替换指向不会误伤任何可用目录。
 * `partial` 时主根仍可用 —— 若也提供入口，用户一操作就会把**正在用的**主根换掉。
 */
export function shouldOfferWorkspaceRelocate(
  status: WorkspaceStatus | undefined,
): boolean {
  return status?.state === "invalid";
}
