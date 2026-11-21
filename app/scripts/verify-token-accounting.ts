#!/usr/bin/env bun
/**
 * Token 会计一致性**离线复验**（方案 `.trae/specs/token-accounting-unification.md` §5 P4）
 *
 * 目的：把 P4「同一会话跑满窗口」的复验从"肉眼看日志"变成**可证伪的断言集**。
 * 只读 `app.log`（含轮转文件），不触发模型、不改任何运行行为。
 *
 * 判据（全部来自既有日志字段，字段名以代码为准 —— 见 `CompactionOrchestrator`）：
 *  ① `compaction:决策`    必须有 finite 的 `rawInputTokens` / `calibratedTotal` / `ratio` / `maxTokens`；
 *  ② `compaction:applied` 的 `savingPercent` 必须与 `(beforeTokens-afterTokens)/beforeTokens` 同源
 *     （容差 0.2，覆盖 `toFixed(1)` 舍入；`afterTokens > beforeTokens` 时不得报正节省）；
 *  ③ `compaction:token_estimate_mismatch` **只允许**在 `estimateLowerBound === true` 时出现
 *     （方案口径：决策 raw 与实测 raw 的差异只应来自"触达 1× 窗口的下界"，否则是三套估值并存）；
 *  ④ 上述三类事件都不得携带已删除的 `snapshot` 字段（P1 回归守卫）。
 *
 * 判不了的量（如实标注，不猜）：
 *  - 「会话是否真的跑满窗口」：日志里没有窗口容量快照 ⇒ 只能靠样本量提示，不能自动判定；
 *  - 「失败是否可见」：只统计 `tier3_rejected_no_reduction` / `still_over_budget_after_compaction` /
 *    `no_effect` 的出现次数，**不做**因果断言（`no_effect` 有其它合法来源）。
 *
 * 用法（app 目录下）：
 *   `bun run verify:token-accounting`                         # 扫默认日志目录（含轮转）
 *   `bun run scripts/verify-token-accounting.ts --log <app.log>`
 *   `bun run scripts/verify-token-accounting.ts --since 2026-11-21T00:00:00Z --min-applied 1`
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败；2 = 输入/样本不足（**不得**当成通过，AR-3）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolveLogsDir } from '@openliri/infra/environment';
import { listLogFiles } from './logscan';

export interface TokenLogRecord {
  ts: number;
  message: string;
  meta: Record<string, unknown>;
}

export interface TokenAccountingCheck {
  id: string;
  ok: boolean;
  detail: string;
  violations: string[];
}

export interface TokenAccountingReport {
  checks: TokenAccountingCheck[];
  samples: {
    decisions: number;
    applied: number;
    mismatches: number;
    noEffect: number;
    tier3Rejected: number;
    stillOverBudget: number;
  };
  verdict: 'pass' | 'insufficient' | 'fail';
}

const DECISION_MSG = 'compaction:决策';
const APPLIED_MSG = 'compaction:applied';
const MISMATCH_MSG = 'compaction:token_estimate_mismatch';

const TS_RE = /"timestamp":"([^"]+)"/;
const MSG_RE = /"message":"((?:[^"\\]|\\.)*)"/;
const META_RE = /"meta":(\{.*\})\s*\}\s*$/;

/** 解析 JSONL 日志行（容忍少量破损行；meta 需完整，不截断） */
export function parseTokenLog(text: string, sinceMs = 0): TokenLogRecord[] {
  const out: TokenLogRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const ts = line.match(TS_RE)?.[1];
    const msg = line.match(MSG_RE)?.[1];
    if (!ts || !msg) continue;
    const at = Date.parse(ts);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    let meta: Record<string, unknown> = {};
    const rawMeta = line.match(META_RE)?.[1];
    if (rawMeta) {
      try {
        meta = JSON.parse(rawMeta) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }
    out.push({ ts: at, message: msg.replace(/\\(.)/g, '$1'), meta });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * 纯分析函数（便于单测）：输入日志条目，输出断言结论。
 *
 * @param entries      已解析的日志条目（可含无关消息，本函数只挑四类事件）
 * @param minApplied   样本下限（默认 1；真机长会话通常 > 1）
 */
export function analyzeTokenAccounting(
  entries: readonly TokenLogRecord[],
  minApplied = 1
): TokenAccountingReport {
  const decisions = entries.filter((e) => e.message === DECISION_MSG);
  const applied = entries.filter((e) => e.message === APPLIED_MSG);
  const mismatches = entries.filter((e) => e.message === MISMATCH_MSG);
  const noEffect = entries.filter((e) => e.message === 'compaction:no_effect');
  const tier3Rejected = entries.filter(
    (e) => e.message === 'compaction:tier3_rejected_no_reduction'
  );
  const stillOverBudget = entries.filter(
    (e) => e.message === 'compaction:still_over_budget_after_compaction'
  );

  const checks: TokenAccountingCheck[] = [];

  // ① 决策字段完整
  // 变更前（< 2026-11-18 P1）的旧格式日志没有这些字段 ⇒ 单独计为 legacySkipped，
  // 不判违规（否则历史日志会把门禁永久染红）。只要**部分**字段缺失 ⇒ 判违规。
  const decisionViolations: string[] = [];
  let legacyDecisions = 0;
  for (const e of decisions) {
    const hasRaw = num(e.meta['rawInputTokens']) !== null;
    const hasCalibrated = num(e.meta['calibratedTotal']) !== null;
    if (!hasRaw && !hasCalibrated) {
      legacyDecisions += 1;
      continue;
    }
    for (const key of [
      'rawInputTokens',
      'calibratedTotal',
      'ratio',
      'maxTokens',
    ]) {
      if (num(e.meta[key]) === null) {
        decisionViolations.push(
          `${new Date(e.ts).toISOString()} ${DECISION_MSG} 缺少数值字段 ${key}`
        );
      }
    }
  }
  checks.push({
    id: 'decision_fields',
    ok: decisionViolations.length === 0,
    detail: `${decisions.length} 条决策（旧格式跳过 ${legacyDecisions} 条）`,
    violations: decisionViolations,
  });

  // ② applied 的 savingPercent 与前后 raw 同源
  const appliedViolations: string[] = [];
  for (const e of applied) {
    const before = num(e.meta['beforeTokens']);
    const after = num(e.meta['afterTokens']);
    const saving = num(e.meta['savingPercent']);
    if (before === null || after === null || saving === null) {
      appliedViolations.push(
        `${new Date(e.ts).toISOString()} ${APPLIED_MSG} 缺少 before/after/savingPercent`
      );
      continue;
    }
    if (before <= 0) {
      appliedViolations.push(
        `${new Date(e.ts).toISOString()} ${APPLIED_MSG} beforeTokens=${before} 非正`
      );
      continue;
    }
    const expected = ((before - after) / before) * 100;
    if (Math.abs(saving - expected) > 0.2) {
      appliedViolations.push(
        `${new Date(e.ts).toISOString()} ${APPLIED_MSG} savingPercent=${saving} 与 ` +
          `(before-after)/before=${expected.toFixed(2)} 不一致`
      );
    }
    if (after > before && saving > 0) {
      appliedViolations.push(
        `${new Date(e.ts).toISOString()} ${APPLIED_MSG} 变大却报正节省 ` +
          `(before=${before}, after=${after}, savingPercent=${saving})`
      );
    }
  }
  checks.push({
    id: 'applied_consistency',
    ok: appliedViolations.length === 0,
    detail: `${applied.length} 条压缩结果`,
    violations: appliedViolations,
  });

  // ③ raw 差异只允许来自"下界"
  const mismatchViolations: string[] = [];
  for (const e of mismatches) {
    if (e.meta['estimateLowerBound'] !== true) {
      mismatchViolations.push(
        `${new Date(e.ts).toISOString()} ${MISMATCH_MSG} estimateLowerBound!=true ` +
          `（decisionRaw=${String(e.meta['decisionRawInputTokens'])} ` +
          `measuredRaw=${String(e.meta['measuredRawInputTokens'])}）`
      );
    }
  }
  checks.push({
    id: 'raw_three_way',
    ok: mismatchViolations.length === 0,
    detail: `${mismatches.length} 条 raw 差异告警（应全部带 estimateLowerBound=true）`,
    violations: mismatchViolations,
  });

  // ④ 已删除的 snapshot 字段不得回流
  const snapshotViolations: string[] = [];
  for (const e of [...decisions, ...applied, ...mismatches]) {
    if (Object.prototype.hasOwnProperty.call(e.meta, 'snapshot')) {
      snapshotViolations.push(
        `${new Date(e.ts).toISOString()} ${e.message} 仍携带已删除的 snapshot 字段`
      );
    }
  }
  checks.push({
    id: 'no_snapshot',
    ok: snapshotViolations.length === 0,
    detail: 'P1 回归守卫',
    violations: snapshotViolations,
  });

  const samples = {
    decisions: decisions.length,
    applied: applied.length,
    mismatches: mismatches.length,
    noEffect: noEffect.length,
    tier3Rejected: tier3Rejected.length,
    stillOverBudget: stillOverBudget.length,
  };

  const failed = checks.some((c) => !c.ok);
  // 样本不足 ⇒ 单独判定（**不得**当成通过）；断言失败优先级更高，便于先修问题
  const insufficient = decisions.length === 0 || applied.length < minApplied;
  return {
    checks,
    samples,
    verdict: failed ? 'fail' : insufficient ? 'insufficient' : 'pass',
  };
}

/** 解析 `--flag value` */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const sinceMs = arg('since') ? Date.parse(arg('since')!) : 0;
  const minApplied = Number(arg('min-applied') ?? '1');
  const single = arg('log');

  let files: string[];
  if (single) {
    if (!existsSync(single)) {
      console.error(`未找到日志：${single}`);
      process.exit(2);
    }
    files = [single];
  } else {
    const dir = arg('dir') ?? resolveLogsDir();
    files = listLogFiles(dir);
    if (files.length === 0) {
      console.error(`日志目录无文件：${dir}`);
      process.exit(2);
    }
  }

  const entries = files.flatMap((f) =>
    parseTokenLog(readFileSync(f, 'utf8'), sinceMs)
  );
  const report = analyzeTokenAccounting(entries, minApplied);

  console.log('=== Token 会计一致性复验（P4 真机长会话） ===');
  console.log(`日志：${files.length} 个文件`);
  console.log(
    `样本：决策 ${report.samples.decisions} · applied ${report.samples.applied} · ` +
      `mismatch ${report.samples.mismatches} · no_effect ${report.samples.noEffect} · ` +
      `tier3_rejected ${report.samples.tier3Rejected} · ` +
      `still_over_budget ${report.samples.stillOverBudget}`
  );
  console.log('----------------------------------------');
  for (const c of report.checks) {
    console.log(`${c.ok ? '✅' : '❌'} [${c.id}] ${c.detail}`);
    for (const v of c.violations.slice(0, 10)) console.log(`   - ${v}`);
    if (c.violations.length > 10) {
      console.log(`   … 另有 ${c.violations.length - 10} 条`);
    }
  }
  console.log('----------------------------------------');

  if (report.verdict === 'fail') {
    console.error(
      '❌ 断言失败：见上方 ❌ 项（口径见 token-accounting-unification.md §5 P4）。'
    );
    process.exit(1);
  }
  if (report.verdict === 'insufficient') {
    console.error(
      `❌ 样本不足：决策 ${report.samples.decisions} / applied ${report.samples.applied}` +
        `（要求 applied ≥ ${minApplied}）⇒ 需在同一会话跑满窗口后重跑本脚本；` +
        '**不得**把本结果当成通过。'
    );
    process.exit(2);
  }
  console.log(
    '✅ 通过：字段完整、节省口径同源、raw 差异仅来自下界、无 snapshot 回流。'
  );
}

if (import.meta.main) main();
