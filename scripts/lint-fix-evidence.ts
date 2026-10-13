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

/**
 * 定位登记表内**未转义的 ASCII 双引号**（我已在登记表上三次因此使 JSON 破损）。
 *
 * 判据（纯文本扫描，**不依赖 JSON 错误文本** —— bun 的 `JSON Parse error` 不带位置）：
 * 逐字符串边界推进（含 `\` 转义跳过）；字符串闭合后的下一个**非空白**字符**必须**是
 * `,` `}` `]` `:` 之一；否则该处 `"` 即"提前闭合"的元凶 ⇒ 返回其行列与所在行内容。
 */
function locateStrayQuote(file: string): {
  line: number;
  col: number;
  text: string;
} | null {
  const src = readFileSync(file, 'utf8');
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j] as string)) j++;
        const next = src[j];
        if (next !== undefined && !',}]:'.includes(next)) {
          const before = src.slice(0, i);
          const line = before.split('\n').length;
          const col = i - before.lastIndexOf('\n');
          const raw = src.split('\n')[line - 1] ?? '';
          return {
            line,
            col,
            text: raw.length > 160 ? `${raw.slice(0, 160)}…` : raw,
          };
        }
        inStr = false; // 正常闭合 ⇒ 复位（否则下一处开引号会被误判为闭合）
      }
      continue;
    }
    if (ch === '"') inStr = true;
  }
  return null;
}

if (!existsSync(REGISTRY)) {
  console.error(`登记表不存在: ${REGISTRY}`);
  process.exit(1);
}
let reg: Registry;
try {
  reg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as Registry;
} catch (err) {
  console.error(`登记表 JSON 解析失败: ${String(err)}`);
  // 精确诊断：本仓最常见根因 = 字符串内用了**未转义的 ASCII 双引号**
  // 规范见 `.trae/rules/coding-standards.md` §CS08（机器可读 JSON/YAML 内字符串一律用中文引号「」）。
  const spot = locateStrayQuote(REGISTRY);
  if (spot) {
    console.error(
      [
        '  ⚠️ 疑似**未转义的 ASCII 双引号** ⇒ 字符串提前闭合；规范见 .trae/rules/coding-standards.md §CS08（字符串内容里一律用中文引号「」）。',
        `     位置: ${REGISTRY}:${spot.line}:${spot.col}`,
        `     该行: ${spot.text}`,
        '     如确需 ASCII 引号，必须在源文件里写作 \\" （转义）。',
      ].join('\n')
    );
  }
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
