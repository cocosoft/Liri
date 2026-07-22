import { memo, useCallback } from "react";
import type { SanitizedSpan } from "./utils";

interface SpanDetailDrawerProps {
  span: SanitizedSpan | null;
  viewMode?: "tree" | "waterfall";
  isDark?: boolean;
  onClose: () => void;
}

export const SpanDetailDrawer = memo(function SpanDetailDrawer({
  span,
  isDark,
  onClose,
}: SpanDetailDrawerProps) {
  const copyAsJson = useCallback(() => {
    if (!span) return;
    const { _suspicious, _orphan, ...rest } = span as SanitizedSpan & {
      _suspicious?: boolean;
      _orphan?: boolean;
    };
    navigator.clipboard
      .writeText(JSON.stringify(rest, null, 2))
      .catch(() => {});
  }, [span]);

  if (!span) return null;

  const bg = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const codeBg = isDark ? "bg-gray-900" : "bg-gray-100";

  const fields: [string, string][] = [
    ["Span ID", span.id],
    ["Trace ID", span.traceId],
    ["Name", span.name],
    ["Status", span.status],
    ["Duration", formatDuration(span.durationMs)],
    ["Start", new Date(span.startTime).toLocaleTimeString()],
    ["End", new Date(span.endTime).toLocaleTimeString()],
  ];
  if (span.parentSpanId) fields.push(["Parent Span ID", span.parentSpanId]);
  if (span.spanKind) fields.push(["Kind", span.spanKind]);
  if (span.errorMessage) fields.push(["Error", span.errorMessage]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />
      {/* Drawer */}
      <div
        className={`relative w-full max-w-md h-full overflow-y-auto shadow-xl ${bg}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-4 py-3 border-b flex items-center justify-between sticky top-0 ${bg} ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <h3 className={`text-sm font-semibold ${textPrimary}`}>Span 详情</h3>
          <button
            onClick={onClose}
            className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${textSecondary}`}
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Key-value fields */}
          <div className="space-y-2">
            {fields.map(([label, value]) => (
              <div key={label}>
                <span className={`text-xs font-medium ${textSecondary}`}>
                  {label}
                </span>
                <p className={`text-sm mt-0.5 break-all ${textPrimary}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Attributes */}
          {Object.keys(span.attributes).length > 0 && (
            <div>
              <span className={`text-xs font-medium ${textSecondary}`}>
                Attributes
              </span>
              <pre
                className={`mt-1 p-3 rounded text-xs overflow-x-auto ${codeBg} ${textPrimary}`}
              >
                {JSON.stringify(span.attributes, null, 2)}
              </pre>
            </div>
          )}

          {/* Links */}
          {span.links && span.links.length > 0 && (
            <div>
              <span className={`text-xs font-medium ${textSecondary}`}>
                Links
              </span>
              <div className="mt-1 space-y-1">
                {span.links.map((l, i) => (
                  <div key={i} className={`text-xs ${textSecondary}`}>
                    traceId={l.traceId.slice(0, 12)}... spanId={l.spanId}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Copy button */}
          <button
            onClick={copyAsJson}
            className={`w-full py-2 text-xs rounded-lg border font-medium ${
              isDark
                ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            复制 JSON
          </button>
        </div>
      </div>
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
