import { STYLES } from "../../styles/animations";

/**
 * 组内状态行组件
 *
 * 在 ToolExecutionGroup 面板内显示单行状态文本，
 * 根据内容自动判断运行中 / 已完成 / 普通状态，不产生独立卡片边框。
 */
function GroupStatusLine({
  content,
  isStreaming,
  status,
}: {
  content: string;
  isStreaming?: boolean;
  /** L3（2026-08-23）：结构化状态标记（tool_running/tool_completed/tool_failed） */
  status?: string;
}) {
  // L3 修复（2026-08-23，CS02）：优先用结构化 statusType 标记判断，
  // 回退字符串匹配仅用于兼容无标记的存量内容（历史事件）
  const isRunning = status
    ? status === "tool_running" || status.includes("running")
    : content.includes("Running");
  const isCompleted = status
    ? status === "tool_completed" || status.includes("completed")
    : content.includes("completed") || content.includes("\u{2705}");

  const textColor = isRunning
    ? "text-amber-300"
    : isCompleted
      ? "text-green-400"
      : "text-blue-400";

  return (
    <div className="flex items-center gap-1 px-1 py-0.5 text-xs">
      <span className="text-[11px] shrink-0 w-3.5 text-center">
        {isRunning ? (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
        ) : isCompleted ? (
          "\u2713"
        ) : (
          "\u00B7"
        )}
      </span>
      <span
        className={`flex-1 text-left ${textColor} ${isRunning ? "italic" : ""}`}
      >
        {content}
        {isStreaming && (
          <span className="ml-0.5" style={STYLES.blinkCursor}>
            |
          </span>
        )}
      </span>
    </div>
  );
}

export default GroupStatusLine;
