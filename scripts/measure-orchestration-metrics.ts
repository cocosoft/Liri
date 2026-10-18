/**
 * U-13 / 编排可观测性实测（口径见 `dev_docs/20261017/U-13-编排可观测量化口径与实测-20261017.md`）。
 *
 * 数据源：`$PYAPP_DATA/sessions/**\/events.jsonl`（排除 `.trash`）——**只读**、零副作用。
 *
 * 口径（CS02：状态一律取持久化布尔/枚举，不做文案匹配）：
 *  - 工具误调用率 = `tool/result.data.isError === true` / 全部 `tool/result`（按 tool 名分组）
 *  - 执行时长 = `execution/prepared.time` → 同 `executionId` 的 `execution/status_changed.to ∈ {COMPLETED,FAILED,CANCELED,RECOVERED}`
 *  - 回合时长 = 同会话 `turn/start.time` → `turn/end.time`（按 turn 序号配对）
 *  - 回合墙钟拆分（T-13-c，`--turn-breakdown`）= 回合窗口内按事件边界切分：
 *      模型等待 = `request/start` → 同 `requestId` 的 `metric/timing`（优先事件自带 `duration`）；
 *      工具执行 = `assistant/tool_call` → 同 `toolCallId` 的 `tool/result` / `tool/canceled`；
 *      其它空闲 = 回合墙钟 − 上述两段并集（框架开销 / 审批等待 / 调度空档，**不细分猜测**）。
 *    区间按**并集**计长（并行工具不重复计入）；无 `request/start` 的旧回合**排除并计数**，不造值。
 *  - 编排事件 = `type` 前缀 `orch:` / `goal/` / `pdca/` 的计数（未持久化则如实为 0）
 *
 * 用法：
 *   bun run scripts/measure-orchestration-metrics.ts [--split 2026-10-12] [--turn-breakdown] [--json]
 * `--split` 用于"改进前 / 改进后"对照（ISO 日期，UTC 边界）。
 * `--turn-breakdown` 追加墙钟拆分（需 2026-09-23 之后的 `request/start` 事件）。
 */
import { createReadStream, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const splitIdx = args.indexOf('--split');
const splitArg = splitIdx >= 0 ? args[splitIdx + 1] : undefined;
const asJson = args.includes('--json');
/** T-13-c：回合墙钟拆分（默认关闭，保持既有输出零变化） */
const withBreakdown = args.includes('--turn-breakdown');
const SPLIT_MS = splitArg ? Date.parse(`${splitArg}T00:00:00Z`) : undefined;
if (splitArg && Number.isNaN(SPLIT_MS)) {
  console.error(`invalid --split: ${splitArg}`);
  process.exit(2);
}

const ROOT = process.env.PYAPP_DATA
  ? join(process.env.PYAPP_DATA, 'sessions')
  : join(homedir(), '.pyapp', 'data', 'sessions');

function collectEventLogs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '.trash') continue;
      out.push(...collectEventLogs(join(dir, entry.name)));
    } else if (entry.name === 'events.jsonl') {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const TERMINAL = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'RECOVERED',
  'ABORTED',
]);
/** 回合配对的合理上限：超过视为跨重启的错配（丢弃而非伪造） */
const MAX_TURN_MS = 6 * 60 * 60 * 1000;
/**
 * 编排事件前缀（H-2-R2，2026-10-18）
 *
 * 真实词表见 `app/src/types/orchestrationEvents.ts`：编排事件值形如
 * `orch:<category>:<phase>`（如 `orch:plan:start`）；原正则用 `plan/`、`chain/` 等
 * **枚举名+斜杠**前缀 ⇒ 永不命中，会把「无样本」误读为「无编排」。
 * `goal/` / `pdca/` 是目标/PDCA 链路的历史前缀，保留。
 */
const ORCH_RE = /^(orch:|goal\/|pdca\/)/;

interface Bucket {
  toolTotal: number;
  toolError: number;
  perTool: Map<string, { total: number; error: number }>;
  execDurations: number[];
  turnDurations: number[];
  turnDropped: number;
  ttfb: number[];
  ttft: number[];
  orchCounts: Map<string, number>;
  firstSeen: number | null;
  lastSeen: number | null;
  /** T-13-c：参与拆分的回合各分量（ms），按回合 1:1 对齐 */
  bdTotal: number[];
  bdModel: number[];
  bdTool: number[];
  bdIdle: number[];
  /** T-13-c：窗口内无 `request/start` 的回合数（旧数据 ⇒ 排除，不造值） */
  bdNoRequestTurns: number;
}

function newBucket(): Bucket {
  return {
    toolTotal: 0,
    toolError: 0,
    perTool: new Map(),
    execDurations: [],
    turnDurations: [],
    turnDropped: 0,
    ttfb: [],
    ttft: [],
    orchCounts: new Map(),
    firstSeen: null,
    lastSeen: null,
    bdTotal: [],
    bdModel: [],
    bdTool: [],
    bdIdle: [],
    bdNoRequestTurns: 0,
  };
}

const buckets: { before: Bucket; after: Bucket; all: Bucket } = {
  before: newBucket(),
  after: newBucket(),
  all: newBucket(),
};

interface SessionEvent {
  time?: unknown;
  type?: unknown;
  seq?: unknown;
  data?: Record<string, unknown>;
}

/** 时间区间（epoch ms） */
interface Span {
  start: number;
  end: number;
}

function clipToWindow(spans: readonly Span[], window: Span): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const start = Math.max(span.start, window.start);
    const end = Math.min(span.end, window.end);
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** 区间并集长度（并行工具/嵌套请求不重复计入） */
function unionLength(spans: readonly Span[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const span = sorted[i];
    if (span.start > curEnd) {
      total += curEnd - curStart;
      curStart = span.start;
      curEnd = span.end;
    } else if (span.end > curEnd) {
      curEnd = span.end;
    }
  }
  return total + (curEnd - curStart);
}

function bucketOf(time: number): Bucket[] {
  if (SPLIT_MS === undefined || Number.isNaN(time)) return [buckets.all];
  return time < SPLIT_MS
    ? [buckets.before, buckets.all]
    : [buckets.after, buckets.all];
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((sorted.length * p) / 100)
  );
  return sorted[idx];
}

const files = collectEventLogs(ROOT);
let parsed = 0;
let badLines = 0;

for (const file of files) {
  const toolNameByCallSeq = new Map<number, string>();
  const toolNameByToolCallId = new Map<string, string>();
  const execStart = new Map<string, number>();
  const turnStart = new Map<string, number[]>();
  // T-13-c：本文件内的区间原料（读完文件后统一裁剪到回合窗口）
  const turnWindows: Array<{ window: Span; buckets: Bucket[] }> = [];
  const requestStarts = new Map<number, number>();
  const requestEnds = new Map<number, { last: number; duration?: number }>();
  const toolStarts = new Map<string, number>();
  const toolSpans: Span[] = [];

  /** 工具区间配对键：优先 `toolCallId`，缺省退化到 `#callSeq`（与既有工具名配对同口径） */
  const toolSpanKey = (data: Record<string, unknown>): string | null => {
    if (typeof data.toolCallId === 'string' && data.toolCallId)
      return data.toolCallId;
    if (typeof data.callSeq === 'number') return `#${data.callSeq}`;
    return null;
  };

  const closeToolSpan = (data: Record<string, unknown>, time: number): void => {
    const key = toolSpanKey(data);
    if (!key || !Number.isFinite(time)) return;
    const start = toolStarts.get(key);
    if (start === undefined) return;
    toolStarts.delete(key);
    // 倒挂视为错配 ⇒ 丢弃该区间（不伪造）
    if (time >= start) toolSpans.push({ start, end: time });
  };

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let ev: SessionEvent;
    try {
      ev = JSON.parse(line) as SessionEvent;
      parsed++;
    } catch {
      badLines++;
      continue;
    }
    const time = Number(ev?.time);
    const data = ev?.data ?? {};
    const b = bucketOf(time);

    for (const bucket of b) {
      if (Number.isFinite(time)) {
        if (bucket.firstSeen === null || time < bucket.firstSeen)
          bucket.firstSeen = time;
        if (bucket.lastSeen === null || time > bucket.lastSeen)
          bucket.lastSeen = time;
      }
    }

    const type = String(ev?.type ?? '');
    if (ORCH_RE.test(type)) {
      for (const bucket of b)
        bucket.orchCounts.set(type, (bucket.orchCounts.get(type) ?? 0) + 1);
    }

    if (type === 'request/start') {
      const requestId = Number(ev?.seq);
      if (
        Number.isFinite(requestId) &&
        requestId > 0 &&
        Number.isFinite(time)
      ) {
        requestStarts.set(requestId, time);
      }
      continue;
    }

    if (type === 'assistant/tool_call') {
      const name = String(data.name ?? 'unknown');
      if (typeof data.callSeq === 'number')
        toolNameByCallSeq.set(data.callSeq, name);
      if (typeof data.toolCallId === 'string')
        toolNameByToolCallId.set(data.toolCallId, name);
      const key = toolSpanKey(data);
      if (key && Number.isFinite(time)) toolStarts.set(key, time);
      continue;
    }

    if (type === 'tool/result') {
      const name =
        (typeof data.toolCallId === 'string' &&
          toolNameByToolCallId.get(data.toolCallId)) ||
        (typeof data.callSeq === 'number' &&
          toolNameByCallSeq.get(data.callSeq)) ||
        'unknown';
      const isError = data.isError === true;
      for (const bucket of b) {
        bucket.toolTotal++;
        if (isError) bucket.toolError++;
        const entry = bucket.perTool.get(name) ?? { total: 0, error: 0 };
        entry.total++;
        if (isError) entry.error++;
        bucket.perTool.set(name, entry);
      }
      closeToolSpan(data, time);
      continue;
    }

    if (type === 'tool/canceled') {
      closeToolSpan(data, time);
      continue;
    }

    if (type === 'execution/prepared') {
      if (typeof data.executionId === 'string' && Number.isFinite(time)) {
        execStart.set(data.executionId, time);
      }
      continue;
    }

    if (type === 'execution/status_changed') {
      const to = String(data.to ?? '');
      const id = typeof data.executionId === 'string' ? data.executionId : '';
      const start = execStart.get(id);
      if (
        start !== undefined &&
        TERMINAL.has(to) &&
        Number.isFinite(time) &&
        time >= start
      ) {
        for (const bucket of b) bucket.execDurations.push(time - start);
        execStart.delete(id);
      }
      continue;
    }

    if (type === 'turn/start') {
      if (Number.isFinite(time)) {
        const key = String(data.turn ?? '?');
        const queue = turnStart.get(key) ?? [];
        queue.push(time);
        turnStart.set(key, queue);
      }
      continue;
    }

    if (type === 'turn/end') {
      const key = String(data.turn ?? '?');
      const queue = turnStart.get(key);
      const start = queue?.shift();
      if (start !== undefined) {
        const dur = time - start;
        // 同一 turn 号在重启后会复用 ⇒ 超过 6h 视为错配（计入 dropped，不伪造数据）
        if (Number.isFinite(dur) && dur >= 0 && dur <= MAX_TURN_MS) {
          for (const bucket of b) bucket.turnDurations.push(dur);
          turnWindows.push({ window: { start, end: time }, buckets: b });
        } else {
          for (const bucket of b) bucket.turnDropped++;
        }
      }
      continue;
    }

    if (type === 'metric/timing') {
      // T-13-c：请求完成侧（延迟条 + 用量条可各一条，归并到同一 requestId）
      const requestId = Number(data.requestId);
      if (Number.isFinite(requestId) && requestStarts.has(requestId)) {
        const start = requestStarts.get(requestId) as number;
        const prev = requestEnds.get(requestId) ?? { last: -Infinity };
        if (Number.isFinite(time) && time >= start) {
          prev.last = Math.max(prev.last, time);
        }
        const duration = Number(data.duration);
        if (
          Number.isFinite(duration) &&
          duration >= 0 &&
          prev.duration === undefined
        ) {
          prev.duration = duration;
        }
        requestEnds.set(requestId, prev);
      }
      if (String(data.stage ?? '') === 'request') {
        const ttfb = Number(data.ttfb);
        const ttft = Number(data.ttft);
        for (const bucket of b) {
          if (Number.isFinite(ttfb) && ttfb >= 0) bucket.ttfb.push(ttfb);
          if (Number.isFinite(ttft) && ttft >= 0) bucket.ttft.push(ttft);
        }
      }
    }
  }

  // T-13-c：读完本文件后，把区间裁剪到回合窗口并累加到对应桶
  if (withBreakdown) {
    const requestSpans: Span[] = [];
    for (const [requestId, start] of requestStarts) {
      const endInfo = requestEnds.get(requestId);
      const end =
        endInfo?.duration !== undefined
          ? start + endInfo.duration
          : endInfo?.last;
      // 无完成侧 / 倒挂 ⇒ 丢弃（不造区间；回合因此视为「无请求边界」）
      if (end !== undefined && Number.isFinite(end) && end >= start) {
        requestSpans.push({ start, end });
      }
    }
    for (const { window, buckets: targetBuckets } of turnWindows) {
      const modelSpans = clipToWindow(requestSpans, window);
      const toolSpansInWindow = clipToWindow(toolSpans, window);
      if (modelSpans.length === 0) {
        for (const bucket of targetBuckets) bucket.bdNoRequestTurns++;
        continue;
      }
      const totalMs = window.end - window.start;
      const modelMs = unionLength(modelSpans);
      const toolMs = unionLength(toolSpansInWindow);
      // 两段并集：模型与工具理论上互斥，取并集防止异常重叠导致分量之和 > 墙钟
      const busyMs = unionLength([...modelSpans, ...toolSpansInWindow]);
      const idleMs = Math.max(0, totalMs - busyMs);
      for (const bucket of targetBuckets) {
        bucket.bdTotal.push(totalMs);
        bucket.bdModel.push(modelMs);
        bucket.bdTool.push(toolMs);
        bucket.bdIdle.push(idleMs);
      }
    }
  }
}

function rate(error: number, total: number): string {
  return total === 0 ? 'n/a' : `${((error / total) * 100).toFixed(2)}%`;
}

function day(ts: number | null): string {
  return ts === null ? 'n/a' : new Date(ts).toISOString().slice(0, 10);
}

function topTools(
  bucket: Bucket,
  limit = 8
): Array<[string, number, number, string]> {
  return [...bucket.perTool.entries()]
    .filter(([, v]) => v.total >= 5)
    .sort((a, b) => b[1].error / b[1].total - a[1].error / a[1].total)
    .slice(0, limit)
    .map(([name, v]) => [name, v.total, v.error, rate(v.error, v.total)]);
}

function summary(name: string, b: Bucket): string[] {
  const lines: string[] = [];
  lines.push(
    `| ${name} | ${day(b.firstSeen)} ~ ${day(b.lastSeen)} | ${b.toolTotal} | ${b.toolError} | ${rate(b.toolError, b.toolTotal)} | ${b.execDurations.length} | ${pct(b.execDurations, 50)} / ${pct(b.execDurations, 95)} | ${b.turnDurations.length} (弃 ${b.turnDropped}) | ${pct(b.turnDurations, 50)} / ${pct(b.turnDurations, 95)} | ${b.ttfb.length} | ${pct(b.ttfb, 50)} / ${pct(b.ttfb, 95)} | ${b.ttft.length} | ${pct(b.ttft, 50)} / ${pct(b.ttft, 95)} |`
  );
  return lines;
}

function sumValues(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** T-13-c：墙钟拆分一行（占比 = 分量总和 / 墙钟总和） */
function breakdownLine(name: string, b: Bucket): string {
  const totalSum = sumValues(b.bdTotal);
  const share = (values: readonly number[]): string =>
    totalSum > 0
      ? `${((sumValues(values) / totalSum) * 100).toFixed(1)}%`
      : 'n/a';
  return `| ${name} | ${b.bdTotal.length}（无请求边界 ${b.bdNoRequestTurns}） | ${pct(b.bdTotal, 50)} / ${pct(b.bdTotal, 95)} | ${pct(b.bdModel, 50)} / ${pct(b.bdModel, 95)} | ${pct(b.bdTool, 50)} / ${pct(b.bdTool, 95)} | ${pct(b.bdIdle, 50)} / ${pct(b.bdIdle, 95)} | ${share(b.bdModel)} / ${share(b.bdTool)} / ${share(b.bdIdle)} |`;
}

function breakdownJson(b: Bucket): {
  n: number;
  excludedNoRequest: number;
  total: { p50: number; p95: number };
  model: { p50: number; p95: number };
  tool: { p50: number; p95: number };
  idle: { p50: number; p95: number };
  share: { model: string; tool: string; idle: string };
} {
  const totalSum = sumValues(b.bdTotal);
  const share = (values: readonly number[]): string =>
    totalSum > 0
      ? `${((sumValues(values) / totalSum) * 100).toFixed(1)}%`
      : 'n/a';
  return {
    n: b.bdTotal.length,
    excludedNoRequest: b.bdNoRequestTurns,
    total: { p50: pct(b.bdTotal, 50), p95: pct(b.bdTotal, 95) },
    model: { p50: pct(b.bdModel, 50), p95: pct(b.bdModel, 95) },
    tool: { p50: pct(b.bdTool, 50), p95: pct(b.bdTool, 95) },
    idle: { p50: pct(b.bdIdle, 50), p95: pct(b.bdIdle, 95) },
    share: {
      model: share(b.bdModel),
      tool: share(b.bdTool),
      idle: share(b.bdIdle),
    },
  };
}

if (asJson) {
  const dump = (b: Bucket) => ({
    window: [day(b.firstSeen), day(b.lastSeen)],
    tool: {
      total: b.toolTotal,
      error: b.toolError,
      rate: rate(b.toolError, b.toolTotal),
    },
    perTool: Object.fromEntries(b.perTool),
    execution: {
      n: b.execDurations.length,
      p50: pct(b.execDurations, 50),
      p95: pct(b.execDurations, 95),
    },
    turn: {
      n: b.turnDurations.length,
      dropped: b.turnDropped,
      p50: pct(b.turnDurations, 50),
      p95: pct(b.turnDurations, 95),
    },
    timing: {
      ttfb: { n: b.ttfb.length, p50: pct(b.ttfb, 50), p95: pct(b.ttfb, 95) },
      ttft: { n: b.ttft.length, p50: pct(b.ttft, 50), p95: pct(b.ttft, 95) },
    },
    orchestrationEvents: Object.fromEntries(b.orchCounts),
    ...(withBreakdown ? { breakdown: breakdownJson(b) } : {}),
  });
  console.log(
    JSON.stringify(
      {
        files: files.length,
        parsed,
        badLines,
        split: splitArg ?? null,
        before: dump(buckets.before),
        after: dump(buckets.after),
        all: dump(buckets.all),
      },
      null,
      2
    )
  );
} else {
  console.log(`# 编排可观测性实测（sessions 事件日志）`);
  console.log('');
  console.log(
    `- 事件日志：${files.length} 个文件 / ${parsed} 条事件（坏行 ${badLines}）`
  );
  console.log(
    `- 对照分界：${splitArg ? `${splitArg}T00:00:00Z` : '未设置（仅全量）'}`
  );
  console.log('');
  console.log(
    '| 区间 | 时间窗 | 工具调用 | 工具错误 | 误调用率 | 执行样本 | 执行 P50/P95 (ms) | 回合样本 | 回合 P50/P95 (ms) | TTFB 样本 | TTFB P50/P95 (ms) | TTFT 样本 | TTFT P50/P95 (ms) |'
  );
  console.log(
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  );
  if (SPLIT_MS !== undefined) {
    console.log(summary('改进前', buckets.before).join('\n'));
    console.log(summary('改进后', buckets.after).join('\n'));
  }
  console.log(summary('全量', buckets.all).join('\n'));
  if (withBreakdown) {
    console.log('');
    console.log('## 回合墙钟拆分（T-13-c）');
    console.log('');
    console.log(
      '口径：模型等待 = `request/start` → 同 `requestId` 的 `metric/timing`（优先事件自带 `duration`）；' +
        '工具执行 = `assistant/tool_call` → 同 `toolCallId` 的 `tool/result` / `tool/canceled`；' +
        '其它空闲 = 墙钟 − 两段并集。区间取**并集**，并行工具不重复计入；' +
        '无 `request/start` 的回合（2026-09-23 之前的旧数据）**排除并计数**，不造值。'
    );
    console.log('');
    console.log(
      '| 区间 | 样本（排除无请求边界） | 墙钟 P50/P95 (ms) | 模型等待 P50/P95 (ms) | 工具执行 P50/P95 (ms) | 其它空闲 P50/P95 (ms) | 占比 模型/工具/空闲 |'
    );
    console.log('|---|---:|---:|---:|---:|---:|---:|');
    if (SPLIT_MS !== undefined) {
      console.log(breakdownLine('改进前', buckets.before));
      console.log(breakdownLine('改进后', buckets.after));
    }
    console.log(breakdownLine('全量', buckets.all));
  }
  console.log('');
  console.log('## 误调用率 Top 工具（全量，样本 ≥5）');
  console.log('');
  console.log('| 工具 | 调用 | 错误 | 误调用率 |');
  console.log('|---|---:|---:|---:|');
  for (const [name, total, error, r] of topTools(buckets.all)) {
    console.log(`| ${name} | ${total} | ${error} | ${r} |`);
  }
  const orch = [...buckets.all.orchCounts.entries()];
  console.log('');
  console.log('## 编排事件（全量）');
  console.log('');
  if (orch.length === 0) {
    console.log(
      '未发现持久化的编排事件（`goal/` `pdca/` `plan/` `council/` `swarm/` `chain/`）——编排链路指标当前只在进程内 `OrchestrationMetrics`，见口径文档。'
    );
  } else {
    console.log('| 事件类型 | 计数 |');
    console.log('|---|---:|');
    for (const [t, n] of orch.sort((a, b) => b[1] - a[1]))
      console.log(`| ${t} | ${n} |`);
  }
}
