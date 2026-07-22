import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SpanRow } from "./SpanRow";
import type { SanitizedSpan, TreeSpan } from "./utils";
import { buildTree, waterfallCSS } from "./utils";

const IS_DEV = import.meta.env?.DEV ?? false;

interface SpanListProps {
  spans: SanitizedSpan[];
  viewMode: "tree" | "waterfall";
  isDark?: boolean;
  highlightedSpanId?: string;
  searchQuery?: string;
  onSpanClick: (span: SanitizedSpan) => void;
}

const ESTIMATED_ROW_HEIGHT = 28;

export const SpanList = memo(function SpanList({
  spans,
  viewMode,
  isDark,
  highlightedSpanId,
  searchQuery,
  onSpanClick,
}: SpanListProps) {
  // Build tree or flat list
  const tree = viewMode === "tree" ? buildTree(spans) : null;

  // For waterfall: compute CSS positions
  const traceEarliest =
    spans.length > 0 ? Math.min(...spans.map((s) => s.startTime)) : 0;
  const traceLatest =
    spans.length > 0 ? Math.max(...spans.map((s) => s.endTime)) : 0;
  const traceDuration = traceLatest - traceEarliest;

  // Total rows for virtualizer
  const totalRows = viewMode === "tree" ? countTreeRows(tree!) : spans.length;

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 5,
  });

  // Check if a span name matches the search query
  const isSearchHit = (name: string) => {
    if (!searchQuery) return false;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  };

  // Flatten tree to rows for virtual scrolling
  const flattenTree = (nodes: TreeSpan[]): TreeSpan[] => {
    const result: TreeSpan[] = [];
    const walk = (list: TreeSpan[]) => {
      for (const node of list) {
        result.push(node);
        walk(node.children);
      }
    };
    walk(nodes);
    return result;
  };

  const flatTree = tree ? flattenTree(tree) : [];

  // Render a single row
  const renderRow = (index: number) => {
    if (viewMode === "tree" && flatTree[index]) {
      const node = flatTree[index];
      return (
        <SpanRow
          key={node.id}
          span={node}
          depth={node.depth}
          isLastChild={node.isLastChild}
          isHighlighted={node.id === highlightedSpanId}
          isSearchHit={isSearchHit(node.name)}
          viewMode="tree"
          isDark={isDark}
          onClick={onSpanClick}
        />
      );
    }

    if (viewMode === "waterfall" && spans[index]) {
      const span = spans[index];
      const ws = waterfallCSS(span, traceEarliest, traceDuration);
      return (
        <SpanRow
          key={span.id}
          span={{ ...span, depth: 0, children: [], isLastChild: false }}
          depth={0}
          isLastChild={false}
          isHighlighted={span.id === highlightedSpanId}
          isSearchHit={isSearchHit(span.name)}
          viewMode="waterfall"
          waterfallStyle={ws}
          isDark={isDark}
          onClick={onSpanClick}
        />
      );
    }
    return null;
  };

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto"
      style={{ maxHeight: "400px" }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderRow(virtualItem.index)}
          </div>
        ))}
      </div>

      {/* Debug panel: waterfall left%/width% (dev only) */}
      {IS_DEV && viewMode === "waterfall" && spans.length > 0 && (
        <div
          className={`mt-2 p-2 rounded text-[10px] font-mono border ${
            isDark
              ? "bg-gray-900 border-gray-700 text-gray-400"
              : "bg-gray-100 border-gray-300 text-gray-600"
          }`}
        >
          <div className="font-medium mb-1">
            Waterfall Debug (traceDuration={traceDuration}ms)
          </div>
          {spans.slice(0, 10).map((s) => {
            const ws = waterfallCSS(s, traceEarliest, traceDuration);
            return (
              <div key={s.id} className="flex gap-2">
                <span className="truncate max-w-[200px]">{s.name}</span>
                <span className="text-blue-500">left:{ws?.left}</span>
                <span className="text-green-500">w:{ws?.width}</span>
                <span className="text-gray-500">{s.durationMs}ms</span>
              </div>
            );
          })}
          {spans.length > 10 && (
            <div className="text-gray-500">
              ... and {spans.length - 10} more
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function countTreeRows(nodes: TreeSpan[]): number {
  let count = 0;
  const walk = (list: TreeSpan[]) => {
    for (const node of list) {
      count++;
      walk(node.children);
    }
  };
  walk(nodes);
  return count;
}
