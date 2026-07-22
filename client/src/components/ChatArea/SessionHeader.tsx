import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chatStore";
import type { Message } from "../../types";

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

/** 从消息中提取可搜索文本 */
function getMessageSearchText(message: Message): string {
  const parts: string[] = [];
  if (message.content)
    parts.push(typeof message.content === "string" ? message.content : "");
  if (message.blocks) {
    for (const block of message.blocks) {
      if (block.content) parts.push(block.content);
    }
  }
  if (message.error) parts.push(message.error);
  return parts.join("\n");
}

/** 导出为 Markdown */
function exportAsMarkdown(
  messages: Message[],
  labels: Record<string, string>,
): string {
  return messages
    .map((msg) => {
      const roleLabel =
        msg.role === "user"
          ? `👤 ${labels.user}`
          : msg.role === "assistant"
            ? `🤖 ${labels.assistant}`
            : msg.role === "system"
              ? `⚙️ ${labels.system}`
              : `🛠 ${labels.tool}`;
      const date = new Date(msg.timestamp).toLocaleString();
      const text = getMessageSearchText(msg);
      return `### ${roleLabel}  (${date})\n\n${text}\n`;
    })
    .join("\n---\n");
}

/** 导出为 JSON */
function exportAsJson(messages: Message[]): string {
  const cleaned = messages.map(
    ({ id, role, content, timestamp, error, tool_calls }) => ({
      id,
      role,
      content: typeof content === "string" ? content : "",
      timestamp,
      error,
      toolCalls: tool_calls,
    }),
  );
  return JSON.stringify(cleaned, null, 2);
}

function SessionHeader() {
  const { currentSession, renameSession } = useSessionStore();
  const messages = useChatStore((s) => s.messages);
  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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

  // 导出按钮点击外部关闭
  useEffect(() => {
    if (!exportOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportOpen]);

  /** 导出 Markdown */
  const handleExportMarkdown = () => {
    const md = exportAsMarkdown(messages, {
      user: t("chat.user"),
      assistant: t("chat.assistant"),
      system: t("chat.system"),
      tool: t("chat.tool"),
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  /** 导出 JSON */
  const handleExportJson = () => {
    const json = exportAsJson(messages);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
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

      {/* 右侧：导出按钮 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* 导出按钮 */}
        {currentSession && messages.length > 0 && (
          <div ref={exportRef} className="relative flex-shrink-0">
            <button
              onClick={() => setExportOpen((prev) => !prev)}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title={t("chat.exportSession")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-30">
                <button
                  onClick={handleExportMarkdown}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  导出为 Markdown
                </button>
                <button
                  onClick={handleExportJson}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t("chat.exportAsJson")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default SessionHeader;
