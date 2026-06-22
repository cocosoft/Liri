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
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const isRunning = content.includes("Running");
  const isCompleted = content.includes("completed") || content.includes("\u{2705}");

  const textColor = isRunning
    ? "text-amber-300"
    : isCompleted
      ? "text-green-400"
      : "text-blue-400";

  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5 text-xs">
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
          <span
            className="ml-0.5"
            style={STYLES.blinkCursor}
          >
            |
          </span>
        )}
      </span>
    </div>
  );
}

export default GroupStatusLine;