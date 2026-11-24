#!/usr/bin/env bun
/**
 * 状态机治理**只读巡检**（治理方案 P2-2，2026-11-24）。
 *
 * 不做修改、不阻断（除 `--check`）；把分散在目录 / 基线 / 派生登记 / 跨端词汇里的
 * 治理指标汇总成一张表，供发布前 checklist 与季度复盘使用。
 *
 * 指标：
 * 1. 目录：机器数、缺治理字段数、持久化机对账覆盖率；
 * 2. 基线：版本 / 理由 / 值数 / 文件对数 / 幽灵值（不在词汇表）/ 幽灵文件；
 * 3. 派生登记：条数与重复 concept；
 * 4. 跨端词汇：条目数；
 * 5. `@deprecated` 存量（client/src + app/src，观察期后按 CD05/CD06 删除）。
 *
 * 用法：`bun run scripts/state-governance-report.ts`（报告）／`--check`（有问题 exit 1）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BOUNDARY_STATE_MACHINES,
  STATE_MACHINES,
} from '../packages/infra/src/state/engine/stateMachineCatalog';
import { CLIENT_STATE_VOCABULARY } from '../shared/stateVocabulary';

const repoRoot = resolve(import.meta.dir, '..');
const checkMode = process.argv.includes('--check');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', '__tests__']);

function readJson<T>(rel: string): T | null {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as T;
  } catch {
    return null;
  }
}

interface BaselineV2 {
  version?: number;
  reason?: string;
  files?: Record<string, string[]>;
  valueOwners?: Record<string, string[]>;
}

interface DerivationsFile {
  derivations?: { concept?: string; implementation?: string }[];
}

/** 递归统计 `@deprecated` 出现点（只读，跳过测试/产物目录） */
function scanDeprecated(relRoot: string): { files: number; hits: number } {
  const root = join(repoRoot, relRoot);
  if (!existsSync(root)) return { files: 0, hits: 0 };
  let files = 0;
  let hits = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = readFileSync(abs, 'utf8');
      const n = (text.match(/@deprecated/g) ?? []).length;
      if (n > 0) {
        files += 1;
        hits += n;
      }
    }
  }
  return { files, hits };
}

const baseline = readJson<BaselineV2>(
  '.trae/architecture/state-literal-baseline.json'
);
const derivations = readJson<DerivationsFile>('scripts/state-derivations.json');

const vocabulary = new Set<string>();
for (const m of STATE_MACHINES) for (const s of m.states) vocabulary.add(s);

const missingOwner = STATE_MACHINES.filter((m) => !m.owner?.trim()).length;
const missingPersistence = STATE_MACHINES.filter((m) => !m.persistence).length;
const missingTerminal = STATE_MACHINES.filter(
  (m) => !Array.isArray(m.terminalStates)
).length;

const persistent = STATE_MACHINES.filter(
  (m) => m.persistence === 'json-file' || m.persistence === 'sqlite'
);
const persistentWithReconcile = persistent.filter(
  (m) => m.reconcile && m.reconcile.strategy !== 'none'
).length;

// P2-1（2026-11-24，R09-013）：审计声明覆盖（`persistence !== 'none'` 的机器）
const auditable = STATE_MACHINES.filter((m) => m.persistence !== 'none');
const auditedSessionEvent = auditable.filter(
  (m) => m.audit?.mode === 'session-event'
).length;
const auditedExempt = auditable.filter(
  (m) => m.audit?.mode === 'exempt'
).length;

const baselineFiles = baseline?.files ?? {};
const baselineValues = Object.keys(baselineFiles);
const baselinePairs = baselineValues.reduce(
  (n, v) => n + (baselineFiles[v]?.length ?? 0),
  0
);
const ghostValues = baselineValues.filter((v) => !vocabulary.has(v));
const ghostFiles = [
  ...new Set(baselineValues.flatMap((v) => baselineFiles[v] ?? [])),
].filter((f) => !existsSync(join(repoRoot, f)));

const derivationsList = derivations?.derivations ?? [];
const concepts = derivationsList.map((d) => d.concept ?? '');
const dupConcepts = concepts.filter((c, i) => c && concepts.indexOf(c) !== i);

const deprecatedClient = scanDeprecated('client/src');
const deprecatedApp = scanDeprecated('app/src');

const lines = [
  '=== 状态机治理巡检（只读） ===',
  `目录：${STATE_MACHINES.length} 台 + 边界 ${BOUNDARY_STATE_MACHINES.length} 台`,
  `  · 治理字段缺失：owner ${missingOwner} / persistence ${missingPersistence} / terminalStates ${missingTerminal}`,
  `  · 持久化机器：${persistent.length} 台，其中声明对账 ${persistentWithReconcile} 台`,
  `  · 转移审计：${auditedSessionEvent + auditedExempt}/${auditable.length}（session-event ${auditedSessionEvent} / exempt ${auditedExempt}）`,
  `基线：v${baseline?.version ?? '?'}（${baseline?.reason ? 'reason ✓' : 'reason ✗'}）`,
  `  · 值 ${baselineValues.length} / 文件对 ${baselinePairs}`,
  `  · 幽灵值 ${ghostValues.length}${ghostValues.length ? `（${ghostValues.slice(0, 5).join(', ')}）` : ''}`,
  `  · 幽灵文件 ${ghostFiles.length}${ghostFiles.length ? `（${ghostFiles.slice(0, 3).join(', ')}）` : ''}`,
  `派生登记：${derivationsList.length} 条，重复 concept ${dupConcepts.length}`,
  `跨端词汇：${CLIENT_STATE_VOCABULARY.length} 项`,
  `@deprecated：client/src ${deprecatedClient.hits} 处 / ${deprecatedClient.files} 文件；app/src ${deprecatedApp.hits} 处 / ${deprecatedApp.files} 文件`,
  `================================`,
];
console.log(lines.join('\n'));

const problems: string[] = [];
if (missingOwner || missingPersistence || missingTerminal) {
  problems.push('目录存在缺失治理字段');
}
if (persistent.length !== persistentWithReconcile) {
  problems.push('存在未声明对账的持久化机器');
}
if (auditedSessionEvent + auditedExempt !== auditable.length) {
  problems.push('存在未声明审计的持久化机器');
}
if (ghostValues.length > 0) problems.push('基线含幽灵值（不在词汇表）');
if (ghostFiles.length > 0) problems.push('基线含幽灵文件（不存在）');
if (dupConcepts.length > 0) problems.push('派生登记存在重复 concept');

if (checkMode) {
  if (problems.length > 0) {
    console.error(
      `❌ 巡检发现 ${problems.length} 类问题：${problems.join('；')}`
    );
    process.exit(1);
  }
  console.log('✅ 巡检通过');
}
process.exit(0);
