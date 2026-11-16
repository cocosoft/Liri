#!/usr/bin/env bun
/**
 * lint:dream-exports — `packages/dream` 的**公开子路径白名单**校验（P0-1 子项 1，2026-11-14）
 *
 * 背景：`dream` 是 23 个拆分包里最后一个「半拆」包 —— 对外曾用 `"./*"` 通配符导出、
 * 对内曾用 `@modules/dream/*` 旧别名。通配符导出会让**任何**新增文件自动变成公开 API，
 * 且独立发布后深路径 import 一旦未登记就解析失败。修法参照 `scripts/lint-kernel-purity.ts`
 * 的 K07（内核公开子路径白名单）：把「哪些子路径是公开的」变成**可校验的清单**而不是约定。
 *
 * 判据（三条，全部 fail-closed）：
 *   D01 `exports` 不得含通配符键（`*`）—— 否则等于没有白名单；
 *   D02 每个 `exports` 条目的目标文件必须存在 —— 防「删了文件、忘了删导出」的悬空条目；
 *   D03 全仓对 `@openliri/dream/<sub>` 的 import 说明符必须落在 `exports` 键集合内
 *       —— 防「加了深路径 import、没登记 exports」在独立发布后炸掉。
 *
 * 反向自证（AR-3）：包元数据读不到 / `exports` 键数低于下限（结构被改坏）⇒ exit 1，
 * 不得打印「✅ 通过」冒充绿灯。
 *
 * 退出码：0 = 三条判据全过；1 = 任一判据失败或输入不可信。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { resolveSourceRootPaths } from '../../scripts/lib/sourceRoots';

const APP_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = process.env['PYAPP_PROJECT_DIR']
  ? resolve(process.env['PYAPP_PROJECT_DIR'])
  : resolve(APP_DIR, '..');
const DREAM_PKG_FILE = join(REPO_ROOT, 'packages', 'dream', 'package.json');
const CLIENT_SRC = join(REPO_ROOT, 'client', 'src');

/**
 * `exports` 键数下限（当前 36 键）。
 *
 * 取值理由：解析失败 / 结构被改坏（例如有人把 exports 换成字符串或删空）时，
 * 下方的「0 处违规」会是**假绿**；下限让这种结构变化直接报错。
 */
const MIN_EXPORTS_KEYS = 10;

interface DreamPackageJson {
  exports?: Record<string, unknown>;
}

function fail(msg: string): never {
  console.error(`❌ [dream-exports] ${msg}`);
  process.exit(1);
}

if (!existsSync(DREAM_PKG_FILE)) fail(`缺少 ${DREAM_PKG_FILE}`);

let pkg: DreamPackageJson;
try {
  pkg = JSON.parse(readFileSync(DREAM_PKG_FILE, 'utf-8')) as DreamPackageJson;
} catch (error) {
  fail(`解析 ${DREAM_PKG_FILE} 失败（不得当成 0 违规）：${String(error)}`);
}

const exportsMap = pkg.exports;
if (!exportsMap || typeof exportsMap !== 'object') {
  fail('`exports` 缺失或不是对象 —— 拆包后必须逐文件声明公开入口');
}
const exportKeys = Object.keys(exportsMap);
if (exportKeys.length < MIN_EXPORTS_KEYS) {
  fail(
    `\`exports\` 只有 ${exportKeys.length} 个键（下限 ${MIN_EXPORTS_KEYS}）—— 结构可能被改坏，按失败处理`
  );
}

const problems: string[] = [];

// D01：禁止通配符键
for (const key of exportKeys) {
  if (key.includes('*')) {
    problems.push(`D01 通配符导出 "${key}" —— 必须逐文件列公开入口（参照 kernel 的零通配符）`);
  }
}

// D02：每个条目的目标文件必须存在
function collectTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectTargets);
  }
  return [];
}
for (const key of exportKeys) {
  const targets = collectTargets(exportsMap[key]);
  if (targets.length === 0) {
    problems.push(`D02 导出 "${key}" 没有可解析的目标路径`);
    continue;
  }
  for (const target of targets) {
    if (!target.startsWith('./')) {
      problems.push(`D02 导出 "${key}" 的目标 "${target}" 必须以 ./ 开头`);
      continue;
    }
    const abs = join(REPO_ROOT, 'packages', 'dream', target);
    if (!existsSync(abs)) {
      problems.push(`D02 导出 "${key}" 指向不存在的文件 ${relative(REPO_ROOT, abs)}`);
    }
  }
}

// D03：全仓 import 说明符必须落在 exports 键集合内
const knownSpecifiers = new Set<string>(['@openliri/dream']);
for (const key of exportKeys) {
  if (key === '.') continue;
  knownSpecifiers.add(`@openliri/dream/${key.slice(2)}`);
}

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) return collectSources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const scanRoots = [
  ...resolveSourceRootPaths(REPO_ROOT),
  ...(existsSync(CLIENT_SRC) ? [CLIENT_SRC] : []),
];
const SPECIFIER_RE = /['"](@openliri\/dream[^'"]*)['"]/g;
for (const file of scanRoots.flatMap(collectSources)) {
  const text = readFileSync(file, 'utf-8');
  for (const match of text.matchAll(SPECIFIER_RE)) {
    const spec = match[1]!;
    if (!knownSpecifiers.has(spec)) {
      problems.push(
        `D03 ${relative(REPO_ROOT, file)} 引用了未登记的公开子路径 "${spec}"（请在 packages/dream/package.json 的 exports 中登记）`
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`❌ [dream-exports] 发现 ${problems.length} 处问题：`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

console.log(
  `[dream-exports] exports 键 ${exportKeys.length} 个（零通配符）· 目标文件齐全 · 全仓引用均在白名单内`
);
console.log('✅ [dream-exports] 公开子路径白名单校验通过');
