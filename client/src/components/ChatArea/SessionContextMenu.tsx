/**
 * 会话右键上下文菜单
 *
 * 从 SessionHistorySidebar 中提取，包含：
 * - 重命名、复制 ID、固定/取消固定
 * - 导出 JSON / Markdown
 */
interface SessionContextMenuProps {
  x: number;
  y: number;
  sessionId: string;
  isPinned: boolean;
  onRename: (sessionId: string) => void;
  onCopyId: (sessionId: string) => void;
  onExport: (sessionId: string, format: "json" | "md") => void;
  onTogglePin: (sessionId: string) => void;
}

function SessionContextMenu({
  x,
  y,
  sessionId,
  isPinned,
  onRename,
  onCopyId,
  onExport,
  onTogglePin,
}: SessionContextMenuProps) {
  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onRename(sessionId)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        ✏️ 重命名
      </button>
      <button
        onClick={() => onCopyId(sessionId)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        📋 复制会话 ID
      </button>
      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
      <button
        onClick={() => onExport(sessionId, "json")}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        📤 导出 JSON
      </button>
      <button
        onClick={() => onExport(sessionId, "md")}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        📝 导出 Markdown
      </button>
      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
      <button
        onClick={() => onTogglePin(sessionId)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {isPinned ? "📌 取消固定" : "📌 固定到顶部"}
      </button>
    </div>
  );
}

export default SessionContextMenu;