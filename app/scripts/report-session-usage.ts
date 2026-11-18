#!/usr/bin/env bun
/**
 * report-session-usage.ts — 单会话「工具面变化前后」请求级用量对比（§14.4，2026-11-10）
 *
 * **背景**：`dev_docs/20261107/权限与沙箱拉通方案-20261107.md` §14.4 记的未做项 ——
 * 「仍未做单次会话的 request/response 用量前后对比（`recordToolSchemaEntropy` 只有熵观测，
 * 未落用量差值）」。工具披露成本的既有口径是**字符数 / 4 估算**（`measure:tool-disclosure`），
 * 那份只能回答"schema 多大"，回答不了"工具面变大后这次请求实际多花多少 token"。
 *
 * **本脚本的口径（只用落盘的真实值，不做估算）**：
 * - 请求级用量 = `metric/timing`（`stage='request'`）里 provider **服务端报告**的 token；
 * - 工具面 = `context/model-input` 快照的 `tools.count`（TR-12-B，每轮实际携带的工具数）；
 * - 分组边界 = 首个 `tool_search` 调用**之后**的第一个工具面变化点；没有则取首个变化点；
 *   都没有则退化为 `tool_search` 调用本身（工具数未知）。
 *
 * **如实边界（务必连同数字一起读）**：
 * - 相邻请求之间**对话本身在增长**（新增 assistant/tool 消息）⇒ 差值含叙事增量，
 *   不是纯 schema 成本；纯 schema 成本见 `bun run measure:tool-disclosure`。
 * - 工具面**为什么**变化（tool_search 补回 / 任务面切换 / profile 调整）未在事件里标注 ⇒
 *   本报告只给"变化前后"的用量事实，不臆测原因（CS06）。
 * - 事件缺失（旧会话无 `context/model-input` / `metric/timing` 无 token）⇒ 对应字段留空，
 *   并在 `notes` 里如实说明，不拿 0 顶替。
 *
 * 用法（app 目录下）：
 *   bun run stats:session-usage -- --session=<sessionId> [--worktree=default] [--json]
 */

import type { LiriEvent } from '@modules/session/types/events';
import { EventLogStorage } from '@modules/session/storage/EventLogStorage';

/** 单次请求的用量样本（来自 `metric/timing` stage='request'） */
export interface RequestUsageSample {
  /** 请求边界 id（`request/start` 的 seq）；旧事件缺省 ⇒ null */
  requestId: number | null;
  /** 该用量事件的 seq（排序/去重用） */
  seq: number;
  time: number;
  turn?: number;
  model?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  /** 该请求实际携带的工具数（来自最近的 `context/model-input`）；未知 ⇒ null */
  toolCount: number | null;
}

/** 工具面快照点（`context/model-input.tools.count`） */
export interface SurfacePoint {
  seq: number;
  time: number;
  toolCount: number;
}

/** 工具面变化点（相邻快照 count 不同） */
export interface SurfaceChange extends SurfacePoint {
  from: number;
  to: number;
}

/** 工具面变化边界（分组依据） */
export interface UsageBoundary {
  seq: number;
  time: number;
  /** 数据来源：`tools` = 工具面快照变化；`tool_search` = 仅见调用、工具数未知 */
  source: 'tools' | 'tool_search';
  fromToolCount: number | null;
  toToolCount: number | null;
  /** `tool_search` 的参数 query（有才给） */
  query?: string;
}

/** 一组请求的用量统计 */
export interface UsageGroupStats {
  requests: number;
  input: { sum: number; mean: number; median: number } | null;
  output: { sum: number; mean: number; median: number } | null;
}

/** 某一工具面档位的用量统计 */
export interface ToolCountStats extends UsageGroupStats {
  toolCount: number;
}

/** 最紧相邻对比（边界前最后一次 → 边界后第一次） */
export interface AdjacentComparison {
  before: RequestUsageSample;
  after: RequestUsageSample;
  inputDelta: number;
  /** 前值缺失/为 0 ⇒ null（不拿 0 冒充） */
  inputDeltaPercent: number | null;
  outputDelta: number | null;
}

export interface SessionUsageReport {
  sessionId: string;
  /** 请求级用量样本总数 */
  totalRequests: number;
  /** `tool_search` 调用总次数 */
  toolSearchCalls: number;
  boundary: UsageBoundary | null;
  /** 全部工具面变化点（按 seq 升序；不臆测原因） */
  surfaceChanges: SurfaceChange[];
  before: UsageGroupStats | null;
  after: UsageGroupStats | null;
  /** 无边界时给出全会话基线（供对照） */
  baseline: UsageGroupStats | null;
  /** 按工具面档位聚合（有 toolCount 的样本；升序） */
  perToolCount: ToolCountStats[];
  adjacent: AdjacentComparison | null;
  /** 无法计算/口径限制（CS06：不造数，如实列出） */
  notes: string[];
}

/** 数值守卫：非有限数视作缺失 */
function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function summarize(
  samples: ReadonlyArray<RequestUsageSample>
): UsageGroupStats | null {
  if (samples.length === 0) return null;
  const inputs = samples
    .map((s) => s.inputTokens)
    .filter((v): v is number => v !== null);
  const outputs = samples
    .map((s) => s.outputTokens)
    .filter((v): v is number => v !== null);
  const sum = (values: ReadonlyArray<number>): number =>
    values.reduce((a, b) => a + b, 0);
  return {
    requests: samples.length,
    input:
      inputs.length === 0
        ? null
        : {
            sum: sum(inputs),
            mean: Math.round(sum(inputs) / inputs.length),
            median: median(inputs),
          },
    output:
      outputs.length === 0
        ? null
        : {
            sum: sum(outputs),
            mean: Math.round(sum(outputs) / outputs.length),
            median: median(outputs),
          },
  };
}

/**
 * 提取请求级用量样本。
 *
 * - 只收 `metric/timing` 且 `stage='request'`、且至少带 input/output 之一的记录
 *   （延迟条 `ttfb/ttft` 与回合级 `stage='assistant'` 一律忽略）；
 * - 同一 `requestId` 可能有多条完成事件 ⇒ 按"token 总量最大"取一条；
 * - 无 `requestId` 的旧事件不丢弃：以 `seq` 自身为稳定键参与排序与分组。
 */
export function extractRequestUsages(
  events: ReadonlyArray<LiriEvent>
): RequestUsageSample[] {
  const starts = new Map<number, { turn?: number; model?: string }>();
  for (const event of events) {
    if (event.type !== 'request/start') continue;
    const data = (event.data ?? {}) as Record<string, unknown>;
    starts.set(event.seq, {
      ...(numberOr(data.turn) !== null ? { turn: numberOr(data.turn)! } : {}),
      ...(typeof data.model === 'string' && data.model
        ? { model: data.model }
        : {}),
    });
  }

  const byKey = new Map<string, RequestUsageSample>();
  for (const event of events) {
    if (event.type !== 'metric/timing') continue;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (data.stage !== 'request') continue;
    const inputTokens = numberOr(data.inputTokens);
    const outputTokens = numberOr(data.outputTokens);
    if (inputTokens === null && outputTokens === null) continue;
    const requestId = numberOr(data.requestId);
    const key = requestId === null ? `seq:${event.seq}` : `req:${requestId}`;
    const meta = requestId === null ? undefined : starts.get(requestId);
    const sample: RequestUsageSample = {
      requestId,
      seq: event.seq,
      time: event.time,
      ...(meta?.turn !== undefined ? { turn: meta.turn } : {}),
      ...(meta?.model !== undefined ? { model: meta.model } : {}),
      inputTokens,
      outputTokens,
      cacheReadTokens: numberOr(data.cacheReadTokens),
      cacheCreationTokens: numberOr(data.cacheCreationTokens),
      toolCount: null,
    };
    const prev = byKey.get(key);
    const weight = (s: RequestUsageSample): number =>
      (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    if (!prev || weight(sample) > weight(prev)) byKey.set(key, sample);
  }

  return [...byKey.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * 提取工具面快照点（`context/model-input`）。
 *
 * TR-12-B 的引用式去重：内容未变时 `tools` 省略、只给 `toolsRefSeq` ⇒ 用 seq→count
 * 索引回溯到被引用事件；两者都缺（更旧的事件）⇒ 该轮不产生快照点（不猜）。
 */
export function extractSurfacePoints(
  events: ReadonlyArray<LiriEvent>
): SurfacePoint[] {
  const countBySeq = new Map<number, number>();
  for (const event of events) {
    if (event.type !== 'context/model-input') continue;
    const tools = ((event.data ?? {}) as Record<string, unknown>).tools as
      | Record<string, unknown>
      | undefined;
    const count = numberOr(tools?.count);
    if (count !== null) countBySeq.set(event.seq, count);
  }

  const points: SurfacePoint[] = [];
  for (const event of events) {
    if (event.type !== 'context/model-input') continue;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const tools = data.tools as Record<string, unknown> | undefined;
    const direct = numberOr(tools?.count);
    const ref = numberOr(data.toolsRefSeq);
    const count =
      direct ?? (ref !== null ? (countBySeq.get(ref) ?? null) : null);
    if (count === null) continue;
    points.push({ seq: event.seq, time: event.time, toolCount: count });
  }
  return points;
}

/** 工具面变化点（相邻快照 count 不同） */
export function surfaceChanges(
  points: ReadonlyArray<SurfacePoint>
): SurfaceChange[] {
  const changes: SurfaceChange[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1].toolCount;
    const to = points[i].toolCount;
    if (from === to) continue;
    changes.push({ ...points[i], from, to });
  }
  return changes;
}

/** 首个 `tool_search` 调用（工具面补回意图信号）；没有 ⇒ null */
export function findFirstToolSearch(events: ReadonlyArray<LiriEvent>): {
  seq: number;
  time: number;
  query?: string;
} | null {
  for (const event of events) {
    if (event.type !== 'assistant/tool_call') continue;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (data.name !== 'tool_search') continue;
    const args = data.args;
    const query =
      args && typeof args === 'object'
        ? (args as Record<string, unknown>).query
        : undefined;
    return {
      seq: event.seq,
      time: event.time,
      ...(typeof query === 'string' && query ? { query } : {}),
    };
  }
  return null;
}

/** 请求 seq 之前最近的工具面快照 count（无 ⇒ null） */
function toolCountAt(
  points: ReadonlyArray<SurfacePoint>,
  seq: number
): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].seq < seq) {
      found = points[mid].toolCount;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 组装报告（纯函数：只读事件，不碰磁盘/DB） */
export function buildSessionUsageReport(
  sessionId: string,
  events: ReadonlyArray<LiriEvent>
): SessionUsageReport {
  const points = extractSurfacePoints(events);
  const samples = extractRequestUsages(events).map((s) => ({
    ...s,
    toolCount: toolCountAt(points, s.seq),
  }));
  const changes = surfaceChanges(points);
  const firstSearch = findFirstToolSearch(events);
  const toolSearchCalls = events.filter((e) => {
    if (e.type !== 'assistant/tool_call') return false;
    return ((e.data ?? {}) as Record<string, unknown>).name === 'tool_search';
  }).length;

  const notes: string[] = [];
  if (samples.length === 0) {
    notes.push(
      '该会话没有可用的请求级用量事件（`metric/timing` stage=request 且带 token）⇒ 无法对比（不造数）'
    );
  }
  if (points.length === 0 && samples.length > 0) {
    notes.push(
      '该会话没有 `context/model-input` 工具面快照 ⇒ 工具数未知，只能按 `tool_search` 调用位置分组'
    );
  }

  // 边界优先级：tool_search 之后的第一个工具面变化 > 首个工具面变化 > tool_search 本身
  const afterSearch = firstSearch
    ? changes.find((c) => c.seq > firstSearch.seq)
    : undefined;
  const change = afterSearch ?? changes[0];
  const boundary: UsageBoundary | null = change
    ? {
        seq: change.seq,
        time: change.time,
        source: 'tools',
        fromToolCount: change.from,
        toToolCount: change.to,
        ...(afterSearch && firstSearch?.query
          ? { query: firstSearch.query }
          : {}),
      }
    : firstSearch
      ? {
          seq: firstSearch.seq,
          time: firstSearch.time,
          source: 'tool_search',
          fromToolCount: null,
          toToolCount: null,
          ...(firstSearch.query ? { query: firstSearch.query } : {}),
        }
      : null;

  const perToolCountMap = new Map<number, RequestUsageSample[]>();
  for (const sample of samples) {
    if (sample.toolCount === null) continue;
    const group = perToolCountMap.get(sample.toolCount) ?? [];
    group.push(sample);
    perToolCountMap.set(sample.toolCount, group);
  }
  const perToolCount: ToolCountStats[] = [...perToolCountMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([toolCount, group]) => ({
      toolCount,
      ...(summarize(group) as UsageGroupStats),
    }));

  if (!boundary) {
    if (samples.length > 0) {
      notes.push(
        '未发现可用的分组边界（既无工具面变化也无 `tool_search` 调用）⇒ 只给全会话基线'
      );
    }
    return {
      sessionId,
      totalRequests: samples.length,
      toolSearchCalls,
      boundary: null,
      surfaceChanges: changes,
      before: null,
      after: null,
      baseline: summarize(samples),
      perToolCount,
      adjacent: null,
      notes,
    };
  }

  const before = samples.filter((s) => s.seq < boundary.seq);
  const after = samples.filter((s) => s.seq > boundary.seq);
  if (before.length === 0) notes.push('边界前没有用量样本 ⇒ 只有"之后"分组');
  if (after.length === 0) notes.push('边界后没有用量样本 ⇒ 只有"之前"分组');

  const lastBefore = [...before].reverse().find((s) => s.inputTokens !== null);
  const firstAfter = after.find((s) => s.inputTokens !== null);
  let adjacent: AdjacentComparison | null = null;
  if (lastBefore && firstAfter) {
    const beforeInput = lastBefore.inputTokens ?? 0;
    const afterInput = firstAfter.inputTokens ?? 0;
    adjacent = {
      before: lastBefore,
      after: firstAfter,
      inputDelta: afterInput - beforeInput,
      inputDeltaPercent:
        beforeInput > 0
          ? Math.round(((afterInput - beforeInput) / beforeInput) * 1000) / 10
          : null,
      outputDelta:
        lastBefore.outputTokens !== null && firstAfter.outputTokens !== null
          ? firstAfter.outputTokens - lastBefore.outputTokens
          : null,
    };
  }

  notes.push(
    '相邻请求之间对话本身在增长 ⇒ 差值是"叙事增量 + 工具面变化"的合计，不是纯 schema 成本（纯 schema 口径见 measure:tool-disclosure）'
  );
  notes.push(
    '工具面**为什么**变化（tool_search 补回 / 任务面切换 / profile 调整）未在事件里标注 ⇒ 本报告只给用量事实，不臆测原因'
  );

  return {
    sessionId,
    totalRequests: samples.length,
    toolSearchCalls,
    boundary,
    surfaceChanges: changes,
    before: summarize(before),
    after: summarize(after),
    baseline: null,
    perToolCount,
    adjacent,
    notes,
  };
}

/** 人类可读的 token 数字（千位分隔） */
function fmt(value: number): string {
  return value.toLocaleString('en-US');
}

function formatGroup(label: string, stats: UsageGroupStats | null): string[] {
  if (!stats) return [`${label}：无样本`];
  const input = stats.input
    ? `输入 合计 ${fmt(stats.input.sum)}（均值 ${fmt(stats.input.mean)} / 中位 ${fmt(stats.input.median)}）`
    : '输入 无可用样本';
  const output = stats.output
    ? `输出 合计 ${fmt(stats.output.sum)}（均值 ${fmt(stats.output.mean)} / 中位 ${fmt(stats.output.median)}）`
    : '输出 无可用样本';
  return [`${label}：请求 ${stats.requests} 次`, `  ${input}`, `  ${output}`];
}

export function formatReport(report: SessionUsageReport): string {
  const lines: string[] = [];
  lines.push(`会话 ${report.sessionId}`);
  lines.push(
    `请求级用量样本 ${report.totalRequests} 条 · tool_search 调用 ${report.toolSearchCalls} 次 · 工具面快照变化 ${report.surfaceChanges.length} 处` +
      (report.boundary
        ? ` · 分组边界 seq=${report.boundary.seq}` +
          (report.boundary.source === 'tools'
            ? `（工具 ${report.boundary.fromToolCount} → ${report.boundary.toToolCount}）`
            : '（工具数未知）') +
          (report.boundary.query ? `（query=${report.boundary.query}）` : '')
        : '')
  );
  if (report.surfaceChanges.length > 0) {
    lines.push('──────── 工具面变化 ────────');
    for (const change of report.surfaceChanges) {
      lines.push(
        `seq ${change.seq}：工具 ${change.from} → ${change.to}（${change.to - change.from >= 0 ? '+' : ''}${change.to - change.from}）`
      );
    }
  }
  if (report.baseline) {
    lines.push('──────── 全会话基线 ────────');
    lines.push(...formatGroup('全部请求', report.baseline));
  } else {
    lines.push('──────── 边界前 ────────');
    lines.push(...formatGroup('之前', report.before));
    lines.push('──────── 边界后 ────────');
    lines.push(...formatGroup('之后', report.after));
  }
  if (report.perToolCount.length > 1) {
    lines.push('──────── 按工具面档位 ────────');
    for (const group of report.perToolCount) {
      const input = group.input
        ? `输入 均值 ${fmt(group.input.mean)} / 中位 ${fmt(group.input.median)}`
        : '输入 无样本';
      lines.push(
        `工具 ${group.toolCount} 个 · 请求 ${group.requests} 次 · ${input}`
      );
    }
  }
  if (report.adjacent) {
    const a = report.adjacent;
    lines.push('──────── 最紧相邻 ────────');
    lines.push(
      `seq ${a.before.seq} → ${a.after.seq} · 输入 ${a.inputDelta >= 0 ? '+' : ''}${fmt(a.inputDelta)}` +
        (a.inputDeltaPercent === null
          ? '（前值缺失，不给百分比）'
          : `（${a.inputDeltaPercent >= 0 ? '+' : ''}${a.inputDeltaPercent}%）`) +
        (a.outputDelta === null
          ? ' · 输出 无可比样本'
          : ` · 输出 ${a.outputDelta >= 0 ? '+' : ''}${fmt(a.outputDelta)}`)
    );
  }
  if (report.notes.length > 0) {
    lines.push('──────── 口径与限制（如实） ────────');
    for (const note of report.notes) lines.push(`· ${note}`);
  }
  return lines.join('\n');
}

/** 读取整段事件流（`read` 单次上限 1 万条 ⇒ 按 seq 续读，直到读空） */
async function readAllEvents(
  sessionId: string,
  worktreeHash: string
): Promise<LiriEvent[]> {
  const log = new EventLogStorage(sessionId, worktreeHash);
  const all: LiriEvent[] = [];
  let fromSeq = 1;
  for (;;) {
    const batch = await log.read({ fromSeq, limit: 10000 });
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 10000) break;
    fromSeq = (batch[batch.length - 1].seq ?? fromSeq) + 1;
  }
  return all;
}

/** CLI 参数解析（缺 `--session` ⇒ 报用法并以 2 退出） */
function parseArgs(argv: ReadonlyArray<string>): {
  sessionId: string;
  worktree: string;
  json: boolean;
} {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  return {
    sessionId: get('session') ?? '',
    worktree: get('worktree') ?? 'default',
    json: argv.includes('--json'),
  };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sessionId) {
    console.error(
      '用法：bun run stats:session-usage -- --session=<sessionId> [--worktree=default] [--json]'
    );
    process.exit(2);
  }
  const events = await readAllEvents(args.sessionId, args.worktree);
  const report = buildSessionUsageReport(args.sessionId, events);
  console.log(
    args.json ? JSON.stringify(report, null, 2) : formatReport(report)
  );
}
