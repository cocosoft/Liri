/**
 * ToolCallGroup — 工具调用统一渲染组件
 *
 * 合并 ToolCallBlock（卡片式）和 ToolCallInline（行内式）的能力，
 * 通过 variant prop 控制展示形态：
 * - "inline"：行内摘要，点击展开详情面板
 * - "card"：卡片式，header + 折叠 body
 */
import { useState, useRef, useEffect } from "react";
import type { ToolCall } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chatStore";
import { getToolDisplayName, getToolHumanSummary } from "../../utils/toolHumanSummary";
import { formatKey } from "../../utils/formatKey";
import { formatValue } from "../../utils/formatValue";

interface ToolCallGroupProps {
  toolCall: ToolCall;
  isStreaming?: boolean;
  variant?: "inline" | "card";
  onExpand?: (toolCall: ToolCall) => void;
}

/**
 * 以自然语言格式展示参数
 */
function formatArgumentsNatural(
  args: Record<string, unknown>,
  onPreviewFile?: (path: string) => void,
): React.ReactNode[] {
  const entries = Object.entries(args);
  if (entries.length === 0) return [];

  return entries.map(([key, value]) => {
    const label = formatKey(key);
    const formattedValue = formatValue(key, value);
    const isFilePathKey =
      key === "file_path" || key === "path" || key === "filePath";

    return (
      <div key={key} className="flex flex-wrap gap-1.5 items-baseline text-[10px] leading-relaxed">
        <span className="text-[#7aa2f7] font-medium shrink-0">{label}:</span>
        {isFilePathKey && onPreviewFile && typeof value === "string" ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onPreviewFile(value);
            }}
            className="text-[#7aa2f7] underline cursor-pointer"
          >
            {formattedValue}
          </a>
        ) : (
          <span className="text-gray-200 break-words whitespace-pre-wrap">{formattedValue}</span>
        )}
      </div>
    );
  });
}

function ToolCallGroup({ toolCall, isStreaming, variant = "card", onExpand }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const prevStreaming = useRef(isStreaming);
  const { readFileToPreview } = useChatStore();

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;
    if (wasStreaming && !isStreaming && variant === "card") {
      setExpanded(false);
    }
  }, [isStreaming, variant]);

  const statusIcon = isStreaming
    ? "\u23F3"
    : toolCall.status === "completed"
      ? "\u2705"
      : toolCall.status === "failed"
        ? "\u274C"
        : "\u{1F527}";

  const statusColor = isStreaming
    ? "#e6c384"
    : toolCall.status === "completed"
      ? "#9ece6a"
      : toolCall.status === "failed"
        ? "#f7768e"
        : "#7aa2f7";

  const humanSummary = getToolHumanSummary(toolCall);
  const displayName = getToolDisplayName(toolCall.name);

  const handleToggle = () => {
    setExpanded(!expanded);
    if (onExpand && !expanded) {
      onExpand(toolCall);
    }
  };

  /** 详情面板内容（卡片和行内共用） */
  const detailContent = (
    <>
      {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
        <div className="mb-1.5">
          <div className="text-[10px] font-semibold text-[#565f89] uppercase tracking-wider mb-1">参数</div>
          <div className="flex flex-col gap-1">
            {formatArgumentsNatural(
              toolCall.arguments as Record<string, unknown>,
              readFileToPreview,
            )}
          </div>
        </div>
      )}
      {toolCall.result !== undefined && (
        <div>
          <div className="text-[10px] font-semibold text-[#565f89] uppercase tracking-wider mb-1">结果</div>
          {typeof toolCall.result === "string" ? (
            <MarkdownRenderer content={toolCall.result} onPreviewFile={readFileToPreview} />
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-1.5 rounded max-h-[200px] overflow-y-auto">
              {JSON.stringify(toolCall.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </>
  );

  if (variant === "inline") {
    return (
      <div className="tool-call-inline">
        <button
          onClick={handleToggle}
          className="flex items-center gap-2 px-2 py-1 w-full text-left text-[12px] cursor-pointer transition-colors hover:bg-gray-400/[0.05]"
          style={{ background: "transparent", border: "none", color: "#a9b1d6" }}
        >
          <span className="shrink-0">{statusIcon}</span>
          <span className="min-w-0 truncate">{humanSummary || displayName}</span>
          {isStreaming && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse shrink-0" />
          )}
          <span
            className="text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-auto"
            style={{ background: statusColor, color: "#1a1b26" }}
          >
            {isStreaming ? "执行中" : toolCall.status || "完成"}
          </span>
          <span className="text-[10px] shrink-0">{expanded ? "\u25BC" : "\u25B6"}</span>
        </button>
        {expanded && (
          <div className="border-t border-gray-400/[0.1] px-3 py-2" style={{ background: "rgba(0,0,0,0.05)" }}>
            {detailContent}
          </div>
        )}
      </div>
    );
  }

  // variant === "card"（默认）
  return (
    <div className="border border-gray-400/20 rounded-lg overflow-hidden mb-1.5">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-2.5 py-1 w-full cursor-pointer text-[#a9b1d6] text-[12px] text-left"
        style={{ background: "rgba(128, 128, 128, 0.05)", border: "none" }}
      >
        <span>{statusIcon}</span>
        <span className="flex-1 font-medium text-gray-200 overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {displayName}
        </span>
        {humanSummary && (
          <span className="text-[#565f89] text-[11px] overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px] shrink">
            {humanSummary}
          </span>
        )}
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
          style={{ background: statusColor, color: "#1a1b26" }}
        >
          {isStreaming ? "running" : toolCall.status || "completed"}
        </span>
        <span className="text-[10px] shrink-0">{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>
      {expanded && (
        <div className="px-2.5 py-1.5 border-t border-gray-400/10">
          {detailContent}
        </div>
      )}
    </div>
  );
}

export default ToolCallGroup;
