import { memo } from "react";
import type { GroupedTrace } from "./utils";
import { countErrors } from "./utils";

interface TraceStatsBarProps {
  totalSpans: number;
  traces: GroupedTrace[];
  bufferSize: number;
  bufferMax: number;
  isDark?: boolean;
}

export const TraceStatsBar = memo(function TraceStatsBar({
  totalSpans,
  traces,
  bufferSize,
  bufferMax,
  isDark,
}: TraceStatsBarProps) {
  const errorCount = countErrors(traces);
  const avgSpanMs =
    totalSpans > 0
      ? Math.round(
          traces.reduce((s, t) => s + t.totalDurationMs, 0) / totalSpans,
        )
      : 0;
  const avgTraceMs =
    traces.length > 0
      ? Math.round(
          traces.reduce((s, t) => s + t.totalDurationMs, 0) / traces.length,
        )
      : 0;
  const bufferPct = bufferMax > 0 ? (bufferSize / bufferMax) * 100 : 0;

  const bufferColor =
    bufferPct < 60
      ? "bg-green-500"
      : bufferPct < 85
        ? "bg-yellow-500"
        : "bg-red-500";

  const textPrimary = isDark ? "text-gray-200" : "text-gray-800";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div
      className={`rounded-lg border px-4 py-2.5 mb-3 space-y-2 ${
        isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span>
          <span className={textSecondary}>Span: </span>
          <span className={`${textPrimary} font-mono font-medium`}>
            {totalSpans}
          </span>
        </span>
        <span>
          <span className={textSecondary}>Trace: </span>
          <span className={`${textPrimary} font-mono font-medium`}>
            {traces.length}
          </span>
        </span>
        <span>
          <span className={textSecondary}>Error: </span>
          <span className="font-mono font-medium text-red-500">
            {errorCount}
          </span>
        </span>
        <span>
          <span className={textSecondary}>Avg Span: </span>
          <span className={`${textPrimary} font-mono`}>
            {formatDuration(avgSpanMs)}
          </span>
        </span>
        <span>
          <span className={textSecondary}>Avg Trace: </span>
          <span className={`${textPrimary} font-mono`}>
            {formatDuration(avgTraceMs)}
          </span>
        </span>
      </div>

      {/* Buffer bar */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className={textSecondary}>Buffer:</span>
        <div
          className={`flex-1 h-2 rounded-full ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
        >
          <div
            className={`h-full rounded-full transition-all ${bufferColor}`}
            style={{ width: `${Math.min(bufferPct, 100)}%` }}
          />
        </div>
        <span className={`font-mono ${textPrimary}`}>
          {bufferSize}/{bufferMax} ({Math.round(bufferPct)}%)
        </span>
      </div>
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
