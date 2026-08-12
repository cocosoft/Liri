import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chat";
import { sessionService } from "../../services/sessionService";
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
  // P0 修复（1.2）：thinking 块前置输出，导出顺序符合"思考在前、正文在后"的阅读习惯
  if (message.blocks) {
    for (const block of message.blocks) {
      if (block.type !== "thinking" || !block.content) continue;
      parts.push(`💭 [思考中]\n${String(block.content)}`);
    }
  }
  if (message.content)
    parts.push(typeof message.content === "string" ? message.content : "");
  if (message.blocks) {
    for (const block of message.blocks) {
      if (block.type === "thinking" || !block.content) continue;
      // P2-2: 与 ChatMessage/ChatMessageList 渲染去重逻辑一致——
      // content 已包含的文本块不重复导出，避免"流式累积文本 + 最终快照"双源重复
      if (
        typeof message.content === "string" &&
        message.content.includes(String(block.content))
      ) {
        continue;
      }
      const prefix =
        block.type === "tool_call"
          ? `🔧 [工具调用: ${block.toolCall?.name || "unknown"}]\n`
          : block.type === "status" && (block.toolCallId || block.toolCall)
            ? "📋 [工具结果]\n"
            : block.type === "task_decomposition"
              ? "📝 [任务分解]\n"
              : block.type === "progress"
                ? "📊 [进度]\n"
                : "";
      parts.push(prefix + String(block.content));
    }
  }
  if (message.error) parts.push(`❌ [错误]: ${message.error}`);
  return parts.join("\n");
}

/** 导出为 Markdown（含思考、工具调用、blocks 标识） */
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
      // 1.6：助手消息有 startedAt 时显示开始时间与耗时（区分流式开始/完成）
      const timeInfo =
        msg.role === "assistant" && msg.startedAt
          ? `（开始 ${new Date(msg.startedAt).toLocaleString()} · 耗时 ${(
              (msg.timestamp - msg.startedAt) /
              1000
            ).toFixed(1)}s）`
          : "";
      const text = getMessageSearchText(msg);
      const usageInfo = msg.usage
        ? `\n> 📊 Token: 输入 ${msg.usage.inputTokens ?? "?"} / 输出 ${msg.usage.outputTokens ?? "?"} / 缓存读 ${msg.usage.cacheReadTokens ?? "0"}`
        : "";
      return `### ${roleLabel}  (${date}${timeInfo})\n\n${text}${usageInfo}\n`;
    })
    .join("\n---\n");
}

/** 导出为 JSON（含 blocks、usage、metadata 完整信息） */
function exportAsJson(messages: Message[]): string {
  const cleaned = messages.map((msg) => {
    const blocksDetail = (msg.blocks || []).map((b) => ({
      type: b.type,
      content:
        typeof b.content === "string"
          ? b.content.substring(0, 5000)
          : b.content,
      toolName: b.toolCall?.name,
      toolCallId: b.toolCallId,
      status: b.status,
      isStreaming: b.isStreaming,
    }));
    return {
      id: msg.id,
      role: msg.role,
      timestamp: msg.timestamp,
      // 1.6：流式开始时间随 JSON 导出
      startedAt: msg.startedAt,
      content: typeof msg.content === "string" ? msg.content : "",
      blocks: blocksDetail,
      toolCalls: msg.tool_calls,
      usage: msg.usage,
      error: msg.error,
      agentName: msg.agentName,
      replyToId: msg.replyToId,
      metadata: msg.metadata,
    };
  });
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
  const [exporting, setExporting] = useState(false);
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

  /** 导出前统一从持久层拉取最新消息（P0 修复 1.7：两次导出内容一致，不依赖内存快照） */
  const resolveExportMessages = async (): Promise<Message[]> => {
    if (!currentSession) return messages;
    try {
      const persisted = await sessionService.getMessages(currentSession.id);
      // 持久层为空时回退内存（断网/未落盘兜底，避免导出空文件）
      return persisted.length > 0 ? persisted : messages;
    } catch {
      return messages;
    }
  };

  /** 导出 Markdown */
  const handleExportMarkdown = async () => {
    setExporting(true);
    try {
      const source = await resolveExportMessages();
      const md = exportAsMarkdown(source, {
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
    } finally {
      setExporting(false);
    }
    setExportOpen(false);
  };

  /** 导出 JSON */
  const handleExportJson = async () => {
    setExporting(true);
    try {
      const source = await resolveExportMessages();
      const json = exportAsJson(source);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
    setExportOpen(false);
  };

  return (
    // #20 修复：header 补 relative——详情面板 absolute top-full 需以其为定位基准
    <header className="relative bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {currentSession ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-gray-400 flex-shrink-0">💬</span>
              {isEditing ? (
                <input
                  type="text"
                  id="session-title-input"
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
              {exporting ? (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : (
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
              )}
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
