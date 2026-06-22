import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceListItem } from "../../services/workspaceService";

/**
 * 工作空间切换器
 * 展示当前工作空间名称，点击展开下拉列表进行切换。
 * 用于 Header 右上角，替代原侧栏中的 WorkspaceSelector。
 */
export default function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const listWorkspaces = useWorkspaceStore((s) => s.listWorkspaces);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 首次挂载时加载工作空间列表
  useEffect(() => {
    listWorkspaces();
  }, [listWorkspaces]);

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

  /** 选中工作空间后切换并导航 */
  const handleSelect = useCallback(async (ws: WorkspaceListItem) => {
    setOpen(false);
    setActivePage("workspace");
    await openWorkspace(ws.id);
    navigate(`/workspace/${ws.id}/work`);
  }, [navigate, openWorkspace, setActivePage]);

  const label = currentWorkspace
    ? currentWorkspace.id.slice(0, 2).toUpperCase()
    : "WS";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { listWorkspaces(); setOpen(!open); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors ${
          open
            ? "bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400"
            : "text-gray-600 dark:text-gray-300"
        }`}
        title={currentWorkspace ? `工作空间: ${currentWorkspace.id}` : "选择工作空间"}
      >
        <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
          {label}
        </span>
        <span className="max-w-[80px] truncate">
          {currentWorkspace?.id || "空间"}
        </span>
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-80 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            工作空间
          </div>
          {workspaces.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              暂无工作空间
            </div>
          ) : (
            <div className="py-1">
              {workspaces.map((ws) => {
                const isActive = currentWorkspace?.id === ws.id;
                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelect(ws)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
                    }`}>
                      {ws.name.charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{ws.name}</div>
                      {ws.description && (
                        <div className="truncate text-xs text-gray-400">{ws.description}</div>
                      )}
                    </div>
                    {isActive && (
                      <span className="text-blue-600 dark:text-blue-400 text-xs">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
