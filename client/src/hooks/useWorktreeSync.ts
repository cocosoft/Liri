/**
 * useWorktreeSync — 旧 workspaceStore ↔ 新 WorkspaceSlice 双向同步（已废弃）
 *
 * @deprecated 同步逻辑已内置到 workspaceStore.ts（store.subscribe 自动同步到 rootStore）。
 *             App.tsx 不再调用此钩子。保留文件仅用于参考，下一轮清理时删除。
 */

import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRootStore } from "@/stores/root-store";

/**
 * 订阅旧 workspaceStore 变更，同步到新 root store 的 WorkspaceSlice。
 *
 * - 当前工作空间变更 → 同步 currentWorktreeId
 * - workItems 变更 → 同步到对应 Worktree 模型
 * - executionPhase 变更 → 同步
 */
export function useWorktreeSync(): void {
  const oldWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const oldWorkItems = useWorkspaceStore((s) => s.workItems);
  const oldExecutionPhase = useWorkspaceStore((s) => s.executionPhase);

  useEffect(() => {
    if (!oldWorkspace) return;

    const root = useRootStore.getState();
    const wtId = oldWorkspace.id;

    // 确保 worktree 存在
    if (!root.worktrees[wtId]) {
      root.createWorktree({
        name: oldWorkspace.path ?? "工作空间",
        path: oldWorkspace.path ?? "",
      });
    }

    // 同步为当前 worktree
    if (root.currentWorktreeId !== wtId) {
      root.switchWorktree(wtId);
    }

    // 同步 workItems
    // TODO: 后续通过 Worktree 模型的 workItems 字段直接管理
  }, [oldWorkspace, oldWorkItems, oldExecutionPhase]);
}
