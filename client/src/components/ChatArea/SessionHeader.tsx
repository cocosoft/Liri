import { useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";

/** 格式化日期为 yyyy-MM-dd HH:mm */
function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "-";
  }
}

function SessionHeader() {
  const { currentSession, renameSession } = useSessionStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDoubleClick = () => {
    if (currentSession) {
      setEditTitle(currentSession.title);
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    if (
      editTitle.trim() &&
      currentSession &&
      editTitle !== currentSession.title
    ) {
      renameSession(currentSession.id, editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  const handleCopyId = () => {
    if (currentSession) {
      navigator.clipboard.writeText(currentSession.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {currentSession ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-gray-400 flex-shrink-0">💬</span>
              {isEditing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ width: "200px" }}
                />
              ) : (
                <h2
                  onClick={() => setShowInfo(!showInfo)}
                  onDoubleClick={handleDoubleClick}
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                  title="单击查看详情 · 双击编辑标题"
                >
                  {currentSession.title}
                </h2>
              )}
              {!isEditing && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {currentSession.roundCount} 轮对话
                  </span>
                  <button
                    onClick={handleCopyId}
                    className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                    title="复制会话 ID"
                  >
                    {copied ? "✅" : "📋"}
                  </button>
                </div>
              )}
            </div>

            {/* 展开的会话属性面板 */}
            {showInfo && !isEditing && (
              <div className="absolute top-full left-4 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-400 space-y-1.5 min-w-[200px]">
                <div className="flex justify-between gap-4">
                  <span>创建时间</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.createdAt
                      ? formatDateTime(currentSession.createdAt)
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>最后更新</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.updatedAt
                      ? formatDateTime(currentSession.updatedAt)
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>对话轮次</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.roundCount}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>消息总数</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.messageCount}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>会话 ID</span>
                  <span className="text-gray-500 font-mono max-w-[120px] truncate">
                    {currentSession.id.slice(0, 12)}...
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            选择会话或创建新会话
          </span>
        )}
      </div>
    </header>
  );
}

export default SessionHeader;
