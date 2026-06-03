import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../../stores/sessionStore";

/**
 * 会话历史侧边栏组件
 * 位于聊天界面左侧，展示当前用户的所有会话记录。
 * 支持新建、切换、重命名、删除会话，可折叠/展开。
 */
function SessionHistorySidebar() {
  const navigate = useNavigate();
  const {
    sessions,
    currentSession,
    loadSessions,
    createSession,
    switchSession,
    deleteSession,
    clearAllSessions,
  } = useSessionStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleNewSession = async () => {
    const title = `新会话 ${sessions.length + 1}`;
    await createSession(title);
    navigate("/chat");
  };

  const handleSwitchSession = (id: string) => {
    switchSession(id);
    navigate("/chat");
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const session = sessions.find((s) => s.id === id);
    if (confirm(`确定要删除会话 "${session?.title || "未命名会话"}" 吗？`)) {
      deleteSession(id);
    }
  };

  const handleDoubleClick = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const handleRenameBlur = () => {
    if (editingId && editTitle.trim()) {
      const store = useSessionStore.getState();
      const session = store.sessions.find((s) => s.id === editingId);
      if (session && editTitle.trim() !== session.title) {
        store.renameSession(editingId, editTitle.trim());
      }
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameBlur();
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditTitle("");
    }
  };

  const handleClearAll = () => {
    if (confirm("确定要清除所有会话记录吗？此操作不可恢复。")) {
      clearAllSessions();
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (diffDays === 1) return "昨天";
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  if (!isExpanded) {
    return (
      <div className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-12">
        <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-center">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="展开会话历史"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center py-2 gap-2">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          {sessions.length > 0 && (
            <span className="text-xs text-gray-400">{sessions.length}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-60">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          会话历史
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewSession}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="新建会话"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="收起侧边栏"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <svg
              className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <p className="text-sm text-gray-400 dark:text-gray-500">暂无会话</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
              创建新会话开始聊天
            </p>
          </div>
        )}

        {sessions.map((session) => {
          const isActive = currentSession?.id === session.id;
          return (
            <div
              key={session.id}
              className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors group ${
                isActive
                  ? "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400"
                  : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
              }`}
            >
              <button
                onClick={() => handleSwitchSession(session.id)}
                onDoubleClick={() =>
                  handleDoubleClick(session.id, session.title)
                }
                className="flex-1 flex items-center gap-2 truncate text-left min-w-0"
              >
                <span className="flex-shrink-0">💬</span>
                {editingId === session.id ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={handleRenameBlur}
                    onKeyDown={handleRenameKeyDown}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 text-sm w-full outline-none"
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      {session.title || "未命名会话"}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {formatTime(session.updatedAt)}
                      {session.messageCount > 0 &&
                        ` · ${session.messageCount} 条消息`}
                    </div>
                  </div>
                )}
              </button>
              {editingId !== session.id && (
                <button
                  onClick={(e) => handleDeleteSession(e, session.id)}
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
        })}
      </div>

      {sessions.length > 0 && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClearAll}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
            清除全部会话
          </button>
        </div>
      )}
    </div>
  );
}

export default SessionHistorySidebar;
