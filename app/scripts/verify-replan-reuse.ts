#!/usr/bin/env bun
/**
 * verify-replan-reuse.ts — 长程任务修复（P0-1 / P0-2）日志断言
 *
 * 背景：`PDCA` 目标门取证闭环与 replan 增量复用落地后，剩余风险只能通过**真实长程任务**
 * 验证（陈旧审查假失败、复用是否真的跳过重跑、复用安全性）。本脚本把验收判据收敛为
 * 对 `app.log`（JSONL，UTC）的确定性断言，避免人工肉眼翻日志。
 *
 * 用法（cwd = app/）：
 *   bun run verify:replan-reuse -- --task pdca_xxx --scenario A
 *   bun run verify:replan-reuse -- --task pdca_xxx --scenario B --expect-reusable 4 --expect-rerun 1
 *   bun run verify:replan-reuse -- --task pdca_xxx --scenario C --expect-reusable 3
 *
 * 选项：
 *   --task <id>              只看该任务（强烈建议；缺省则扫全量日志）
 *   --scenario A|B|C         A=陈旧审查假失败；B=增量复用生效；C=产物改写后不复用
 *   --log <path>             默认 <pyappHome>/data/logs/app.log
 *   --since <ISO>            只看该时间之后的记录（UTC，如 2026-11-09T04:00:00Z）
 *   --expect-reusable <n>    断言最后一次 replan 的 reusable 数量
 *   --expect-rerun <n>       断言最后一次 replan 的 rerun 数量
 *
 * 退出码：0=PASS；1=断言失败；2=日志/参数不可用。**显式退出**（lint:exit 要求）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Scenario = 'A' | 'B' | 'C';

interface LogRecord {
  timestamp?: string;
  level?: string;
  module?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

interface Options {
  logPath: string;
  taskId?: string;
  scenario: Scenario;
  since?: string;
  expectReusable?: number;
  expectRerun?: number;
}

interface ReplanEvent {
  timestamp: string;
  total: number;
  previouslyCompleted: number;
  reusable: number;
  rerun: number;
}

interface ReuseAppliedEvent {
  timestamp: string;
  reused: number;
  planned: number;
}

/** 断言失败项（空数组 = PASS） */
interface Verdict {
  failures: string[];
  notes: string[];
}

const SCENARIO_TITLES: Record<Scenario, string> = {
  A: '陈旧审查假失败（目标门取证闭环）',
  B: '增量复用生效（completed 且产物未变）',
  C: '复用安全性（产物被改写后不复用）',
};

function usage(): never {
  console.error(
    [
      '用法: bun run verify:replan-reuse -- --task <id> --scenario <A|B|C> [--log <path>]',
      '      [--since <ISO>] [--expect-reusable <n>] [--expect-rerun <n>]',
    ].join('\n')
  );
  process.exit(2);
}

function parseNonNegativeInt(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`参数 ${flag} 需要非负整数，收到: ${raw}`);
    process.exit(2);
  }
  return value;
}

function defaultLogPath(): string {
  const home = process.env.PYAPP_HOME ?? join(homedir(), '.pyapp');
  return join(home, 'data', 'logs', 'app.log');
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    logPath: defaultLogPath(),
    scenario: 'A',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const readNext = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`参数 ${flag} 缺少取值`);
        usage();
      }
      i += 1;
      return value;
    };
    switch (flag) {
      case '--task':
        options.taskId = readNext();
        break;
      case '--scenario': {
        const value = readNext().toUpperCase();
        if (value !== 'A' && value !== 'B' && value !== 'C') {
          console.error(`未知场景: ${value}`);
          usage();
        }
        options.scenario = value;
        break;
      }
      case '--log':
        options.logPath = readNext();
        break;
      case '--since':
        options.since = readNext();
        break;
      case '--expect-reusable':
        options.expectReusable = parseNonNegativeInt(
          flag,
          readNext()
        );
        break;
      case '--expect-rerun':
        options.expectRerun = parseNonNegativeInt(flag, readNext());
        break;
      case '--help':
      case '-h':
        usage();
        break;
      default:
        console.error(`未知参数: ${flag}`);
        usage();
    }
  }
  return options;
}

/** 读取 JSONL；坏行跳过并计数（不因一行破损让整次验收失败） */
function readRecords(logPath: string): { records: LogRecord[]; skipped: number } {
  const content = readFileSync(logPath, 'utf-8');
  const records: LogRecord[] = [];
  let skipped = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        records.push(parsed as LogRecord);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

function recordMatchesTask(record: LogRecord, taskId: string): boolean {
  const metaTask = record.meta?.taskId;
  if (typeof metaTask === 'string') return metaTask === taskId;
  // 兜底：部分日志把 taskId 嵌在 message / 其他 meta（字符串化后包含即可）
  return JSON.stringify(record).includes(taskId);
}

function inSinceWindow(record: LogRecord, since?: string): boolean {
  if (!since) return true;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) {
    console.error(`--since 不是合法时间: ${since}`);
    process.exit(2);
  }
  const recordMs = Date.parse(record.timestamp ?? '');
  return Number.isNaN(recordMs) ? false : recordMs >= sinceMs;
}

function numberOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function collectReplanEvents(records: LogRecord[]): ReplanEvent[] {
  return records
    .filter((r) => r.message === 'replan 计划重建（增量复用）')
    .map((r) => ({
      timestamp: r.timestamp ?? '',
      total: numberOf(r.meta?.total),
      previouslyCompleted: numberOf(r.meta?.previouslyCompleted),
      reusable: numberOf(r.meta?.reusable),
      rerun: numberOf(r.meta?.rerun),
    }));
}

function collectReuseAppliedEvents(
  records: LogRecord[]
): ReuseAppliedEvent[] {
  return records
    .filter((r) => r.message === '[orchestrator] replan 复用产物未变步骤')
    .map((r) => ({
      timestamp: r.timestamp ?? '',
      reused: numberOf(r.meta?.reused),
      planned: numberOf(r.meta?.planned),
    }));
}

/** 判断某条记录是否含"目标未收敛"标记（错误码可能落在 message / meta 任意位置） */
function isUnconvergedRecord(record: LogRecord): boolean {
  const message = record.message ?? '';
  if (message.includes('目标级评估未收敛')) return true;
  if (message.includes('PDCA_GOAL_NOT_CONVERGED')) return true;
  return JSON.stringify(record.meta ?? {}).includes('PDCA_GOAL_NOT_CONVERGED');
}

function judgeScenarioA(records: LogRecord[]): Verdict {
  const failures: string[] = [];
  const notes: string[] = [];
  const goalEvaluations = records.filter(
    (r) => r.message === '目标级评估完成'
  );
  const unconverged = records.filter(isUnconvergedRecord);
  const autoReplans = records.filter((r) =>
    (r.message ?? '').includes('目标未收敛 ⇒ 自动 replan')
  );
  const degraded = records.filter((r) =>
    (r.message ?? '').includes('目标级评估失败，跳过结论')
  );
  if (goalEvaluations.length === 0) {
    failures.push(
      '未找到"目标级评估完成"记录：目标门未执行（场景 A 不能判定为通过）'
    );
  } else {
    const last = goalEvaluations[goalEvaluations.length - 1];
    notes.push(
      `目标级评估: converged=${String(last.meta?.converged)} ` +
        `evaluated=${String(last.meta?.evaluated)}`
    );
  }
  if (unconverged.length > 0) {
    failures.push(
      `出现目标未收敛标记 ${unconverged.length} 次（期望 0）：疑似陈旧审查仍触发假失败`
    );
  }
  if (autoReplans.length > 0) {
    failures.push(
      `出现"目标未收敛 ⇒ 自动 replan" ${autoReplans.length} 次（期望 0）`
    );
  }
  if (degraded.length > 0) {
    notes.push(
      `目标级评估降级 ${degraded.length} 次（跳过结论，本身不算失败，但说明评估未拿到可信结论）`
    );
  }
  return { failures, notes };
}

function judgeScenarioB(
  replans: ReplanEvent[],
  reuseEvents: ReuseAppliedEvent[],
  options: Options
): Verdict {
  const failures: string[] = [];
  const notes: string[] = [];
  if (replans.length === 0) {
    failures.push('未找到 replan 事件（缺少 "replan 计划重建（增量复用）"）');
    return { failures, notes };
  }
  const last = replans[replans.length - 1];
  if (last.reusable <= 0) {
    failures.push(
      `最后一次 replan 的 reusable=${last.reusable}（期望 ≥1）：复用未生效，检查计划描述是否被改写`
    );
  }
  if (reuseEvents.length === 0) {
    failures.push(
      '未找到"复用产物未变步骤"应用记录：reusable 候选未落到新计划'
    );
  } else if (reuseEvents[reuseEvents.length - 1].reused <= 0) {
    failures.push('复用应用记录 reused=0');
  }
  if (
    options.expectReusable !== undefined &&
    last.reusable !== options.expectReusable
  ) {
    failures.push(
      `reusable=${last.reusable}，期望 ${options.expectReusable}`
    );
  }
  if (options.expectRerun !== undefined && last.rerun !== options.expectRerun) {
    failures.push(`rerun=${last.rerun}，期望 ${options.expectRerun}`);
  }
  notes.push(
    `最后一次 replan: total=${last.total} reusable=${last.reusable} rerun=${last.rerun}`
  );
  return { failures, notes };
}

function judgeScenarioC(
  replans: ReplanEvent[],
  options: Options
): Verdict {
  const failures: string[] = [];
  const notes: string[] = [];
  if (replans.length === 0) {
    failures.push('未找到 replan 事件，无法判断复用安全性');
    return { failures, notes };
  }
  const last = replans[replans.length - 1];
  if (
    options.expectReusable !== undefined &&
    last.reusable !== options.expectReusable
  ) {
    failures.push(
      `reusable=${last.reusable}，期望 ${options.expectReusable}（被改写产物的步骤应退出复用）`
    );
  }
  notes.push(
    `最后一次 replan: reusable=${last.reusable} rerun=${last.rerun}；` +
      '还需人工核对被改写步骤的产物 mtime 已更新（见验收清单）'
  );
  return { failures, notes };
}

function judge(
  options: Options,
  records: LogRecord[],
  replans: ReplanEvent[],
  reuseEvents: ReuseAppliedEvent[]
): Verdict {
  switch (options.scenario) {
    case 'A':
      return judgeScenarioA(records);
    case 'B':
      return judgeScenarioB(replans, reuseEvents, options);
    case 'C':
      return judgeScenarioC(replans, options);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.logPath)) {
    console.error(`日志不存在: ${options.logPath}`);
    process.exit(2);
  }
  const { records, skipped } = readRecords(options.logPath);
  const scoped = records.filter((r) => {
    if (options.taskId && !recordMatchesTask(r, options.taskId)) return false;
    return inSinceWindow(r, options.since);
  });
  const replans = collectReplanEvents(scoped);
  const reuseEvents = collectReuseAppliedEvents(scoped);
  const verdict = judge(options, scoped, replans, reuseEvents);

  console.log('=== 长程任务修复日志断言 ===');
  console.log(`场景: ${options.scenario} — ${SCENARIO_TITLES[options.scenario]}`);
  console.log(`日志: ${options.logPath}`);
  console.log(`任务: ${options.taskId ?? '(全部任务)'}`);
  if (options.since) console.log(`起始: ${options.since}`);
  console.log(`记录: ${scoped.length}（全量 ${records.length}，坏行 ${skipped}）`);
  console.log(`replan 事件: ${replans.length}；复用应用事件: ${reuseEvents.length}`);
  for (const note of verdict.notes) console.log(`· ${note}`);
  if (verdict.failures.length === 0) {
    console.log('结果: PASS');
    process.exit(0);
  }
  console.log(`结果: FAIL（${verdict.failures.length} 项）`);
  for (const failure of verdict.failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}

main();
