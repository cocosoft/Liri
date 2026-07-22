import { memo } from "react";
import { TraceCard } from "./TraceCard";
import type { GroupedTrace, SanitizedSpan } from "./utils";

interface TraceListProps {
  traces: GroupedTrace[];
  expandedSet: Set<string>;
  onToggleExpand: (traceId: string) => void;
  searchQuery: string;
  viewMode: "tree" | "waterfall";
  isDark?: boolean;
  highlightedSpanId?: string;
  onSpanClick: (span: SanitizedSpan) => void;
}

const MAX_AUTO_EXPAND = 3;

export const TraceList = memo(function TraceList({
  traces,
  expandedSet,
  onToggleExpand,
  searchQuery,
  viewMode,
  isDark,
  highlightedSpanId,
  onSpanClick,
}: TraceListProps) {
  return (
    <div className="space-y-0">
      {traces.map((trace, idx) => {
        /** Auto-expand first N traces if not in the set */
        const isExplicit = expandedSet.has(trace.traceId);
        const expanded =
          isExplicit || (expandedSet.size === 0 && idx < MAX_AUTO_EXPAND);

        return (
          <TraceCard
            key={trace.traceId}
            trace={trace}
            expanded={expanded}
            onToggle={() => onToggleExpand(trace.traceId)}
            searchQuery={searchQuery}
            viewMode={viewMode}
            isDark={isDark}
            highlightedSpanId={highlightedSpanId}
            onSpanClick={onSpanClick}
          />
        );
      })}
    </div>
  );
});
