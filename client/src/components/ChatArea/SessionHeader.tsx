import { useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";

function SessionHeader() {
  const { currentSession, renameSession } = useSessionStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");

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

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {currentSession ? (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">💬</span>
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
                onDoubleClick={handleDoubleClick}
                className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="双击编辑标题"
              >
                {currentSession.title}
              </h2>
            )}
          </div>
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
