/**
 * 学习语料的真实回归审计（M6，2026-11-15；**只读，不跑模型**）
 *
 * 规格：`.trae/specs/learning-gate-regression-audit.md`。
 *
 * 读「最近一次跑批报告」+「门禁基线」，只挑 `learning-case-*` 任务，按与 `--gate`
 * **同一份判据**（`checkTaskAgainstBaseline`）给出三态：通过 / 回归（pass^k / pass^1）/ 未登记。
 *
 * 用法：
 *   bun run scripts/report-learning-regressions.ts                 # 取 dev_docs/evals 最新报告
 *   bun run scripts/report-learning-regressions.ts -- --report=<json> --baseline=<json>
 *
 * 退出码：0 = 无回归（含"本次报告未包含学习语料"）；1 = 有回归/未登记；2 = 输入缺失或不可解析。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  auditLearningCaseGate,
  type GateReportTask,
} from '@modules/evals/tasks/learning-cases';
import type { BaselineEntry } from '@modules/evals/scoring';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`用法：
  bun run scripts/report-learning-regressions.ts
      # 取 dev_docs/evals 下最新的 eval-*.json
  bun run scripts/report-learning-regressions.ts -- --report=<json> --baseline=<json>

退出码：0 无回归 / 1 有回归或未登记 / 2 输入缺失或不可解析。`);
  process.exit(0);
}

/** 取 `--name=value` 值 */
function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

const exportDir = resolve(import.meta.dir, '../../dev_docs/evals');

/** 目录下最新的 `eval-*.json`（按 mtime 倒序取第一个） */
function latestReport(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(
    (f) => f.startsWith('eval-') && f.endsWith('.json')
  );
  if (files.length === 0) return null;
  const withTime = files.map((f) => ({
    file: join(dir, f),
    mtime: statSync(join(dir, f)).mtimeMs,
  }));
  withTime.sort((a, b) => b.mtime - a.mtime);
  return withTime[0].file;
}

const reportPath = argValue('report') || latestReport(exportDir);
if (!reportPath) {
  console.error(`未找到跑批报告：${exportDir}`);
  console.error(
    '先跑一次评测：bun run eval -- --model=<模型名> --task=<任务 id>（可加 --gate）'
  );
  process.exit(2);
}

const baselinePath =
  argValue('baseline') ||
  resolve(import.meta.dir, '../../packages/evals/src/evals/baseline.json');

let report: { startedAt?: string; model?: string; k?: number; tasks?: unknown };
let baseline: { tasks?: Record<string, BaselineEntry> };
try {
  report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
} catch (err) {
  console.error(`读取报告或基线失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

if (!Array.isArray(report.tasks)) {
  console.error(`报告格式非法（tasks 应为数组）：${reportPath}`);
  process.exit(2);
}

const audit = auditLearningCaseGate(
  report.tasks as GateReportTask[],
  baseline.tasks ?? {}
);

console.log(`报告：${reportPath}`);
console.log(
  `  时间 ${report.startedAt ?? '未知'} ｜ 模型 ${report.model ?? '未知'} ｜ k=${report.k ?? '?'}`
);
console.log(`基线：${baselinePath}`);

if (audit.total === 0) {
  console.log('\n本次跑批未包含学习语料（learning-case-*），无回归可比。');
  process.exit(0);
}

console.log(
  `\n学习语料 ${audit.total} 条：通过 ${audit.passed}，违规 ${audit.failures.length}`
);
for (const failure of audit.failures) {
  console.log(`  - [${failure.kind}] ${failure.message}`);
}

if (audit.failures.length > 0) {
  console.log(
    '\n结论：存在回归/未登记 —— 先按 --gate 报告处理（回归查因，未登记补 baseline.json）。'
  );
  process.exit(1);
}

console.log('\n结论：学习语料全部通过（与 --gate 判据一致）。');
process.exit(0);
