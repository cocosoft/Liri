import { memo, useCallback } from "react";
import { SpanList } from "./SpanList";
import type { SanitizedSpan, GroupedTrace } from "./utils";

interface TraceCardProps {
  trace: GroupedTrace;
  expanded: boolean;
  onToggle: () => void;
  searchQuery: string;
  viewMode: "tree" | "waterfall";
  isDark?: boolean;
  highlightedSpanId?: string;
  onSpanClick: (span: SanitizedSpan) => void;
}

export const TraceCard = memo(function TraceCard({
  trace,
  expanded,
  onToggle,
  searchQuery,
  viewMode,
  isDark,
  highlightedSpanId,
  onSpanClick,
}: TraceCardProps) {
  const colorDot = {
    ok: "🟢",
    warning: "🟡",
    error: "🔴",
    empty: "⚪",
  }[trace.status];

  const totalDuration = formatDuration(trace.totalDurationMs);
  const traceIdShort = trace.traceId.slice(0, 12);
  const orphanBadge = trace.hasOrphans ? " ❗不完全" : "";

  const copyTraceId = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(trace.traceId).catch(() => {});
    },
    [trace.traceId],
  );

  const bgCard = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div
      className={`rounded-lg border ${bgCard} mb-2 overflow-hidden transition-opacity ${
        expanded ? "" : "opacity-60"
      }`}
    >
      {/* Title bar */}
      <div
        className={`px-4 py-2.5 flex items-center gap-2 cursor-pointer select-none border-b ${
          isDark
            ? "border-gray-700 hover:bg-gray-750"
            : "border-gray-100 hover:bg-gray-50"
        }`}
        onClick={onToggle}
      >
        <span className="text-xs font-mono">{expanded ? "▾" : "▸"}</span>
        <span>{colorDot}</span>
        <span
          className={`text-sm font-mono ${textPrimary} cursor-pointer hover:underline`}
          onClick={copyTraceId}
          title="点击复制 TraceId"
        >
          {traceIdShort}
        </span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${
            isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"
          }`}
        >
          {trace.moduleLabel}
        </span>
        <span className={`text-xs ${textSecondary}`}>
          ({trace.spans.length} spans, {totalDuration})
        </span>
        {trace.errorCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400 font-medium">
            ⚠ {trace.errorCount}
          </span>
        )}
        {orphanBadge && (
          <span
            className="text-xs text-gray-400"
            title="部分父 Span 已不在缓冲区"
          >
            {orphanBadge}
          </span>
        )}
      </div>

      {/* Span list */}
      {expanded &&
        (trace.spans.length === 0 ? (
          <div className={`px-4 py-2 text-xs ${textSecondary}`}>(已淘汰)</div>
        ) : (
          <SpanList
            spans={trace.spans}
            viewMode={viewMode}
            isDark={isDark}
            highlightedSpanId={highlightedSpanId}
            searchQuery={searchQuery}
            onSpanClick={onSpanClick}
          />
        ))}
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
