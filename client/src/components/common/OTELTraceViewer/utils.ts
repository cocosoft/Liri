import type { SpanRecord } from "../../../monitoring/otel";

// ── Types ───────────────────────────────────────────────────

export interface SanitizedSpan extends SpanRecord {
  durationMs: number; // 清洗后确保 >= 1
  _suspicious?: boolean; // endTime < startTime
  _orphan?: boolean; // 父 Span 已不在缓冲区
}

export interface GroupedTrace {
  traceId: string;
  spans: SanitizedSpan[];
  totalDurationMs: number;
  status: "ok" | "warning" | "error" | "empty";
  hasOrphans: boolean;
  moduleLabel: string;
  earliestTime: number;
  latestTime: number;
  errorCount: number;
}

export interface TreeSpan extends SanitizedSpan {
  depth: number;
  children: TreeSpan[];
  isLastChild: boolean;
}

// ── Module inference ────────────────────────────────────────

const MODULE_PREFIXES: [string, string][] = [
  ["http.", "HTTP"],
  ["tool.", "工具调用"],
  ["session.", "会话"],
  ["auth.", "认证"],
  ["db.", "数据库"],
  ["ai.", "AI/模型"],
  ["llm.", "AI/模型"],
  ["model.", "AI/模型"],
  ["agent.", "Agent"],
  ["task.", "Agent"],
  ["channel.", "通道"],
  ["mcp.", "MCP"],
];

/** 最长前缀优先 */
export function inferModule(name: string): string {
  if (!name) return "unknown";
  let bestLabel = name.split(".")[0] || "unknown";
  let bestLen = 0;
  for (const [prefix, label] of MODULE_PREFIXES) {
    if (name.startsWith(prefix) && prefix.length > bestLen) {
      bestLabel = label;
      bestLen = prefix.length;
    }
  }
  return bestLabel;
}

// ── Sanitize ─────────────────────────────────────────────────

export function sanitizeSpan(s: SpanRecord): SanitizedSpan {
  return {
    ...s,
    durationMs: Math.max(s.durationMs ?? 0, 1),
    _suspicious: s.endTime < s.startTime,
    _orphan: false,
  };
}

export function sanitizeSpans(spans: SpanRecord[]): SanitizedSpan[] {
  return spans.map(sanitizeSpan);
}

// ── Group by traceId ─────────────────────────────────────────

export function groupByTraceId(
  spans: SanitizedSpan[],
): Map<string, SanitizedSpan[]> {
  const map = new Map<string, SanitizedSpan[]>();
  const seen = new Set<string>();
  for (const s of spans) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const group = map.get(s.traceId) || [];
    group.push(s);
    map.set(s.traceId, group);
  }
  return map;
}

// ── Orphan detection ─────────────────────────────────────────

export function markOrphans(groups: Map<string, SanitizedSpan[]>): void {
  for (const [, spans] of groups) {
    const ids = new Set(spans.map((s) => s.id));
    for (const s of spans) {
      if (s.parentSpanId && !ids.has(s.parentSpanId)) {
        s._orphan = true;
      }
    }
  }
}

// ── Build GroupedTrace[] ─────────────────────────────────────

export function buildGroupedTraces(
  groups: Map<string, SanitizedSpan[]>,
): GroupedTrace[] {
  const traces: GroupedTrace[] = [];
  for (const [traceId, spans] of groups) {
    spans.sort((a, b) => a.startTime - b.startTime);

    let total = 0;
    let earliest = Infinity;
    let latest = 0;
    let errorCount = 0;
    let warningCount = 0;
    let orphanCount = 0;

    // Infer module from the most common span name prefix
    const prefixVotes = new Map<string, number>();
    for (const s of spans) {
      total += s.durationMs;
      if (s.startTime < earliest) earliest = s.startTime;
      if (s.endTime > latest) latest = s.endTime;
      if (s.status === "error") errorCount++;
      if (s.status === "unset") warningCount++;
      if (s._orphan) orphanCount++;

      const module = inferModule(s.name);
      prefixVotes.set(module, (prefixVotes.get(module) || 0) + 1);
    }

    let moduleLabel = "unknown";
    let bestVote = 0;
    for (const [mod, count] of prefixVotes) {
      if (count > bestVote) {
        moduleLabel = mod;
        bestVote = count;
      }
    }

    let status: GroupedTrace["status"] = "ok";
    if (spans.length === 0) status = "empty";
    else if (errorCount > 0) status = "error";
    else if (warningCount > 0) status = "warning";

    traces.push({
      traceId,
      spans,
      totalDurationMs: total,
      status,
      hasOrphans: orphanCount > 0,
      moduleLabel,
      earliestTime: earliest === Infinity ? 0 : earliest,
      latestTime: latest,
      errorCount,
    });
  }
  return traces;
}

// ── Tree building ────────────────────────────────────────────

export function buildTree(spans: SanitizedSpan[]): TreeSpan[] {
  const idMap = new Map<string, SanitizedSpan>();
  for (const s of spans) idMap.set(s.id, s);

  const childrenMap = new Map<string, SanitizedSpan[]>();
  const roots: SanitizedSpan[] = [];

  for (const s of spans) {
    if (s.parentSpanId && idMap.has(s.parentSpanId)) {
      const children = childrenMap.get(s.parentSpanId) || [];
      children.push(s);
      childrenMap.set(s.parentSpanId, children);
    } else {
      roots.push(s);
    }
  }

  roots.sort((a, b) => a.startTime - b.startTime);

  function buildChildren(parent: SanitizedSpan, depth: number): TreeSpan[] {
    const children = childrenMap.get(parent.id) || [];
    children.sort((a, b) => a.startTime - b.startTime);
    return children.map((child, idx) => ({
      ...child,
      depth,
      children: buildChildren(child, depth + 1),
      isLastChild: idx === children.length - 1,
    }));
  }

  return roots.map((root, idx) => ({
    ...root,
    depth: 0,
    children: buildChildren(root, 1),
    isLastChild: idx === roots.length - 1,
  }));
}

// ── Waterfall CSS ────────────────────────────────────────────

export function waterfallCSS(
  span: SanitizedSpan,
  traceEarliest: number,
  traceDuration: number,
): { left: string; width: string } | null {
  if (traceDuration <= 0) return null;
  const offset = span.startTime - traceEarliest;
  const leftPct = Math.max(0, (offset / traceDuration) * 100);
  const widthPct = Math.max(0.5, (span.durationMs / traceDuration) * 100);
  return { left: `${leftPct.toFixed(1)}%`, width: `${widthPct.toFixed(1)}%` };
}

// ── Filter & sort helpers ────────────────────────────────────

export function filterTraces(
  traces: GroupedTrace[],
  search: string,
  statusFilter: string,
  timeRangeMs: number,
): GroupedTrace[] {
  const cutoff = timeRangeMs > 0 ? Date.now() - timeRangeMs : 0;

  return traces.filter((t) => {
    if (cutoff > 0 && t.latestTime < cutoff) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (search) {
      const lower = search.toLowerCase();
      const match = t.spans.some(
        (s) =>
          s.name.toLowerCase().includes(lower) ||
          (s.errorMessage && s.errorMessage.toLowerCase().includes(lower)),
      );
      if (!match) return false;
    }
    return true;
  });
}

export type SortBy =
  | "time-desc"
  | "time-asc"
  | "duration-desc"
  | "error-first"
  | "span-count-desc";

export function sortTraces(
  traces: GroupedTrace[],
  sortBy: SortBy,
): GroupedTrace[] {
  const sorted = [...traces];
  switch (sortBy) {
    case "time-desc":
      sorted.sort((a, b) => b.latestTime - a.latestTime);
      break;
    case "time-asc":
      sorted.sort((a, b) => a.latestTime - b.latestTime);
      break;
    case "duration-desc":
      sorted.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
      break;
    case "error-first":
      sorted.sort((a, b) => {
        if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount;
        return b.latestTime - a.latestTime;
      });
      break;
    case "span-count-desc":
      sorted.sort((a, b) => b.spans.length - a.spans.length);
      break;
  }
  return sorted;
}

export function countErrors(traces: GroupedTrace[]): number {
  return traces.reduce((sum, t) => sum + t.errorCount, 0);
}
