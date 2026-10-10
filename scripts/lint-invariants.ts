#!/usr/bin/env bun
/**
 * 不变量注册表门禁（P1-1 / P1-2 · `dev_docs/20261010/升级优化方案-20261010.md`）
 *
 * 目的（对应外部 §③「文档不能成为另一套无法验证的设计」）：
 * 把 `.trae/architecture/invariants.md` + `invariant-registry.json` 从**知识库**升级为**工程约束** ——
 * 每条不变量的**源码落点 / 验证落点**必须**真实存在**；`status=gap` 的缺口必须**显式登记**。
 *
 * 检查：
 *  1. 注册表 JSON 可解析、ID 唯一、非空；
 *  2. 每条不变量的 `sources[]` 全部存在（≥1）、`level` 合法；
 *  3. `status !== 'gap'` ⇒ `tests[]` 非空且全部存在；
 *  4. `status === 'gap'` ⇒ 其 ID 必须出现在 `invariants.md`（缺口不得被遗忘）；
 *  5. `status === 'partial'` ⇒ 同样须在 `invariants.md` 有登记；
 *  6. `specs[]` 关联 spec 路径存在；
 *  7. `invariants.md` 必备章节齐全（§0–§5）；
 *  8. `invariants.md` 内的**相对 Markdown 链接**可解析。
 *
 * 退出码：0 = 通过；1 = 有违规。**默认作为 CI 门禁**（P1-2 接入 GitHub Actions）。
 *
 * 负向自证（P1-2 验收）：路径可用环境变量覆盖 ——
 * `INVARIANTS_REPO_ROOT` / `INVARIANT_REGISTRY` / `INVARIANTS_DOC`
 * （供 `tests/gates/invariantRegistryGate.test.ts` 在临时目录构造违规样例）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRoot = process.env.INVARIANTS_REPO_ROOT
  ? resolve(process.env.INVARIANTS_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const REGISTRY = process.env.INVARIANT_REGISTRY
  ? resolve(process.env.INVARIANT_REGISTRY)
  : resolve(repoRoot, '.trae/architecture/invariant-registry.json');
const DOC = process.env.INVARIANTS_DOC
  ? resolve(process.env.INVARIANTS_DOC)
  : resolve(repoRoot, '.trae/architecture/invariants.md');

/** `invariants.md` 必备章节（缺失 ⇒ 门禁变红） */
const REQUIRED_DOC_SECTIONS = [
  '## §0',
  '## §1',
  '## §2',
  '## §3',
  '## §4',
  '## §5',
];

interface Invariant {
  id: string;
  title: string;
  statement: string;
  sources: string[];
  tests: string[];
  level: string;
  status: 'verified' | 'partial' | 'gap';
  reopenWhen: string;
  specs: string[];
}

interface Registry {
  version: number;
  levels: string[];
  invariants: Invariant[];
}

const problems: string[] = [];

function loadRegistry(): Registry | null {
  if (!existsSync(REGISTRY)) {
    problems.push(`注册表不存在: ${REGISTRY}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(REGISTRY, 'utf8')) as Registry;
  } catch (err) {
    problems.push(`注册表 JSON 解析失败: ${String(err)}`);
    return null;
  }
}

const reg = loadRegistry();
if (!reg) {
  console.error(problems.join('\n'));
  process.exit(1);
}

if (!existsSync(DOC)) problems.push(`规范文档不存在: ${DOC}`);
const docText = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';

const seen = new Set<string>();
for (const inv of reg.invariants) {
  const where = inv.id || '<missing-id>';
  if (!inv.id) problems.push('存在缺少 id 的不变量');
  if (seen.has(inv.id)) problems.push(`${where}: id 重复`);
  seen.add(inv.id);

  if (!reg.levels.includes(inv.level)) {
    problems.push(`${where}: 非法 level '${inv.level}'`);
  }
  if (!inv.sources || inv.sources.length === 0) {
    problems.push(`${where}: 无源码落点（sources 为空）`);
  }
  for (const p of inv.sources ?? []) {
    if (!existsSync(resolve(repoRoot, p))) {
      problems.push(`${where}: 源码落点不存在 → ${p}`);
    }
  }

  const tests = inv.tests ?? [];
  if (inv.status === 'verified' || inv.status === 'partial') {
    if (tests.length === 0) {
      problems.push(
        `${where}: status=${inv.status} 但无验证落点（tests 为空）`
      );
    }
  }
  for (const p of tests) {
    if (!existsSync(resolve(repoRoot, p))) {
      problems.push(`${where}: 验证落点不存在 → ${p}`);
    }
  }

  // 关联 spec 路径必须存在（ADR 索引不得悬空）
  for (const p of inv.specs ?? []) {
    if (!existsSync(resolve(repoRoot, p))) {
      problems.push(`${where}: 关联 spec 不存在 → ${p}`);
    }
  }

  // gap / partial 必须在人读文档中登记（防「缺口被遗忘」）
  if (inv.status === 'gap' || inv.status === 'partial') {
    if (!docText.includes(inv.id)) {
      problems.push(`${where}: status=${inv.status} 但未在 invariants.md 登记`);
    }
  }
}

// ── 文档完整性（P1-2）：必备章节 + 相对 Markdown 链接可解析 ──
if (docText) {
  for (const section of REQUIRED_DOC_SECTIONS) {
    if (!docText.includes(section)) {
      problems.push(`invariants.md 缺少必备章节: ${section}`);
    }
  }
  const docDir = dirname(DOC);
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const m of docText.matchAll(linkRe)) {
    const target = m[1].trim();
    // 跳过外链 / 锚点
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    if (!existsSync(resolve(docDir, clean))) {
      problems.push(`invariants.md 断链（相对链接不可解析）: ${target}`);
    }
  }
}

console.log('=== 不变量注册表门禁（P1-1 / P1-2） ===');
console.log(
  `不变量 ${reg.invariants.length} 条 · gap ${reg.invariants.filter((i) => i.status === 'gap').length} · partial ${reg.invariants.filter((i) => i.status === 'partial').length}`
);
console.log('----------------------------------------');

if (problems.length > 0) {
  console.error('❌ 存在违规:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✅ 注册表自洽：全部源码/验证落点可解析，缺口已登记');
