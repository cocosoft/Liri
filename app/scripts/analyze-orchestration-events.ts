#!/usr/bin/env bun
/**
 * H-2（2026-10-18）—— **编排事件窗口分析**（离线，只读）。
 *
 * 数据源：`~/.pyapp/data/metrics/orchestration-events.jsonl`（+ 轮转 `.1`），
 * 由 `app/src/monitoring/orchestrationEventLog.ts` 在运行时追加。
 *
 * 口径：与 `OrchestrationMetrics` **共用** `OrchestrationEventPairer`（同一张起止映射表、
 * 同一 FIFO/关联键规则）⇒ 离线结果与进程内 `getStats()` 同口径。
 *
 * 用法（app 目录下）：
 *   `bun run analyze:orchestration-events`
 *   `bun run analyze:orchestration-events --since 2026-10-18T00:00:00Z --until 2026-10-19T00:00:00Z`
 *   `bun run analyze:orchestration-events --dir <自定义目录> --json`
 *
 * 退出码：0 = 正常出表（含"无样本"）；2 = 参数非法。
 */
import { existsSync, readFileSync } from 'node:fs';

import { OrchestrationEventPairer } from '../../packages/kernel/src/core/events/orchestrationPairing';
import { orchestrationEventLogPath } from '../src/monitoring/orchestrationEventLog';

interface PersistedEvent {
  v?: number;
  t?: number;
  type?: string;
  data?: unknown;
}

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function parseTime(flag: string): number | undefined {
  const raw = argValue(flag);
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    console.error(`参数 ${flag} 不是合法时间：${raw}`);
    process.exit(2);
  }
  return ms;
}

const dir = argValue('--dir');
const since = parseTime('--since');
const until = parseTime('--until');
const asJson = args.includes('--json');

function loadEvents(): {
  files: string[];
  events: PersistedEvent[];
  malformed: number;
} {
  const main = orchestrationEventLogPath(dir);
  const files = [`${main}.1`, main].filter((f) => existsSync(f));
  const events: PersistedEvent[] = [];
  let malformed = 0;

  for (const file of files) {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      let parsed: PersistedEvent;
      try {
        parsed = JSON.parse(line) as PersistedEvent;
      } catch {
        malformed++;
        continue;
      }
      if (
        typeof parsed.t !== 'number' ||
        typeof parsed.type !== 'string' ||
        !parsed.type.startsWith('orch:')
      ) {
        malformed++;
        continue;
      }
      if (since !== undefined && parsed.t < since) continue;
      if (until !== undefined && parsed.t > until) continue;
      events.push(parsed);
    }
  }

  events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return { files, events, malformed };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((sorted.length * p) / 100)
  );
  return sorted[idx];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const { files, events, malformed } = loadEvents();
const pairer = new OrchestrationEventPairer();
const counts = new Map<string, number>();
const samples = new Map<string, number[]>();

for (const event of events) {
  const type = event.type as string;
  counts.set(type, (counts.get(type) ?? 0) + 1);
  const paired = pairer.push(type, event.data, event.t as number);
  if (!paired) continue;
  const list = samples.get(paired.startEvent) ?? [];
  list.push(paired.latencyMs);
  samples.set(paired.startEvent, list);
}

const latencies: Record<
  string,
  { n: number; p50: number; p95: number; avg: number }
> = {};
for (const [eventType, values] of samples) {
  const sum = values.reduce((acc, v) => acc + v, 0);
  latencies[eventType] = {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    avg: round1(sum / values.length),
  };
}

const first = events[0]?.t;
const last = events[events.length - 1]?.t;
const windowText = `${first === undefined ? 'n/a' : new Date(first).toISOString()} .. ${last === undefined ? 'n/a' : new Date(last).toISOString()}`;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        files,
        window: {
          since: since === undefined ? null : new Date(since).toISOString(),
          until: until === undefined ? null : new Date(until).toISOString(),
          first: first === undefined ? null : new Date(first).toISOString(),
          last: last === undefined ? null : new Date(last).toISOString(),
        },
        totalEvents: events.length,
        malformed,
        byType: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])),
        latencies,
      },
      null,
      2
    )
  );
} else {
  console.log('=== 编排事件窗口分析（持久化指标日志） ===');
  console.log(`文件：${files.length === 0 ? '(不存在)' : files.join(' , ')}`);
  console.log(`窗口：${windowText}`);
  console.log(
    `事件：${events.length} 条 · 类型 ${counts.size} 个 · 跳过畸形行 ${malformed} 条`
  );
  console.log('----------------------------------------');

  const pairedTypes = Object.keys(latencies).sort();
  if (pairedTypes.length === 0) {
    console.log('无配对样本（该窗口内没有成对的起止事件）');
  } else {
    console.log(
      '起始事件'.padEnd(28) +
        'n'.padStart(6) +
        'p50'.padStart(10) +
        'p95'.padStart(10) +
        'avg'.padStart(10)
    );
    for (const eventType of pairedTypes) {
      const s = latencies[eventType];
      console.log(
        eventType.padEnd(28) +
          String(s.n).padStart(6) +
          `${round1(s.p50)}ms`.padStart(10) +
          `${round1(s.p95)}ms`.padStart(10) +
          `${s.avg}ms`.padStart(10)
      );
    }
  }
}

process.exit(0);
