/**
 * OTELSpanViewer — 前端 OTEL Span 追踪数据实时展示
 *
 * 从 SpanCollector 环形缓冲区读取 Span 数据，实时显示：
 * - Span 名称、耗时、状态
 * - 错误 Span 高亮
 * - 按 TraceId 分组折叠
 */

import { useEffect, useState, memo, useCallback } from "react";
import {
  getSpanRecords,
  subscribeSpanCollector,
  clearSpanRecords,
} from "../../monitoring/otel";
import type { SpanRecord } from "../../monitoring/otel";

const STATUS_ICONS: Record<SpanRecord["status"], string> = {
  ok: "✅",
  error: "❌",
  unset: "○",
};

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

interface SpanRowProps {
  span: SpanRecord;
}

const SpanRow = memo(function SpanRow({ span }: SpanRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border-l-2 py-1 px-2 text-xs font-mono ${
        span.status === "error"
          ? "border-red-400"
          : span.status === "ok"
            ? "border-green-400"
            : "border-gray-300 dark:border-gray-600"
      }`}
    >
      <div
        className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0">{STATUS_ICONS[span.status]}</span>
        <span className="truncate text-gray-700 dark:text-gray-300 flex-1">
          {span.name}
        </span>
        <span className="shrink-0 text-gray-500">{formatDuration(span.durationMs)}</span>
        <span className="shrink-0 text-gray-400 text-[10px]">
          {formatTime(span.startTime)}
        </span>
      </div>

      {expanded && (
        <div className="mt-1 ml-5 space-y-1 text-[10px] text-gray-500 dark:text-gray-400">
          <div>
            <span className="text-gray-400">TraceId:</span>{" "}
            <span className="text-gray-600 dark:text-gray-300">
              {span.traceId.slice(0, 16)}...
            </span>
          </div>
          <div>
            <span className="text-gray-400">SpanId:</span>{" "}
            <span className="text-gray-600 dark:text-gray-300">
              {span.id.slice(0, 12)}
            </span>
          </div>
          {span.errorMessage && (
            <div className="text-red-500 break-all">
              Error: {span.errorMessage}
            </div>
          )}
          {Object.keys(span.attributes).length > 0 && (
            <div className="max-h-24 overflow-y-auto">
              {Object.entries(span.attributes)
                .filter(([k]) => !k.startsWith("error."))
                .slice(0, 10)
                .map(([key, value]) => (
                  <div key={key} className="flex gap-1">
                    <span className="text-gray-400 shrink-0">{key}:</span>
                    <span className="text-gray-600 dark:text-gray-300 truncate">
                      {String(value)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function OTELSpanViewer({ compact }: { compact?: boolean }) {
  const [spans, setSpans] = useState<SpanRecord[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // 初始加载
    setSpans(getSpanRecords());

    // 订阅 SpanCollector 更新
    const unsub = subscribeSpanCollector(() => {
      setSpans(getSpanRecords());
    });

    return unsub;
  }, []);

  const handleClear = useCallback(() => {
    clearSpanRecords();
    setSpans([]);
  }, []);

  const errorCount = spans.filter((s) => s.status === "error").length;

  // 按 TraceId 分组
  const traces = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    const list = traces.get(span.traceId) || [];
    list.push(span);
    traces.set(span.traceId, list);
  }

  if (spans.length === 0) {
    return compact ? (
      <div className="text-xs text-gray-400 text-center py-2">
        OTEL: 暂无追踪数据
      </div>
    ) : (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🔍</span>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            OTEL 追踪
          </h3>
        </div>
        <p className="text-xs text-gray-400">
          暂无 Span 数据（等待页面交互产生追踪数据...）
        </p>
      </div>
    );
  }

  // P3-2.11: compact 模式 — 仅显示摘要统计
  if (compact) {
    return (
      <div className="text-xs space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">OTEL Spans</span>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
            {spans.length}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Traces</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">
            {traces.size}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">错误</span>
          <span className={`font-mono font-medium ${errorCount > 0 ? "text-red-500" : "text-gray-700 dark:text-gray-300"}`}>
            {errorCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">平均延迟</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">
            {spans.length > 0
              ? formatDuration(
                  spans.reduce((s, sp) => s + sp.durationMs, 0) / spans.length,
                )
              : "-"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">最近</span>
          <span className="font-mono text-gray-600 dark:text-gray-400 truncate max-w-[140px]">
            {spans[spans.length - 1]?.name || "-"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            OTEL 追踪 ({spans.length})
          </h3>
          {errorCount > 0 && (
            <span className="text-xs text-red-500 font-medium">
              {errorCount} 错误
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {collapsed ? "展开" : "折叠"}
          </button>
          <button
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-red-500"
          >
            清空
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {spans.map((span) => (
            <SpanRow key={`${span.traceId}-${span.id}`} span={span} />
          ))}
        </div>
      )}

      {/* 汇总统计 */}
      <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex gap-3 text-[10px] text-gray-400">
        <span>
          OK:{" "}
          <span className="text-green-500 font-medium">
            {spans.filter((s) => s.status === "ok").length}
          </span>
        </span>
        <span>
          Error:{" "}
          <span className="text-red-500 font-medium">{errorCount}</span>
        </span>
        <span>
          Unset:{" "}
          <span className="text-gray-500 font-medium">
            {spans.filter((s) => s.status === "unset").length}
          </span>
        </span>
        <span>
          Traces: <span className="font-medium">{traces.size}</span>
        </span>
        <span>
          Avg:{" "}
          <span className="font-medium">
            {spans.length > 0
              ? formatDuration(
                  spans.reduce((s, sp) => s + sp.durationMs, 0) / spans.length,
                )
              : "-"}
          </span>
        </span>
      </div>
    </div>
  );
}
