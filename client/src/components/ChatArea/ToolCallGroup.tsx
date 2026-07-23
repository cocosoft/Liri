/**
 * ToolCallGroup — 工具调用统一渲染组件
 *
 * 合并 ToolCallBlock（卡片式）和 ToolCallInline（行内式）的能力，
 * 通过 variant prop 控制展示形态：
 * - "inline"：行内摘要，点击展开详情面板
 * - "card"：卡片式，header + 折叠 body
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import ImageToolResult from "./ImageToolResult/ImageToolResult";
import { useChatStore } from "../../stores/chat";
import { getToolResultFull } from "../../stores/chat/chat-message.slice";
import {
  getToolDisplayName,
  getToolHumanSummary,
} from "../../utils/toolHumanSummary";
import { formatKey } from "../../utils/formatKey";
import { formatValue } from "../../utils/formatValue";

/** 图片/视频/音频等多媒体工具名列表 */
const MEDIA_TOOL_NAMES = [
  "image_generate",
  "image_svg_generate",
  "image_analysis",
  "image_display",
  "video_display",
  "audio_play",
  "canvas",
  "image",
];

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
      <div
        key={key}
        className="flex flex-wrap gap-0.5 items-baseline text-[10px] leading-relaxed"
      >
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
          <span className="text-gray-200 break-words whitespace-pre-wrap">
            {formattedValue}
          </span>
        )}
      </div>
    );
  });
}

/** JSON 结果安全截断上限 */
const MAX_RESULT_JSON_LENGTH = 50000;

/**
 * 安全渲染工具调用 JSON 结果
 * 超长时截断，避免渲染巨大 JSON 字符串导致浏览器 OOM
 */
function ToolResultJson({ result }: { result: unknown }) {
  const jsonStr = JSON.stringify(result, null, 2);
  if (jsonStr.length <= MAX_RESULT_JSON_LENGTH) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-1 rounded max-h-[200px] overflow-y-auto">
        {jsonStr}
      </pre>
    );
  }
  return (
    <div className="text-[10px]">
      <div className="text-amber-400 mb-1">
        ⚠️ 结果过大（{(jsonStr.length / 1024).toFixed(0)} KB），截断显示
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-1 rounded max-h-[200px] overflow-y-auto">
        {jsonStr.slice(0, 3000)}
      </pre>
      <div className="text-amber-500 mt-1">
        ... 剩余 {(jsonStr.length - 3000).toLocaleString()} 字符未显示 ...
      </div>
    </div>
  );
}

function ToolCallGroup({
  toolCall,
  isStreaming,
  variant = "card",
  onExpand,
}: ToolCallGroupProps) {
  const { t } = useTranslation();
  const isMediaTool = MEDIA_TOOL_NAMES.includes(toolCall.name);
  // 多媒体展示工具（预览图片/视频/音频）默认展开，用户明确要求查看
  const [expanded, setExpanded] = useState(
    toolCall.name === "image_display" ||
      toolCall.name === "video_display" ||
      toolCall.name === "audio_play",
  );
  const [showFullResult, setShowFullResult] = useState(false);
  const prevStreaming = useRef(isStreaming);
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;
    // 多媒体展示工具不自动折叠 — 图片/视频/音频结果是用户要看的，不应隐藏
    if (
      wasStreaming &&
      !isStreaming &&
      variant === "card" &&
      toolCall.name !== "image_display" &&
      toolCall.name !== "video_display" &&
      toolCall.name !== "audio_play"
    ) {
      setExpanded(false);
    }
  }, [isStreaming, variant, toolCall.name]);

  const statusIcon = isStreaming
    ? "\u23F3"
    : toolCall.status === "completed"
      ? "\u2705"
      : toolCall.status === "failed"
        ? "\u274C"
        : "\u{1F527}";

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
        <div className="mb-0.5">
          <div className="text-[10px] font-semibold text-[#565f89] uppercase tracking-wider mb-0.5">
            {t("chat.parameters")}
          </div>
          <div className="flex flex-col gap-0.5">
            {formatArgumentsNatural(
              toolCall.arguments as Record<string, unknown>,
              readFileToPreview,
            )}
          </div>
        </div>
      )}
      {toolCall.result !== undefined && (
        <div>
          <div className="text-[10px] font-semibold text-[#565f89] uppercase tracking-wider mb-0.5">
            {t("chat.result")}
          </div>
          {isMediaTool ? (
            <ImageToolResult toolCall={toolCall} />
          ) : showFullResult && toolCall._hasFullResult ? (
            <div>
              <div className="text-[10px] text-amber-400 mb-1">
                ✅ 已展开完整结果（{typeof toolCall.result === "string" ? (toolCall.result.length + getToolResultFull(toolCall.id)!.length).toLocaleString() : "?"} 字符）
              </div>
              <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-2 rounded max-h-[400px] overflow-y-auto">
                {typeof toolCall.result === "string" ? toolCall.result + "\n\n" + (getToolResultFull(toolCall.id) || "") : JSON.stringify(toolCall.result, null, 2)}
              </pre>
              <button
                onClick={() => setShowFullResult(false)}
                className="mt-1 text-[10px] text-amber-400 hover:text-amber-300 underline"
              >
                ▲ {t("chat.collapse")}
              </button>
            </div>
          ) : typeof toolCall.result === "string" ? (
            <div>
              <MarkdownRenderer
                content={toolCall.result}
                onPreviewFile={readFileToPreview}
              />
              {toolCall._hasFullResult && (
                <button
                  onClick={() => setShowFullResult(true)}
                  className="mt-1 text-[10px] text-amber-400 hover:text-amber-300 underline"
                >
                  ▼ {t("chat.expandFullResult")}
                </button>
              )}
            </div>
          ) : (
            <ToolResultJson result={toolCall.result} />
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
          style={{
            background: "transparent",
            border: "none",
            color: "#a9b1d6",
          }}
        >
          <span className="shrink-0">{statusIcon}</span>
          <span className="min-w-0 truncate">
            {humanSummary || displayName}
          </span>
          {isStreaming && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse shrink-0" />
          )}
          <span className="text-[10px] shrink-0 ml-auto">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        </button>
        {expanded && (
          <div
            className="border-t border-gray-400/[0.1] px-2.5 py-1"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            {detailContent}
          </div>
        )}
      </div>
    );
  }

  // variant === "card"（默认）
  return (
    <div className="border border-gray-400/20 rounded-lg overflow-hidden mb-0">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 px-2 py-0.5 w-full cursor-pointer text-[#a9b1d6] text-[12px] text-left"
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
        <span className="text-[10px] shrink-0">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
      </button>
      {expanded && (
        <div className="px-2 py-1 border-t border-gray-400/10">
          {detailContent}
        </div>
      )}
    </div>
  );
}

export default ToolCallGroup;
