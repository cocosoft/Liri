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
import InlineApprovalActions from "./InlineApprovalActions";
import { useChatStore } from "../../stores/chat";
import { getToolResultFull } from "../../stores/chat/chat-message.slice";
// 2026-11-17：审批已落定（已处理/已过期）时收起工具卡的等待徽标与就地审批按钮
import { resolvedApprovalInboxIds } from "../../stores/chat/chat-message-shared";
import {
  getToolDisplayName,
  getToolHumanSummary,
  isMediaDisplayToolName,
  isMediaToolName,
  stripDuplicateToolPrefix,
} from "../../utils/toolHumanSummary";
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
      <div
        key={key}
        className="flex flex-wrap gap-0.5 items-baseline text-[10px] leading-relaxed"
      >
        <span className="text-blue-600 dark:text-[#7aa2f7] font-medium shrink-0">
          {label}:
        </span>
        {isFilePathKey && onPreviewFile && typeof value === "string" ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onPreviewFile(value);
            }}
            className="text-blue-600 dark:text-[#7aa2f7] underline cursor-pointer"
          >
            {formattedValue}
          </a>
        ) : (
          <span className="text-gray-700 dark:text-gray-200 break-words whitespace-pre-wrap">
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
  const { t } = useTranslation();
  const jsonStr = JSON.stringify(result, null, 2);
  // P1-14（2026-09-27 审计）：截断后原本无出口（字符串结果有"展开完整结果"，对象结果没有）
  const [copied, setCopied] = useState(false);
  if (jsonStr.length <= MAX_RESULT_JSON_LENGTH) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-gray-700 dark:text-[#a9b1d6] font-mono bg-gray-100 dark:bg-black/15 p-1 rounded max-h-[200px] overflow-y-auto">
        {jsonStr}
      </pre>
    );
  }
  return (
    <div className="text-[10px]">
      <div className="text-amber-600 dark:text-amber-400 mb-1">
        {t("chat.resultTooLarge", {
          kb: (jsonStr.length / 1024).toFixed(0),
          defaultValue: "⚠️ 结果过大（{{kb}} KB），截断显示",
        })}
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-gray-700 dark:text-[#a9b1d6] font-mono bg-gray-100 dark:bg-black/15 p-1 rounded max-h-[200px] overflow-y-auto">
        {jsonStr.slice(0, 3000)}
      </pre>
      <div className="text-amber-600 dark:text-amber-500 mt-1 flex items-center gap-2 flex-wrap">
        <span>
          {t("chat.remainingChars", {
            count: (jsonStr.length - 3000).toLocaleString(),
            defaultValue: "... 剩余 {{count}} 字符未显示 ...",
          })}
        </span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(jsonStr);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // @ignore-catch — 剪贴板不可用：保持提示
            }
          }}
          className="px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-400/10 transition-colors"
        >
          {copied
            ? t("chat.copiedFullResult", "✓ 已复制完整结果")
            : t("chat.copyFullResult", "复制完整结果")}
        </button>
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
  const isMediaTool = isMediaToolName(toolCall.name);
  // 多媒体展示工具（预览图片/视频/音频）默认展开，用户明确要求查看
  const isMediaDisplay = isMediaDisplayToolName(toolCall.name);
  const [expanded, setExpanded] = useState(isMediaDisplay);
  const [showFullResult, setShowFullResult] = useState(false);
  const prevStreaming = useRef(isStreaming);
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);
  /**
   * 2026-11-17（用户实测）：审批已处理/已过期后，工具卡仍显示「⏳ 等待审批」+ 就地审批按钮，
   * 点下去只会得到「已过期」。按 `inboxId` 与该卡的实际状态对账：已落定则不再按等待渲染。
   */
  const messages = useChatStore((s) => s.messages);
  const approvalResolved =
    toolCall.pendingApproval === true &&
    typeof toolCall.inboxId === "string" &&
    resolvedApprovalInboxIds(messages).has(toolCall.inboxId);
  /** 仍有效的「等待审批」态（残留标记已落定 ⇒ false） */
  const awaitingApproval =
    toolCall.pendingApproval === true && !approvalResolved;

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;
    // 多媒体展示工具不自动折叠 — 图片/视频/音频结果是用户要看的，不应隐藏
    if (wasStreaming && !isStreaming && variant === "card" && !isMediaDisplay) {
      setExpanded(false);
    }
  }, [isStreaming, variant, isMediaDisplay]);

  const statusIcon = isStreaming
    ? "\u23F3"
    : awaitingApproval
      ? "\u23F3"
      : toolCall.status === "completed"
        ? "\u2705"
        : toolCall.status === "failed"
          ? "\u274C"
          : // 2026-11-24：审批已落定但没有终态结果 ⇒ 中断（而非"未知工具"扳手图标）
            toolCall.approvalStatus
            ? "\u23F8"
            : "\u{1F527}";

  /** P2-2: 审批等待态徽标（区别于失败红色）；审批已落定 ⇒ 不再显示 */
  const pendingBadge = awaitingApproval ? (
    <span className="shrink-0 rounded bg-amber-400/20 px-1 py-0.5 text-[10px] text-amber-300">
      ⏳ {t("chat.pendingApproval")}
    </span>
  ) : null;

  const humanSummary = getToolHumanSummary(toolCall);
  const displayName = getToolDisplayName(toolCall.name);
  // #29（2026-10-30）：摘要与标题重复前缀只保留一份（"任务管理 管理任务" → "管理任务"）
  const summary = stripDuplicateToolPrefix(displayName, humanSummary);

  /** U-06-5: 审批等待且带 Inbox 项 id ⇒ 工具卡片就地审批（审批已落定 ⇒ 不再显示） */
  const approvalBar =
    awaitingApproval && toolCall.inboxId ? (
      <div className="px-2 py-1 border-t border-amber-400/20 bg-amber-400/[0.04]">
        <InlineApprovalActions inboxId={toolCall.inboxId} />
      </div>
    ) : null;

  const handleToggle = () => {
    setExpanded(!expanded);
    if (onExpand && !expanded) {
      onExpand(toolCall);
    }
  };

  /** 详情面板内容（卡片和行内共用） */
  const detailContent = (
    <>
      {/* 2026-11-24：审批已落定但没有终态结果 —— 说明为什么没有产物（避免占位文案被读成"仍在等待"） */}
      {toolCall.approvalStatus && (
        <div className="mb-1 text-[10px] text-amber-600 dark:text-amber-400">
          {toolCall.approvalStatus === "expired"
            ? t("chat.approvalExpiredNotExecuted", "审批已过期，该调用未执行")
            : t(
                "chat.approvalResolvedNoResult",
                "审批已处理，但本次调用没有执行结果",
              )}
        </div>
      )}
      {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
        <div className="mb-0.5">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-[#565f89] uppercase tracking-wider mb-0.5">
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
          <div className="text-[10px] font-semibold text-gray-500 dark:text-[#565f89] uppercase tracking-wider mb-0.5">
            {t("chat.result")}
          </div>
          {isMediaTool ? (
            <ImageToolResult toolCall={toolCall} />
          ) : showFullResult && toolCall._hasFullResult ? (
            <div>
              <div className="text-[10px] text-amber-600 dark:text-amber-400 mb-1">
                {t("chat.expandedFullResult", {
                  count:
                    typeof toolCall.result === "string"
                      ? (
                          toolCall.result.length +
                          (getToolResultFull(toolCall.id)?.length ?? 0)
                        ).toLocaleString()
                      : "?",
                  defaultValue: "✅ 已展开完整结果（{{count}} 字符）",
                })}
              </div>
              <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-gray-700 dark:text-[#a9b1d6] font-mono bg-gray-100 dark:bg-black/15 p-2 rounded max-h-[400px] overflow-y-auto">
                {typeof toolCall.result === "string"
                  ? toolCall.result +
                    "\n\n" +
                    (getToolResultFull(toolCall.id) || "")
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
              <button
                onClick={() => setShowFullResult(false)}
                className="mt-1 text-[10px] text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 underline"
              >
                ▲ {t("chat.collapse")}
              </button>
            </div>
          ) : typeof toolCall.result === "string" ? (
            <div>
              {/* 2026-11-24（多级树）：结果默认限高，避免展开一条命令就把整屏占满；
                  内容不丢，可在框内滚动查看 */}
              <div className="max-h-[240px] overflow-y-auto pr-1">
                <MarkdownRenderer
                  content={toolCall.result}
                  onPreviewFile={readFileToPreview}
                />
              </div>
              {toolCall._hasFullResult && (
                <button
                  onClick={() => setShowFullResult(true)}
                  className="mt-1 text-[10px] text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 underline"
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
    /**
     * 2026-11-24（多级树）：有参数或结果才可展开 —— 无详情的行不再显示可点的箭头
     * （原实现每行都带 ▶，点开是空面板，像"坏了"）。
     */
    const hasArguments =
      !!toolCall.arguments && Object.keys(toolCall.arguments).length > 0;
    const hasDetail = hasArguments || toolCall.result !== undefined;
    return (
      <div className="tool-call-inline">
        <button
          onClick={hasDetail ? handleToggle : undefined}
          disabled={!hasDetail}
          title={hasDetail ? undefined : summary || displayName}
          className={`flex items-center gap-1.5 px-2 py-1 w-full text-left text-[12px] transition-colors text-gray-600 dark:text-[#a9b1d6] ${
            hasDetail
              ? "cursor-pointer hover:bg-gray-400/[0.05]"
              : "cursor-default"
          }`}
          style={{
            background: "transparent",
            border: "none",
          }}
        >
          <span className="shrink-0">{statusIcon}</span>
          {pendingBadge}
          <span className="shrink-0 font-medium text-gray-800 dark:text-gray-200">
            {displayName}
          </span>
          {summary && summary !== displayName && (
            <span className="min-w-0 truncate text-gray-500 dark:text-[#565f89]">
              — {summary}
            </span>
          )}
          {isStreaming && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse shrink-0" />
          )}
          {hasDetail && (
            <span className="text-[10px] shrink-0 ml-auto">
              {expanded ? "\u25BC" : "\u25B6"}
            </span>
          )}
        </button>
        {approvalBar}
        {expanded && hasDetail && (
          // 第 3 级：参数 / 结果（缩进 + 导轨，视觉上附属于上一条命令）
          <div className="ml-3 border-l border-gray-300 dark:border-gray-600 pl-2.5 pr-1 py-1">
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
        className="flex items-center gap-1 px-2 py-0.5 w-full cursor-pointer text-gray-600 dark:text-[#a9b1d6] text-[12px] text-left"
        style={{ background: "rgba(128, 128, 128, 0.05)", border: "none" }}
      >
        <span>{statusIcon}</span>
        {pendingBadge}
        <span className="flex-1 font-medium text-gray-800 dark:text-gray-200 overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {displayName}
        </span>
        {summary && (
          <span className="text-gray-500 dark:text-[#565f89] text-[11px] overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px] shrink">
            {summary}
          </span>
        )}
        <span className="text-[10px] shrink-0">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
      </button>
      {approvalBar}
      {expanded && (
        <div className="px-2 py-1 border-t border-gray-400/10">
          {detailContent}
        </div>
      )}
    </div>
  );
}

export default ToolCallGroup;
