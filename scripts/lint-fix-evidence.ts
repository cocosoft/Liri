#!/usr/bin/env bun
/**
 * 修复证据登记门禁（P1-4 · `dev_docs/20261010/升级优化方案-20261010.md`）
 *
 * 目的（外部 §七-CHANGELOG 专项「修复声明—源码证据—测试证据闭环」/ §⑦「完成状态漂移」）：
 * 让"已修复"成为**有证据的断言** —— 四段生命周期与四个**独立**状态不得混同：
 *
 *  - `fixed`   ⇒ 必须有 `code[]` 且**路径存在**、`coded === true`；
 *  - `unitTested` ⇒ 必须有 `tests[]` 且**路径存在**、`testVerified === true`；
 *  - `e2eVerified` ⇒ 必须 `unitTested === true`（不得跳过单元直称端到端）；
 *  - `postReleaseReviewed` ⇒ 必须有 `changelog[]`、`testVerified === true`。
 *
 * 负向自证：路径可经 `FIX_EVIDENCE_REPO_ROOT` / `FIX_EVIDENCE_REGISTRY` 覆盖。
 * 退出码：0 = 通过；1 = 有违规。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.env.FIX_EVIDENCE_REPO_ROOT
  ? resolve(process.env.FIX_EVIDENCE_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const REGISTRY = process.env.FIX_EVIDENCE_REGISTRY
  ? resolve(process.env.FIX_EVIDENCE_REGISTRY)
  : resolve(repoRoot, '.trae/architecture/fix-evidence-registry.json');
const DOC = resolve(repoRoot, '.trae/architecture/修复证据登记.md');

interface Stages {
  discovered: boolean;
  fixed: boolean;
  testVerified: boolean;
  postReleaseReviewed: boolean;
}
interface Flags {
  designed: boolean;
  coded: boolean;
  unitTested: boolean;
  e2eVerified: boolean;
}
interface Item {
  id: string;
  title: string;
  source: string;
  stages: Stages;
  flags: Flags;
  code: string[];
  tests: string[];
  changelog: string[];
  reopenWhen: string;
  notes?: string;
}
interface Registry {
  version: number;
  stages: string[];
  flags: string[];
  items: Item[];
}

const problems: string[] = [];

if (!existsSync(REGISTRY)) {
  console.error(`登记表不存在: ${REGISTRY}`);
  process.exit(1);
}
let reg: Registry;
try {
  reg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as Registry;
} catch (err) {
  console.error(`登记表 JSON 解析失败: ${String(err)}`);
  process.exit(1);
}
if (!existsSync(DOC)) problems.push(`人读文档不存在: ${DOC}`);

const seen = new Set<string>();
let verifiedCount = 0;

for (const it of reg.items) {
  const w = it.id || '<missing-id>';
  if (!it.id) problems.push('存在缺少 id 的条目');
  if (seen.has(it.id)) problems.push(`${w}: id 重复`);
  seen.add(it.id);
  if (!it.reopenWhen) problems.push(`${w}: 缺少 reopenWhen（重开条件）`);

  for (const k of reg.stages) {
    if (
      typeof (it.stages as unknown as Record<string, unknown>)[k] !== 'boolean'
    ) {
      problems.push(`${w}: stages.${k} 缺失或非布尔`);
    }
  }
  for (const k of reg.flags) {
    if (
      typeof (it.flags as unknown as Record<string, unknown>)[k] !== 'boolean'
    ) {
      problems.push(`${w}: flags.${k} 缺失或非布尔`);
    }
  }

  const code = it.code ?? [];
  const tests = it.tests ?? [];
  const changelog = it.changelog ?? [];

  for (const p of [...code, ...tests]) {
    if (!existsSync(resolve(repoRoot, p))) {
      problems.push(`${w}: 证据路径不存在 → ${p}`);
    }
  }

  if (it.stages.fixed && code.length === 0) {
    problems.push(`${w}: stages.fixed=true 但无 code 证据`);
  }
  if (it.stages.fixed && !it.flags.coded) {
    problems.push(`${w}: stages.fixed=true 但 flags.coded=false（状态不一致）`);
  }
  if (it.flags.coded && code.length === 0) {
    problems.push(`${w}: flags.coded=true 但无 code 证据`);
  }
  if (it.flags.unitTested && tests.length === 0) {
    problems.push(
      `${w}: flags.unitTested=true 但无 tests 证据（不得标"已验收"）`
    );
  }
  if (it.stages.testVerified && !it.flags.unitTested) {
    problems.push(`${w}: stages.testVerified=true 但 flags.unitTested=false`);
  }
  if (it.stages.testVerified && tests.length === 0) {
    problems.push(`${w}: stages.testVerified=true 但无 tests 证据`);
  }
  if (it.flags.e2eVerified && !it.flags.unitTested) {
    problems.push(
      `${w}: flags.e2eVerified=true 但 unitTested=false（不得跳过单元直称端到端）`
    );
  }
  if (it.stages.postReleaseReviewed && changelog.length === 0) {
    problems.push(`${w}: stages.postReleaseReviewed=true 但无 changelog 记录`);
  }
  if (it.stages.postReleaseReviewed && !it.stages.testVerified) {
    problems.push(
      `${w}: stages.postReleaseReviewed=true 但 testVerified=false`
    );
  }

  if (
    it.flags.designed &&
    it.flags.coded &&
    it.flags.unitTested &&
    it.flags.e2eVerified
  ) {
    verifiedCount++;
  }
}

console.log('=== 修复证据登记门禁（P1-4） ===');
console.log(
  `条目 ${reg.items.length} · 全证据链（含端到端）${verifiedCount} · 单元级 ${reg.items.filter((i) => i.flags.unitTested).length}`
);
console.log('----------------------------------------');

if (problems.length > 0) {
  console.error('❌ 存在违规:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✅ 修复证据登记自洽：状态与证据一致，无"只改代码即称验收"');
