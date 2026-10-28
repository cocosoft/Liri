#!/usr/bin/env bun
/**
 * T25-03 —— `CONTEXT_COMPACTION_ESCALATION` 灰度取证（**离线解析 app.log**，不触发模型/不改行为）。
 *
 * 背景（清单 §2.4 已先立阈值）：
 *   - 能力已实现但**默认关**（`featureFlags.ts` 的 `CONTEXT_COMPACTION_ESCALATION: false`）；
 *   - 翻默认需要证据：样本量 ≥200 次「可升级面（skip 决策）」、升级后 token 降幅中位数 ≥25%、
 *     且「升级后 3 轮内任务中断率」不高于基线。
 *
 * 本脚本能判的量（全部来自既有日志，**不臆造**）：
 *   ① 可升级面 = `compaction:决策` 且 `decision='skip'` 的条数；
 *   ② 升级次数 = `compaction:escalated`；
 *   ③ 升级率 = ② / ①；
 *   ④ 升级后 Tier-3 降幅中位数 = 以 `sessionId` 把 ② 与后续 `compaction:applied(tier=3)` 配对。
 *
 * 本脚本**判不了**的量（如实标注，不猜）：
 *   - 「升级后 3 轮内任务中断率」：`turn/end` 落在**每会话 events.jsonl**，不在 app.log；
 *     要判需另接 `EventLogStorage`（本轮不做）。⇒ 结论一律记为"中断率不可判定"。
 *
 * 用法（app 目录下）：
 *   `bun run evidence:compaction-escalation`
 *   `bun run scripts/report-compaction-escalation.ts --log <app.log> --since 2026-10-01 --min-samples 200`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLogsDir } from '@modules/environment';

/** 清单 §2.4 阈值（**先立后用**；改动须同步清单） */
const MIN_SAMPLES = 200;
const MIN_MEDIAN_SAVING_PCT = 25;
/** 升级事件与其压缩结果的配对窗口（默认 10 分钟；超出视为未配对） */
const MATCH_WINDOW_MS = 10 * 60 * 1000;

interface LogRecord {
  ts: number;
  message: string;
  meta: Record<string, unknown>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const logPath = arg('log') ?? join(resolveLogsDir(), 'app.log');
const sinceMs = arg('since') ? Date.parse(arg('since')!) : 0;
const untilMs = arg('until') ? Date.parse(arg('until')!) : Number.POSITIVE_INFINITY;
const minSamples = Number(arg('min-samples') ?? MIN_SAMPLES);

/** 容忍个别破损行：正则取必要字段（与 `scripts/logscan.ts` 同口径） */
const TS_RE = /"timestamp":"([^"]+)"/;
const MSG_RE = /"message":"((?:[^"\\]|\\.)*)"/;
const META_RE = /"meta":(\{.*\})\s*\}\s*$/;

function parseLog(text: string): LogRecord[] {
  const out: LogRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const ts = line.match(TS_RE)?.[1];
    const msg = line.match(MSG_RE)?.[1];
    if (!ts || !msg) continue;
    const at = Date.parse(ts);
    if (!Number.isFinite(at) || at < sinceMs || at > untilMs) continue;
    let meta: Record<string, unknown> = {};
    const rawMeta = line.match(META_RE)?.[1];
    if (rawMeta) {
      try {
        meta = JSON.parse(rawMeta) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }
    out.push({
      ts: at,
      message: msg.replace(/\\(.)/g, '$1'),
      meta,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function main(): void {
  if (!existsSync(logPath)) {
    console.error(`未找到日志：${logPath}`);
    console.error('提示：--log 指定 app.log 路径（默认 resolveLogsDir()/app.log）。');
    process.exitCode = 1;
    return;
  }

  const records = parseLog(readFileSync(logPath, 'utf8'));

  const skipDecisions = records.filter(
    (r) => r.message === 'compaction:决策' && r.meta['decision'] === 'skip'
  );
  const shadows = records.filter(
    (r) => r.message === 'compaction:usd_waterline_shadow'
  );
  const escalated = records.filter((r) => r.message === 'compaction:escalated');
  const appliedTier3 = records.filter(
    (r) =>
      r.message === 'compaction:applied' &&
      num(r.meta['tier']) === 3 &&
      num(r.meta['savingPercent']) !== null
  );

  // 配对：升级事件 → 同 sessionId、其后 10 分钟内的首个 Tier-3 applied
  const used = new Set<number>();
  const pairedSavings: number[] = [];
  for (const ev of escalated) {
    const sid = ev.meta['sessionId'];
    if (typeof sid !== 'string') continue;
    let best = -1;
    for (let i = 0; i < appliedTier3.length; i++) {
      if (used.has(i)) continue;
      const ap = appliedTier3[i];
      if (ap.meta['sessionId'] !== sid) continue;
      const dt = ap.ts - ev.ts;
      if (dt < 0 || dt > MATCH_WINDOW_MS) continue;
      best = i;
      break;
    }
    if (best >= 0) {
      used.add(best);
      const saving = num(appliedTier3[best].meta['savingPercent']);
      if (saving !== null) pairedSavings.push(saving);
    }
  }

  const allTier3Savings = appliedTier3
    .map((r) => num(r.meta['savingPercent']))
    .filter((v): v is number => v !== null);

  const escalateRate =
    skipDecisions.length > 0 ? escalated.length / skipDecisions.length : null;
  const pairedMedian = median(pairedSavings);
  const tier3Median = median(allTier3Savings);

  const fmt = (v: number | null, unit = '%'): string =>
    v === null ? '—（无样本）' : `${v.toFixed(1)}${unit}`;

  console.log('## T25-03 取证：CONTEXT_COMPACTION_ESCALATION\n');
  console.log(`日志：${logPath}`);
  console.log(
    `窗口：${sinceMs > 0 ? new Date(sinceMs).toISOString() : '不限'} → ${
      Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : '不限'
    }\n`
  );

  console.log('| 指标 | 值 | 说明 |');
  console.log('|---|---|---|');
  console.log(
    `| 可升级面（decision=skip） | ${skipDecisions.length} | 阈值要求 ≥ ${minSamples} |`
  );
  console.log(`| 升级次数（compaction:escalated） | ${escalated.length} | — |`);
  console.log(
    `| 升级率 | ${escalateRate === null ? '—（无可升级面）' : (escalateRate * 100).toFixed(1) + '%'} | escalated / skip |`
  );
  console.log(
    `| 压缩事件数（shadow 观测） | ${shadows.length} | 进入 _doCompact 的次数 |`
  );
  console.log(
    `| Tier-3 降幅中位数（升级配对样本 ${pairedSavings.length} 条） | ${fmt(pairedMedian)} | 阈值 ≥ ${MIN_MEDIAN_SAVING_PCT}% |`
  );
  console.log(
    `| Tier-3 降幅中位数（全部 ${allTier3Savings.length} 条） | ${fmt(tier3Median)} | 参考值 |`
  );
  console.log(
    '| 升级后 3 轮内中断率 | —（不可判定） | 需每会话 `events.jsonl` 的 `turn/end`，不在 app.log |'
  );

  console.log('\n### 结论\n');
  if (skipDecisions.length < minSamples) {
    console.log(
      `**样本不足**：可升级面 ${skipDecisions.length} < ${minSamples} ⇒ **维持默认关**。` +
        '（阈值先立于清单 §2.4，不得据小样本翻默认。）'
    );
  } else if (pairedMedian === null) {
    console.log(
      '**样本不足**：无「升级 → Tier-3」配对样本 ⇒ **维持默认关**（无法评估降幅）。'
    );
  } else if (pairedMedian < MIN_MEDIAN_SAVING_PCT) {
    console.log(
      `**不达标**：升级后 Tier-3 降幅中位数 ${pairedMedian.toFixed(1)}% < ${MIN_MEDIAN_SAVING_PCT}% ⇒ **维持默认关**。`
    );
  } else {
    console.log(
      `降幅达标（${pairedMedian.toFixed(1)}% ≥ ${MIN_MEDIAN_SAVING_PCT}%），但**中断率不可判定** ⇒ ` +
        '仍不足以翻默认；需补齐 events.jsonl 的 `turn/end` 关联后再判。'
    );
  }
}

main();
