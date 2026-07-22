/**
 * 会话列表项组件
 *
 * 从 SessionHistorySidebar 中提取，渲染单个会话条目的：
 * - 固定标识、来源标签、标题、时间、轮次
 * - 编辑态（双击重命名）
 * - 删除按钮（hover 显示）
 * - 右键菜单触发
 */
import { formatRelativeTime } from "../../utils/formatTime";

interface SessionListItemProps {
  session: {
    id: string;
    title: string;
    updatedAt: string;
    source?: string;
    roundCount?: number;
    messageCount: number;
  };
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  pinned: boolean;
  getSourceLabel: (source?: string) => string;
  onSwitch: (id: string) => void;
  onDoubleClick: (id: string, title: string) => void;
  onEditTitleChange: (title: string) => void;
  onEditBlur: () => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function SessionListItem({
  session,
  isActive,
  isEditing,
  editTitle,
  getSourceLabel,
  onSwitch,
  onDoubleClick,
  onEditTitleChange,
  onEditBlur,
  onEditKeyDown,
  onDelete,
  onContextMenu,
}: SessionListItemProps) {
  return (
    <div
      key={session.id}
      onContextMenu={(e) => onContextMenu(e, session.id)}
      className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors group ${
        isActive
          ? "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400"
          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
      }`}
    >
      <button
        onClick={() => onSwitch(session.id)}
        onDoubleClick={() => onDoubleClick(session.id, session.title)}
        className="flex-1 flex items-center gap-2 truncate text-left min-w-0"
      >
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 text-sm w-full outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="truncate">{session.title || "未命名会话"}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {session.source ? (
                <span className="font-medium text-gray-400 dark:text-gray-500 mr-1">
                  {getSourceLabel(session.source)}
                </span>
              ) : null}
              {formatRelativeTime(session.updatedAt)}
              {(session.roundCount ?? Math.ceil(session.messageCount / 2)) >
                0 &&
                ` · ${session.roundCount ?? Math.ceil(session.messageCount / 2)} 轮对话`}
            </div>
          </div>
        )}
      </button>
      {!isEditing && (
        <button
          onClick={(e) => onDelete(e, session.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
          title="删除会话"
        >
          <svg
            className="w-3.5 h-3.5"
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
      )}
    </div>
  );
}

export default SessionListItem;
