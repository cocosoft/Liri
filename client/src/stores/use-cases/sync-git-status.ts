/**
 * syncGitStatus use-case — Git 状态同步编排
 *
 * 跨 Slice 编排：gitStore.refreshStatus() → workspaceSlice (UI 更新)。
 */

import { useRootStore } from "../root-store";
import { useGitStore } from "../gitStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("usecase:syncGitStatus");

/** Git 同步结果 */
export interface SyncGitResult {
  worktreeId: string;
  status: "ok" | "no_repo" | "error";
  error?: string;
}

/**
 * 同步当前 worktree 的 Git 状态
 *
 * 委托给独立 gitStore.refreshStatus() 执行实际的 HTTP 请求。
 */
export async function syncGitStatus(): Promise<SyncGitResult> {
  const root = useRootStore.getState();
  const wtId = root.currentWorktreeId;

  if (!wtId) {
    logger.warn("无当前 worktree，跳过 Git 同步");
    return { worktreeId: "unknown", status: "error", error: "无当前 worktree" };
  }

  const wt = root.worktrees[wtId];
  if (!wt?.gitRepo?.path) {
    logger.debug("worktree 未绑定 Git 仓库", { worktreeId: wtId });
    return { worktreeId: wtId, status: "no_repo" };
  }

  try {
    await useGitStore.getState().refreshStatus(wtId);
    logger.debug("Git 同步完成", { worktreeId: wtId, repoPath: wt.gitRepo.path });
    return { worktreeId: wtId, status: "ok" };
  } catch (err) {
    const msg = String(err);
    logger.warn("Git 同步失败", { worktreeId: wtId, error: msg });
    return { worktreeId: wtId, status: "error", error: msg };
  }
}
