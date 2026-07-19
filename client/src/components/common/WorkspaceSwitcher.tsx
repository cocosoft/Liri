import { useState, useRef, useEffect, useCallback } from "react";
import { useRootStore } from "@/stores/root-store";
import type { Worktree } from "@/stores/root-store/types";

/**
 * 工作空间切换器（Phase 7.3：集成到 root store）
 *
 * 展示当前工作空间名称，点击展开下拉列表进行原地上下文切换。
 * 切换时使用 useRootStore.switchWorktree()（两阶段切换），不再导航跳页。
 * 用于 Header 右上角。
 */
export default function WorkspaceSwitcher() {
  const currentWtId = useRootStore((s) => s.currentWorktreeId);
  const worktrees = useRootStore((s) => s.worktrees);
  const recentWorktreeIds = useRootStore((s) => s.recentWorktreeIds);
  const switchWorktree = useRootStore((s) => s.switchWorktree);
  const createWorktree = useRootStore((s) => s.createWorktree);
  const transition = useRootStore((s) => s.transition);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentWt = currentWtId ? worktrees[currentWtId] : undefined;
  const isSwitching = transition !== null && transition.status === "pending";

  // 按 recentWorktreeIds 排序得到下拉列表
  const sortedWorktrees: Worktree[] = recentWorktreeIds
    .map((id) => worktrees[id])
    .filter(Boolean);

  /** 选中工作空间后原地上下文切换，不导航跳页 */
  const handleSelect = useCallback(
    async (wt: Worktree) => {
      setOpen(false);
      if (wt.id === currentWtId) return;
      await switchWorktree(wt.id);
    },
    [switchWorktree, currentWtId],
  );

  /** 快速创建新工作空间并切换 */
  const handleCreate = useCallback(async () => {
    setOpen(false);
    const id = createWorktree({ name: "新工作空间" });
    await switchWorktree(id);
  }, [createWorktree, switchWorktree]);

  // 活动工作项数量
  const activeWorkItemCount = currentWt
    ? currentWt.workItems.filter((wi) => wi.status === "running" || wi.status === "pending").length
    : 0;

  const label = currentWt
    ? currentWt.name.slice(0, 2).toUpperCase()
    : "WS";
  const displayName = currentWt?.name ?? "选择工作空间";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isSwitching}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors disabled:opacity-50 ${
          open
            ? "bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400"
            : "text-gray-600 dark:text-gray-300"
        }`}
        title={currentWt?.description || displayName}
      >
        <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
          {label}
        </span>
        <span className="max-w-[100px] truncate text-gray-600 dark:text-gray-300">
          {isSwitching ? "切换中..." : displayName}
        </span>
        {activeWorkItemCount > 0 && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
            {activeWorkItemCount}
          </span>
        )}
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-80 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            工作空间
          </div>

          {sortedWorktrees.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              暂无工作空间
            </div>
          ) : (
            <div className="py-1">
              {sortedWorktrees.map((wt) => {
                const isActive = currentWtId === wt.id;
                const wtActiveCount = wt.workItems.filter(
                  (wi) => wi.status === "running" || wi.status === "pending",
                ).length;
                const wtBlockedCount = wt.workItems.filter(
                  (wi) => wi.status === "failed",
                ).length;

                return (
                  <button
                    key={wt.id}
                    onClick={() => handleSelect(wt)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {wt.name.charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{wt.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        {wt.gitRepo?.path && (
                          <span>
                            {wt.gitRepo.currentBranch || "main"}
                          </span>
                        )}
                        {wtActiveCount > 0 && (
                          <span className={isActive ? "text-blue-500" : ""}>
                            {wtActiveCount} tasks
                          </span>
                        )}
                        {wtBlockedCount > 0 && (
                          <span className="text-red-400">
                            ({wtBlockedCount} blocked)
                          </span>
                        )}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-blue-600 dark:text-blue-400 text-xs flex-shrink-0">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 底部操作 */}
          <div className="border-t border-gray-200 dark:border-gray-700 py-1">
            <button
              onClick={handleCreate}
              className="w-full text-left px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <span className="text-base leading-none">+</span>
              新建工作空间
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
