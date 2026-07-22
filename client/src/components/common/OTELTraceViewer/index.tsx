import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useTransition,
} from "react";
import {
  getSpanRecords,
  subscribeSpanCollector,
} from "../../../monitoring/otel";
import type { SpanRecord } from "../../../monitoring/otel";
import { useConfigStore } from "../../../stores/configStore";
import { TraceStatsBar } from "./TraceStatsBar";
import { TraceFilterBar } from "./TraceFilterBar";
import { TraceList } from "./TraceList";
import { SpanDetailDrawer } from "./SpanDetailDrawer";
import { Skeleton } from "./Skeleton";
import { TraceEmpty, type EmptyReason } from "./TraceEmpty";
import { DisconnectBanner } from "./DisconnectBanner";
import type { SanitizedSpan, GroupedTrace, SortBy } from "./utils";
import {
  sanitizeSpans,
  groupByTraceId,
  markOrphans,
  buildGroupedTraces,
  filterTraces,
  sortTraces,
  countErrors,
} from "./utils";

// ── Reducer ──────────────────────────────────────────────────

interface State {
  traceMap: Map<string, SanitizedSpan[]>;
  allSpans: SanitizedSpan[];
  subscriptionState: "loading" | "active" | "disconnected";
  lastUpdateTime: string;
  bufferSize: number;
}

type Action =
  | { type: "sync"; spans: SpanRecord[] }
  | { type: "reset" }
  | { type: "disconnect" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "sync": {
      const sanitized = sanitizeSpans(action.spans);
      const incoming = groupByTraceId(sanitized);
      markOrphans(incoming);

      const nextMap = new Map(state.traceMap);
      for (const key of nextMap.keys()) {
        if (!incoming.has(key)) nextMap.delete(key);
      }
      for (const [key, spans] of incoming) {
        nextMap.set(key, spans);
      }

      return {
        ...state,
        traceMap: nextMap,
        allSpans: sanitized,
        subscriptionState: "active",
        lastUpdateTime: new Date().toLocaleTimeString(),
        bufferSize: action.spans.length,
      };
    }
    case "reset":
      return {
        traceMap: new Map(),
        allSpans: [],
        subscriptionState: "loading",
        lastUpdateTime: "",
        bufferSize: 0,
      };
    case "disconnect":
      return { ...state, subscriptionState: "disconnected" };
  }
}

const initialState: State = {
  traceMap: new Map(),
  allSpans: [],
  subscriptionState: "loading",
  lastUpdateTime: "",
  bufferSize: 0,
};

const BUFFER_MAX = 200;

// ── Component ────────────────────────────────────────────────

interface OTELTraceViewerProps {
  compact?: boolean;
}

export function OTELTraceViewer({ compact }: OTELTraceViewerProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"tree" | "waterfall">("tree");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>("time-desc");
  const [timeRangeMs, setTimeRangeMs] = useState(300_000);
  const [selectedSpan, setSelectedSpan] = useState<SanitizedSpan | null>(null);
  const [paused, setPaused] = useState(false);

  const [isPending, startTransition] = useTransition();
  const errorNavIdxRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userAtBottomRef = useRef(true); // smart anchoring

  // Dark mode from config
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  // Subscribe to SpanCollector
  useEffect(() => {
    const initial = getSpanRecords();
    if (initial.length > 0) {
      dispatch({ type: "sync", spans: initial });
    }

    const unsub = subscribeSpanCollector(() => {
      if (paused) return;
      const spans = getSpanRecords();
      dispatch({ type: "sync", spans });

      // Smart anchor: scroll to bottom if user was already there
      if (userAtBottomRef.current && scrollRef.current) {
        const el = scrollRef.current;
        // Find the actual scrollable parent
        const scrollParent =
          el.closest('[class*="overflow"]') || el.parentElement;
        if (scrollParent) {
          scrollParent.scrollTop = scrollParent.scrollHeight;
        }
      }
    });

    return unsub;
  }, [paused]);

  const hasTraces = state.allSpans.length > 0;

  // Track scroll position for smart anchoring
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollParent = el.closest('[class*="overflow"]') || el.parentElement;
    if (!scrollParent) return;

    const handleScroll = () => {
      const threshold = 50;
      userAtBottomRef.current =
        scrollParent.scrollTop + scrollParent.clientHeight + threshold >=
        scrollParent.scrollHeight;
    };

    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollParent.removeEventListener("scroll", handleScroll);
  }, [hasTraces]); // re-bind when traces appear

  // Compute grouped traces
  const groupedTraces: GroupedTrace[] = useMemo(
    () => buildGroupedTraces(state.traceMap),
    [state.traceMap],
  );

  // Filter
  const filteredTraces = useMemo(
    () => filterTraces(groupedTraces, searchQuery, statusFilter, timeRangeMs),
    [groupedTraces, searchQuery, statusFilter, timeRangeMs],
  );

  // Sort
  const sortedTraces = useMemo(
    () => sortTraces(filteredTraces, sortBy),
    [filteredTraces, sortBy],
  );

  const errorCount = useMemo(() => countErrors(sortedTraces), [sortedTraces]);

  // Empty reason
  const getEmptyReason = useCallback((): EmptyReason => {
    if (state.subscriptionState === "loading") return "pending";
    if (state.allSpans.length === 0) return "cleared";
    return "no-match";
  }, [state.subscriptionState, state.allSpans.length]);

  // Error traces for navigation
  const errorTraces = useMemo(
    () => sortedTraces.filter((t) => t.errorCount > 0),
    [sortedTraces],
  );

  // Handlers
  const handleToggleExpand = useCallback((traceId: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  }, []);

  const handleSearchChange = useCallback(
    (q: string) => {
      startTransition(() => setSearchQuery(q));
    },
    [startTransition],
  );

  const handleNextError = useCallback(() => {
    if (errorTraces.length === 0) return;
    const idx = errorNavIdxRef.current % errorTraces.length;
    const trace = errorTraces[idx];
    errorNavIdxRef.current = idx + 1;

    setExpandedSet((prev) => {
      const next = new Set(prev);
      next.add(trace.traceId);
      return next;
    });

    const errSpan = trace.spans.find((s) => s.status === "error");
    if (errSpan) setSelectedSpan(errSpan);
  }, [errorTraces]);

  const handleResetFilter = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
    setTimeRangeMs(0);
    errorNavIdxRef.current = 0;
  }, []);

  const handleSpanClick = useCallback((span: SanitizedSpan) => {
    setSelectedSpan((prev) => (prev?.id === span.id ? null : span));
  }, []);

  // Export
  const handleExport = useCallback(() => {
    const exportData = sortedTraces.map((t) => ({
      traceId: t.traceId,
      status: t.status,
      moduleLabel: t.moduleLabel,
      totalDurationMs: t.totalDurationMs,
      spans: t.spans.map((s) => ({
        id: s.id,
        parentSpanId: s.parentSpanId,
        name: s.name,
        startTime: s.startTime,
        durationMs: s.durationMs,
        status: s.status,
        spanKind: s.spanKind,
        errorMessage: s.errorMessage,
        attributes: s.attributes,
        links: s.links,
      })),
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `otel-traces-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedTraces]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "F3":
          e.preventDefault();
          handleNextError();
          break;
        case "Escape":
          if (selectedSpan) {
            setSelectedSpan(null);
          }
          break;
        case "f":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            searchInputRef.current?.focus();
          }
          break;
      }
    },
    [handleNextError, selectedSpan],
  );

  // ── Compact mode ──────────────────────────────────────
  if (compact) {
    return (
      <div className="text-xs space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-gray-500 dark:text-gray-400">OTEL Spans</span>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
            {state.allSpans.length}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 dark:text-gray-400">Traces</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">
            {groupedTraces.length}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 dark:text-gray-400">错误</span>
          <span
            className={`font-mono font-medium ${errorCount > 0 ? "text-red-500" : "text-gray-700 dark:text-gray-300"}`}
          >
            {errorCount}
          </span>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────
  if (state.subscriptionState === "loading") {
    return <Skeleton isDark={isDark} />;
  }

  const isDisconnected = state.subscriptionState === "disconnected";
  const showEmpty =
    sortedTraces.length === 0 && state.subscriptionState === "active";

  return (
    <div
      className={`min-h-0 ${isDark ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Disconnect banner */}
      {isDisconnected && (
        <DisconnectBanner
          lastUpdateTime={state.lastUpdateTime}
          isDark={isDark}
          onRetry={() => {
            dispatch({ type: "reset" });
            const spans = getSpanRecords();
            if (spans.length > 0) dispatch({ type: "sync", spans });
          }}
        />
      )}

      {/* Stats bar */}
      {state.allSpans.length > 0 && (
        <TraceStatsBar
          totalSpans={state.allSpans.length}
          traces={sortedTraces}
          bufferSize={state.bufferSize}
          bufferMax={BUFFER_MAX}
          isDark={isDark}
        />
      )}

      {/* Filter bar */}
      {state.allSpans.length > 0 && (
        <TraceFilterBar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          sortBy={sortBy}
          onSortChange={setSortBy}
          timeRangeMs={timeRangeMs}
          onTimeRangeChange={setTimeRangeMs}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          errorCount={errorCount}
          onNextError={handleNextError}
          isDark={isDark}
          onExport={handleExport}
          onTogglePause={() => setPaused((p) => !p)}
          paused={paused}
        />
      )}

      {/* isPending indicator */}
      {isPending && <div className="text-xs text-gray-400 mb-2">过滤中...</div>}

      {/* Empty state */}
      {showEmpty && (
        <TraceEmpty
          reason={getEmptyReason()}
          isDark={isDark}
          lastDataTime={state.lastUpdateTime}
          onResetFilter={handleResetFilter}
        />
      )}

      {/* Trace list */}
      {sortedTraces.length > 0 && (
        <div ref={scrollRef}>
          <TraceList
            traces={sortedTraces}
            expandedSet={expandedSet}
            onToggleExpand={handleToggleExpand}
            searchQuery={searchQuery}
            viewMode={viewMode}
            isDark={isDark}
            highlightedSpanId={selectedSpan?.id}
            onSpanClick={handleSpanClick}
          />
        </div>
      )}

      {/* Span detail drawer */}
      <SpanDetailDrawer
        span={selectedSpan}
        isDark={isDark}
        onClose={() => setSelectedSpan(null)}
      />
    </div>
  );
}
