import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRootStore } from "@/stores/root-store";
import type { Worktree } from "@/stores/root-store/types";

/**
 * 工作空间切换器
 *
 * 展示当前工作空间名称和路径，点击展开下拉列表进行原地上下文切换。
 * 支持新建（需指定文件夹）、重命名、修改路径、删除。
 */
export default function WorkspaceSwitcher() {
  const currentWtId = useRootStore((s) => s.currentWorktreeId);
  const worktrees = useRootStore((s) => s.worktrees);
  const recentWorktreeIds = useRootStore((s) => s.recentWorktreeIds);
  const switchWorktree = useRootStore((s) => s.switchWorktree);
  const createWorktree = useRootStore((s) => s.createWorktree);
  const updateWorktree = useRootStore((s) => s.updateWorktree);
  const deleteWorktree = useRootStore((s) => s.deleteWorktree);
  const transition = useRootStore((s) => s.transition);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 创建/编辑弹窗
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formPath, setFormPath] = useState("");

  // 删除确认
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

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

  const sortedWorktrees: Worktree[] = recentWorktreeIds
    .map((id) => worktrees[id])
    .filter(Boolean);

  const handleSelect = useCallback(
    async (wt: Worktree) => {
      setOpen(false);
      if (wt.id === currentWtId) return;
      await switchWorktree(wt.id);
    },
    [switchWorktree, currentWtId],
  );

  // 打开创建弹窗
  const openCreateDialog = () => {
    setDialogMode("create");
    setEditTargetId(null);
    setFormName("");
    setFormPath("");
  };

  // 打开编辑弹窗（不关闭下拉，弹窗 z-index 更高会覆盖）
  const openEditDialog = (wt: Worktree) => {
    setDialogMode("edit");
    setEditTargetId(wt.id);
    setFormName(wt.name);
    setFormPath(wt.path);
  };

  // 确认创建
  const handleCreateConfirm = () => {
    if (!formName.trim() || !formPath.trim()) return;
    const id = createWorktree({ name: formName.trim(), path: formPath.trim() });
    setDialogMode(null);
    switchWorktree(id);
  };

  // 确认编辑
  const handleEditConfirm = () => {
    if (!editTargetId || !formName.trim() || !formPath.trim()) return;
    updateWorktree(editTargetId, {
      name: formName.trim(),
      path: formPath.trim(),
    });
    setDialogMode(null);
  };

  // 确认删除
  const handleDeleteConfirm = () => {
    if (!deleteTargetId) return;
    deleteWorktree(deleteTargetId);
    setDeleteTargetId(null);
  };

  const activeWorkItemCount = currentWt
    ? currentWt.workItems.filter(
        (wi) => wi.status === "running" || wi.status === "pending",
      ).length
    : 0;

  const label = currentWt ? currentWt.name.slice(0, 2).toUpperCase() : "WS";

  return (
    <div ref={ref} className="relative">
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen(!open)}
        disabled={isSwitching}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors disabled:opacity-50 ${
          open
            ? "bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400"
            : "text-gray-600 dark:text-gray-300"
        }`}
        title={currentWt?.path || ""}
      >
        <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
          {label}
        </span>
        <span className="max-w-[120px] truncate text-gray-600 dark:text-gray-300">
          {isSwitching ? "切换中..." : (currentWt?.name ?? "选择工作空间")}
        </span>
        {activeWorkItemCount > 0 && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
            {activeWorkItemCount}
          </span>
        )}
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-80 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span>工作空间</span>
            <button
              onClick={openCreateDialog}
              className="text-blue-500 hover:text-blue-600 text-lg leading-none"
              title="新建工作空间"
            >
              +
            </button>
          </div>

          {sortedWorktrees.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              暂无工作空间，点击右上角 + 创建
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
                  <div
                    key={wt.id}
                    className={`w-full text-left px-3 py-2 transition-colors ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-900/30"
                        : "hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* 主体：可点击切换 */}
                      <button
                        onClick={() => handleSelect(wt)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
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
                          <div
                            className={`truncate text-sm ${isActive ? "text-blue-700 dark:text-blue-300 font-medium" : "text-gray-700 dark:text-gray-300"}`}
                          >
                            {wt.name}
                          </div>
                          <div
                            className="truncate text-[10px] text-gray-400 mt-0.5"
                            title={wt.path}
                          >
                            {wt.path}
                          </div>
                        </div>
                        {isActive && (
                          <span className="text-blue-600 dark:text-blue-400 text-xs flex-shrink-0">
                            ✓
                          </span>
                        )}
                      </button>

                      {/* 操作按钮（编辑/删除） */}
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDialog(wt);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                          title="编辑"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTargetId(wt.id);
                            setOpen(false);
                          }}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                          title="删除"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* 状态指示行 */}
                    <div className="flex items-center gap-2 mt-1 ml-8 text-[10px]">
                      {wt.gitRepo?.currentBranch && (
                        <span className="text-gray-400">
                          {wt.gitRepo.currentBranch}
                        </span>
                      )}
                      {wtActiveCount > 0 && (
                        <span
                          className={
                            isActive ? "text-blue-500" : "text-gray-400"
                          }
                        >
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
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 创建/编辑弹窗（Portal 到 body，避免被父容器裁剪） */}
      {dialogMode &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
            onClick={() => setDialogMode(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-96 max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
                {dialogMode === "create" ? "新建工作空间" : "编辑工作空间"}
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    工作空间名称
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如：我的项目"
                    className="w-full px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 dark:text-gray-200"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        dialogMode === "create"
                          ? handleCreateConfirm()
                          : handleEditConfirm();
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    文件夹路径 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formPath}
                    onChange={(e) => setFormPath(e.target.value)}
                    placeholder="例如：C:\\Projects\\myapp"
                    className="w-full px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 dark:text-gray-200 font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        dialogMode === "create"
                          ? handleCreateConfirm()
                          : handleEditConfirm();
                    }}
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    必须是真实存在的文件夹路径
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setDialogMode(null)}
                  className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={
                    dialogMode === "create"
                      ? handleCreateConfirm
                      : handleEditConfirm
                  }
                  disabled={!formName.trim() || !formPath.trim()}
                  className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {dialogMode === "create" ? "创建" : "保存"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 删除确认弹窗（Portal 到 body） */}
      {deleteTargetId &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
            onClick={() => setDeleteTargetId(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80 max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
                删除工作空间
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                确定要删除「{worktrees[deleteTargetId]?.name ?? ""}
                」吗？此操作不可恢复。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTargetId(null)}
                  className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
