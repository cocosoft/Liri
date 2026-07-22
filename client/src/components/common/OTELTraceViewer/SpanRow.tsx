import { memo, useState } from "react";
import type { SanitizedSpan, TreeSpan } from "./utils";

interface SpanRowProps {
  span: TreeSpan;
  depth: number;
  isLastChild: boolean;
  isHighlighted?: boolean;
  isSearchHit?: boolean;
  viewMode: "tree" | "waterfall";
  waterfallStyle?: { left: string; width: string } | null;
  isDark?: boolean;
  onClick: (span: SanitizedSpan) => void;
}

const KIND_LABELS: Record<string, string> = {
  internal: "int",
  server: "srv",
  client: "cli",
  producer: "prod",
  consumer: "cons",
};

export const SpanRow = memo(function SpanRow({
  span,
  depth,
  isLastChild,
  isHighlighted,
  isSearchHit,
  viewMode,
  waterfallStyle,
  isDark,
  onClick,
}: SpanRowProps) {
  const [expanded, setExpanded] = useState(true);

  const durationMs = span.durationMs;
  const isError = span.status === "error";
  const isOrphan = span._orphan;
  const hasChildren = span.children && span.children.length > 0;

  // Line prefix for tree
  let prefix = "";
  if (viewMode === "tree" && depth > 0) {
    for (let d = 1; d < depth; d++) {
      prefix += "│  ";
    }
    prefix += isLastChild ? "└─ " : "├─ ";
  }

  // Orphan style
  const orphanStyle = isOrphan ? "border-dashed text-gray-400" : "";

  /** Height + highlight styles */
  const rowClass = [
    "border-l-2 py-1 px-2 text-xs font-mono transition-colors",
    isError
      ? "border-red-400 bg-red-50/50 dark:bg-red-950/20"
      : span.status === "ok"
        ? "border-green-400"
        : "border-gray-300 dark:border-gray-600",
    isHighlighted ? "ring-1 ring-yellow-400" : "",
    orphanStyle,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <div className={rowClass} onClick={() => onClick(span)}>
        <div className="flex items-center gap-1.5 cursor-pointer">
          {/* Expand toggle for children */}
          {hasChildren && viewMode === "tree" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="shrink-0 w-4 text-center text-gray-400 hover:text-gray-600"
            >
              {expanded ? "▾" : "▸"}
            </button>
          )}
          {!hasChildren && viewMode === "tree" && (
            <span className="w-4 shrink-0" />
          )}

          {/* Status icon */}
          <span className="shrink-0">
            {isError ? "❌" : span.status === "ok" ? "✅" : "○"}
            {isOrphan && " ⚠"}
          </span>

          {/* Tree prefix */}
          {viewMode === "tree" && (
            <span className="shrink-0 text-gray-400 text-[10px]">{prefix}</span>
          )}

          {/* Name */}
          <span
            className={`truncate flex-1 ${
              isDark ? "text-gray-300" : "text-gray-700"
            } ${isSearchHit ? "underline decoration-yellow-400" : ""}`}
          >
            {span.name}
            {span._suspicious && " ⚠"}
          </span>

          {/* SpanKind tag */}
          {span.spanKind && (
            <span className="shrink-0 text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1 rounded">
              {KIND_LABELS[span.spanKind] || span.spanKind}
            </span>
          )}

          {/* Duration */}
          <span className="shrink-0 text-gray-500 tabular-nums">
            {formatDuration(durationMs)}
          </span>

          {/* Waterfall bar */}
          {viewMode === "waterfall" && waterfallStyle && (
            <div
              className="relative h-3 flex-1 min-w-[60px] rounded bg-gray-100 dark:bg-gray-700"
              title={`${formatDuration(durationMs)}`}
            >
              <div
                className={`absolute top-0 h-full rounded ${
                  isError
                    ? "bg-red-400"
                    : span.status === "ok"
                      ? "bg-green-400"
                      : "bg-gray-400"
                }`}
                style={{
                  left: waterfallStyle.left,
                  width: waterfallStyle.width,
                }}
              />
            </div>
          )}
        </div>

        {/* Error message */}
        {span.errorMessage && (
          <div className="ml-8 text-red-500 text-[10px] break-all">
            Error: {span.errorMessage}
          </div>
        )}
      </div>

      {/* Children (tree view only) */}
      {viewMode === "tree" && expanded && hasChildren && (
        <div>
          {span.children.map((child, idx) => (
            <SpanRow
              key={child.id}
              span={child}
              depth={depth + 1}
              isLastChild={idx === span.children.length - 1}
              isHighlighted={isHighlighted}
              isSearchHit={isSearchHit}
              viewMode={viewMode}
              isDark={isDark}
              onClick={onClick}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
