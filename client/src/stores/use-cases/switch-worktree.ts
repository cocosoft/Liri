/**
 * switchWorkspace use-case — 切换工作空间的完整编排流程
 *
 * 跨 Slice 业务编排：WorkspaceSlice + SessionSlice → chatStore/gitStore 联动。
 * 使用 Promise.allSettled 并行加载，容忍部分失败。
 */

import { useRootStore } from "../root-store";
import { createLogger } from "@/utils/logger";

const logger = createLogger("usecase:switchWorkspace");

export interface SwitchWorkspaceResult {
  /** 切换是否完成（partial 表示部分资源加载失败） */
  status: "completed" | "partial" | "failed";
  /** 切换到的 worktree ID */
  workspaceId: string;
  /** 加载失败的错误列表 */
  errors: { source: string; error: string }[];
}

/**
 * 两阶段切换工作空间
 *
 * 阶段 1：标记 pending，UI 显示 loading
 * 阶段 2：并行加载会话列表 + Git 状态 + 知识库索引，
 *         容忍部分失败（partial 状态），汇总错误通知 UI。
 */
export async function switchWorkspace(
  id: string,
): Promise<SwitchWorkspaceResult> {
  const root = useRootStore.getState();
  const wt = root.worktrees[id];

  if (!wt) {
    logger.warn("工作空间不存在", { workspaceId: id });
    return {
      status: "failed",
      workspaceId: id,
      errors: [{ source: "root", error: `工作空间 ${id} 不存在` }],
    };
  }

  logger.info("开始切换工作空间", { workspaceId: id, name: wt.name });

  // 委托到 workspaceSlice 的两阶段切换
  await root.switchWorkspace(id);

  const finalState = useRootStore.getState();
  const transition = finalState.transition;

  return {
    status:
      transition?.status === "completed"
        ? "completed"
        : transition?.status === "partial"
          ? "partial"
          : "failed",
    workspaceId: id,
    errors: transition?.errors ?? [],
  };
}
