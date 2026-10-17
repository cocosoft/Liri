/**
 * U-13 / 编排可观测性实测（口径见 `dev_docs/20261017/U-13-编排可观测量化口径与实测-20261017.md`）。
 *
 * 数据源：`$PYAPP_DATA/sessions/**\/events.jsonl`（排除 `.trash`）——**只读**、零副作用。
 *
 * 口径（CS02：状态一律取持久化布尔/枚举，不做文案匹配）：
 *  - 工具误调用率 = `tool/result.data.isError === true` / 全部 `tool/result`（按 tool 名分组）
 *  - 执行时长 = `execution/prepared.time` → 同 `executionId` 的 `execution/status_changed.to ∈ {COMPLETED,FAILED,CANCELED,RECOVERED}`
 *  - 回合时长 = 同会话 `turn/start.time` → `turn/end.time`（按 turn 序号配对）
 *  - 编排事件 = `type` 前缀 `goal/|pdca/|plan/|council/|swarm/|chain/` 的计数（未持久化则如实为 0）
 *
 * 用法：
 *   bun run scripts/measure-orchestration-metrics.ts [--split 2026-10-12] [--json]
 * `--split` 用于"改进前 / 改进后"对照（ISO 日期，UTC 边界）。
 */
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const splitIdx = args.indexOf('--split');
const splitArg = splitIdx >= 0 ? args[splitIdx + 1] : undefined;
const asJson = args.includes('--json');
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

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'RECOVERED', 'ABORTED']);
/** 回合配对的合理上限：超过视为跨重启的错配（丢弃而非伪造） */
const MAX_TURN_MS = 6 * 60 * 60 * 1000;
const ORCH_RE = /^(goal|pdca|plan|council|swarm|chain)\//;

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
  };
}

const buckets: { before: Bucket; after: Bucket; all: Bucket } = {
  before: newBucket(),
  after: newBucket(),
  all: newBucket(),
};

function bucketOf(time: number): Bucket[] {
  if (SPLIT_MS === undefined || Number.isNaN(time)) return [buckets.all];
  return time < SPLIT_MS ? [buckets.before, buckets.all] : [buckets.after, buckets.all];
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
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

  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
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
        if (bucket.firstSeen === null || time < bucket.firstSeen) bucket.firstSeen = time;
        if (bucket.lastSeen === null || time > bucket.lastSeen) bucket.lastSeen = time;
      }
    }

    const type = String(ev?.type ?? '');
    if (ORCH_RE.test(type)) {
      for (const bucket of b) bucket.orchCounts.set(type, (bucket.orchCounts.get(type) ?? 0) + 1);
    }

    if (type === 'assistant/tool_call') {
      const name = String(data.name ?? 'unknown');
      if (typeof data.callSeq === 'number') toolNameByCallSeq.set(data.callSeq, name);
      if (typeof data.toolCallId === 'string') toolNameByToolCallId.set(data.toolCallId, name);
      continue;
    }

    if (type === 'tool/result') {
      const name =
        (typeof data.toolCallId === 'string' && toolNameByToolCallId.get(data.toolCallId)) ||
        (typeof data.callSeq === 'number' && toolNameByCallSeq.get(data.callSeq)) ||
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
      if (start !== undefined && TERMINAL.has(to) && Number.isFinite(time) && time >= start) {
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
        } else {
          for (const bucket of b) bucket.turnDropped++;
        }
      }
      continue;
    }

    if (type === 'metric/timing') {
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
}

function rate(error: number, total: number): string {
  return total === 0 ? 'n/a' : `${((error / total) * 100).toFixed(2)}%`;
}

function day(ts: number | null): string {
  return ts === null ? 'n/a' : new Date(ts).toISOString().slice(0, 10);
}

function topTools(bucket: Bucket, limit = 8): Array<[string, number, number, string]> {
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

if (asJson) {
  const dump = (b: Bucket) => ({
    window: [day(b.firstSeen), day(b.lastSeen)],
    tool: { total: b.toolTotal, error: b.toolError, rate: rate(b.toolError, b.toolTotal) },
    perTool: Object.fromEntries(b.perTool),
    execution: { n: b.execDurations.length, p50: pct(b.execDurations, 50), p95: pct(b.execDurations, 95) },
    turn: { n: b.turnDurations.length, dropped: b.turnDropped, p50: pct(b.turnDurations, 50), p95: pct(b.turnDurations, 95) },
    timing: {
      ttfb: { n: b.ttfb.length, p50: pct(b.ttfb, 50), p95: pct(b.ttfb, 95) },
      ttft: { n: b.ttft.length, p50: pct(b.ttft, 50), p95: pct(b.ttft, 95) },
    },
    orchestrationEvents: Object.fromEntries(b.orchCounts),
  });
  console.log(JSON.stringify({ files: files.length, parsed, badLines, split: splitArg ?? null, before: dump(buckets.before), after: dump(buckets.after), all: dump(buckets.all) }, null, 2));
} else {
  console.log(`# 编排可观测性实测（sessions 事件日志）`);
  console.log('');
  console.log(`- 事件日志：${files.length} 个文件 / ${parsed} 条事件（坏行 ${badLines}）`);
  console.log(`- 对照分界：${splitArg ? `${splitArg}T00:00:00Z` : '未设置（仅全量）'}`);
  console.log('');
  console.log('| 区间 | 时间窗 | 工具调用 | 工具错误 | 误调用率 | 执行样本 | 执行 P50/P95 (ms) | 回合样本 | 回合 P50/P95 (ms) | TTFB 样本 | TTFB P50/P95 (ms) | TTFT 样本 | TTFT P50/P95 (ms) |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  if (SPLIT_MS !== undefined) {
    console.log(summary('改进前', buckets.before).join('\n'));
    console.log(summary('改进后', buckets.after).join('\n'));
  }
  console.log(summary('全量', buckets.all).join('\n'));
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
    console.log('未发现持久化的编排事件（`goal/` `pdca/` `plan/` `council/` `swarm/` `chain/`）——编排链路指标当前只在进程内 `OrchestrationMetrics`，见口径文档。');
  } else {
    console.log('| 事件类型 | 计数 |');
    console.log('|---|---:|');
    for (const [t, n] of orch.sort((a, b) => b[1] - a[1])) console.log(`| ${t} | ${n} |`);
  }
}
