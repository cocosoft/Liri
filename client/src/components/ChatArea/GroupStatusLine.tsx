import { STYLES } from "../../styles/animations";

/**
 * 组内状态行组件
 *
 * 在 ToolExecutionGroup 面板内显示单行状态文本，
 * 根据内容自动判断运行中 / 已完成 / 普通状态，不产生独立卡片边框。
 */
/** 结构化状态取值（CS02：状态判定只认标记，禁止字符串匹配内容/模糊 includes） */
const RUNNING_STATUSES = new Set(["tool_running"]);
const COMPLETED_STATUSES = new Set(["tool_completed", "completed"]);

function GroupStatusLine({
  content,
  isStreaming,
  status,
}: {
  content: string;
  isStreaming?: boolean;
  /** L3（2026-08-23）：结构化状态标记（tool_running/tool_completed） */
  status?: string;
}) {
  // P1-16（2026-09-27 审计，CS02）：原实现对 `content` 做 `includes("Running")`、
  // 对 `status` 做模糊 `includes(...)` ⇒ 属字符串匹配做状态判断（脆弱且违反 CS02）。
  // 现只按**结构化 status 精确匹配**；缺标记时退化为"中性"（不再猜测内容语义）。
  const isRunning = status !== undefined && RUNNING_STATUSES.has(status);
  const isCompleted = status !== undefined && COMPLETED_STATUSES.has(status);

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
