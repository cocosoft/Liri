#!/usr/bin/env bun
/**
 * 执行入口注册门禁（P1-3 · `dev_docs/20261010/升级优化方案-20261010.md`）
 *
 * 目的（外部 §八.1「建立执行入口注册清单，确保新增入口必须声明执行身份/权限边界/取消语义/
 * 持久化契约/恢复策略」）：扫描 `app/src` 中**启动对话轮 / 取得执行所有权**的调用点，
 * 要求**每一处**都在 `.trae/architecture/execution-entrypoints.json` 登记 —— 新增入口**漏登记即 CI 阻断**。
 *
 * 检查（双向）：
 *  1. 扫描到的 (文件, 模式) 必须已登记（防"新增入口不登记"）；
 *  2. 登记的文件必须存在，且其 `patterns` 必须**实际命中**（防"入口已删/改名而登记未同步"）。
 *
 * 负向自证：路径可用环境变量覆盖 —— `ENTRYPOINTS_REPO_ROOT` / `ENTRYPOINTS_REGISTRY` / `ENTRYPOINTS_SCAN_ROOT`。
 * 退出码：0 = 通过；1 = 有违规。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = process.env.ENTRYPOINTS_REPO_ROOT
  ? resolve(process.env.ENTRYPOINTS_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const REGISTRY = process.env.ENTRYPOINTS_REGISTRY
  ? resolve(process.env.ENTRYPOINTS_REGISTRY)
  : resolve(repoRoot, '.trae/architecture/execution-entrypoints.json');
const SCAN_ROOT = process.env.ENTRYPOINTS_SCAN_ROOT
  ? resolve(process.env.ENTRYPOINTS_SCAN_ROOT)
  : resolve(repoRoot, 'app/src');

interface Pattern {
  id: string;
  regex: string;
  description: string;
}
interface Entry {
  file: string;
  patterns: string[];
  label: string;
  status: string;
  notes: string;
}
interface Registry {
  version: number;
  patterns: Pattern[];
  entries: Entry[];
}

const problems: string[] = [];

if (!existsSync(REGISTRY)) {
  console.error(`注册表不存在: ${REGISTRY}`);
  process.exit(1);
}
let reg: Registry;
try {
  reg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as Registry;
} catch (err) {
  console.error(`注册表 JSON 解析失败: ${String(err)}`);
  process.exit(1);
}

/** 递归收集扫描根下的 .ts（排除测试） */
function collectTs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      collectTs(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const norm = (p: string): string => relative(repoRoot, p).split('\\').join('/');

const files = collectTs(SCAN_ROOT);
const found = new Map<string, Set<string>>(); // file -> patternIds
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const pat of reg.patterns) {
    if (new RegExp(pat.regex).test(content)) {
      const key = norm(file);
      if (!found.has(key)) found.set(key, new Set());
      found.get(key)!.add(pat.id);
    }
  }
}

// ① 扫描到的入口必须已登记
const registered = new Map<string, Set<string>>();
for (const e of reg.entries) {
  registered.set(e.file, new Set(e.patterns));
}
for (const [file, pats] of found) {
  const regPats = registered.get(file);
  if (!regPats) {
    problems.push(
      `未登记的执行入口: ${file}（命中 ${[...pats].join(', ')}）—— 请在 execution-entrypoints.json 登记`
    );
    continue;
  }
  for (const p of pats) {
    if (!regPats.has(p)) {
      problems.push(`执行入口登记不完整: ${file} 命中 '${p}' 但未在该文件登记`);
    }
  }
}

// ② 登记的文件必须存在，且其声明模式必须实际命中（防登记漂移）
for (const e of reg.entries) {
  if (!existsSync(resolve(repoRoot, e.file))) {
    problems.push(`登记的执行入口文件不存在: ${e.file}`);
    continue;
  }
  const hit = found.get(e.file) ?? new Set<string>();
  for (const p of e.patterns) {
    if (!hit.has(p)) {
      problems.push(
        `登记漂移: ${e.file} 声明模式 '${p}' 但扫描未命中（入口已改动？请同步注册表）`
      );
    }
  }
}

console.log('=== 执行入口注册门禁（P1-3） ===');
console.log(
  `模式 ${reg.patterns.length} · 登记入口 ${reg.entries.length} 文件 · 扫描命中 ${found.size} 文件`
);
console.log('----------------------------------------');

if (problems.length > 0) {
  console.error('❌ 存在违规:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✅ 执行入口注册自洽：扫描命中与登记一致');
