#!/usr/bin/env bun
/**
 * lint-doc-alias.ts — **规则文档里的导入别名必须能解析**（防「规范悬空」）
 *
 * 为什么需要（2026-10-24 实证）：P5 把 `@modules/core` 统一更名为 `@openliri/kernel`，
 * 但 `.trae/rules/*.md` 仍在教人写 `@modules/core/paths` —— 该别名已从 tsconfig 删除，
 * 照文档操作**必然编译失败**。而当时没有任何门禁能发现：`lint:doc-code` 只断言它已知的
 * 安全开关与常量，**不会校验文档里的别名**。这与 CS08 记过的根因同源：
 * 「规范指向不存在的真源」比「没有规范」更坏，因为它看起来有据可依。
 *
 * 判据（只看**导入别名**，不校验普通路径）：文档里出现的 `@modules/<x>` / `@openliri/kernel/<x>`
 * / `@shared/<x>`，必须能在 `app/tsconfig.json` 的 `paths`（或内核公开子路径清单）里命中。
 * 不检查普通文件路径引用 —— 文档里大量「原为 …」的历史叙述是**应当保留**的，
 * 纳进来只会逼人改写历史（本文件即因一次 `replace_all` 误改了 v7.7.0 的历史行而立项）。
 *
 * 历史存证的处理：与 K01–K07 同口径 —— 进**基线**（`doc-alias-baseline.json`），
 * `maxEntries` 只降不增；`--write-baseline` 只允许下调。
 *
 * 用法：
 *   bun run scripts/lint-doc-alias.ts                  # CI：比对基线
 *   bun run scripts/lint-doc-alias.ts --write-baseline # 收敛后冻结（只降不增）
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { KERNEL_PUBLIC_SUBPATHS } from './lint-kernel-purity';

const repoRoot = process.env['PYAPP_PROJECT_DIR']
  ? resolve(process.env['PYAPP_PROJECT_DIR'])
  : resolve(import.meta.dir, '..');
const BASELINE = resolve(
  repoRoot,
  '.trae/architecture/doc-alias-baseline.json'
);

/** 扫描面：规则与规范文档（`AGENTS.md` 是 AI 的第一入口，必须纳入） */
function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const p = join(root, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

const files = [
  ...walk(resolve(repoRoot, '.trae/rules')),
  ...walk(resolve(repoRoot, '.trae/docs')),
  resolve(repoRoot, 'AGENTS.md'),
].filter((f) => existsSync(f));

/** tsconfig 里注册的别名键（去掉 `/*` 后缀） */
function loadAliasKeys(): Set<string> {
  const raw = readFileSync(resolve(repoRoot, 'app/tsconfig.json'), 'utf-8');
  const paths =
    (
      JSON.parse(raw) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      }
    ).compilerOptions?.paths ?? {};
  return new Set(Object.keys(paths).map((k) => k.replace(/\/\*$/, '')));
}

/** 别名是否可解析：返回 null = 合法（或属占位/泛指）；否则返回原因 */
function checkAlias(alias: string, keys: Set<string>): string | null {
  const seg = alias.split('/')[1] ?? '';
  // 泛指命名空间（如「除 `@modules/` 之外」）与占位符（`@modules/<模块>` / `@modules/xxx`）
  // 不是可执行指令 ⇒ 不判违规。
  if (!seg) return null;
  if (/[<*]/.test(alias) || /^(x{2,}|xxx)$/i.test(seg)) return null;
  const root = `@${alias.split('/')[0]!.slice(1)}`;
  if (root === '@openliri') {
    if (alias === '@openliri/kernel') return null;
    const sub = alias.slice('@openliri/kernel/'.length).replace(/\.js$/, '');
    const head = sub.split('/')[0]!;
    return (KERNEL_PUBLIC_SUBPATHS as readonly string[]).includes(head)
      ? null
      : `内核子路径 \`${head}\` 不在公开清单（KERNEL_PUBLIC_SUBPATHS）`;
  }
  if (keys.has(`@${alias.split('/')[0]!.slice(1)}/${seg}`)) return null;
  return `tsconfig paths 里没有 \`${root}/${seg}\``;
}

const ALIAS_RE = /@(?:modules|openliri|shared)\/[A-Za-z0-9_./-]*/g;

const keys = loadAliasKeys();
const hits: Array<{
  file: string;
  alias: string;
  reason: string;
  line: number;
}> = [];
for (const abs of files) {
  const text = readFileSync(abs, 'utf-8');
  const file = relative(repoRoot, abs).split(sep).join('/');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(ALIAS_RE)) {
      const alias = m[0].replace(/[.,;:）)]+$/, '');
      const reason = checkAlias(alias, keys);
      if (reason) hits.push({ file, alias, reason, line: i + 1 });
    }
  });
}

const key = (h: { file: string; alias: string }): string =>
  `${h.file}|${h.alias}`;
const unique = hits.filter(
  (h, i) => hits.findIndex((x) => key(x) === key(h)) === i
);
const sorted = unique.sort((a, b) => key(a).localeCompare(key(b)));

interface Baseline {
  version: number;
  maxEntries?: number;
  entries: Array<{ file: string; alias: string; note?: string }>;
}
const prev: Baseline = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline)
  : { version: 1, entries: [] };

if (process.argv.includes('--write-baseline')) {
  const maxEntries =
    prev.maxEntries === undefined
      ? sorted.length
      : Math.min(prev.maxEntries, sorted.length);
  const payload = {
    version: 1,
    maxEntries,
    entries: sorted.map((h) => ({ file: h.file, alias: h.alias })),
  };
  // 目录可能不存在（首次建基线 / 夹具环境）—— 不能靠"仓库里恰好已有该目录"
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `已写入文档别名基线 ${sorted.length} 条（maxEntries=${maxEntries}）: ${BASELINE}`
  );
  process.exit(0);
}

const baselined = new Set(prev.entries.map(key));
const added = sorted.filter((h) => !baselined.has(key(h)));
const shrinkable = prev.entries.filter(
  (e) => !sorted.some((h) => key(h) === key(e))
);

console.log(
  `规则文档别名：${sorted.length} 处不可解析（基线 ${prev.entries.length}）· 扫描 ${files.length} 个文件`
);
if (shrinkable.length > 0) {
  console.log(`ℹ️ 基线项已不存在（请下调锁定成果）: ${shrinkable.length} 条`);
}
if (prev.maxEntries !== undefined && prev.entries.length > prev.maxEntries) {
  console.error(
    `❌ 基线条目数超上限：${prev.entries.length} > maxEntries=${prev.maxEntries}（棘轮只允许下调）`
  );
  process.exit(1);
}
if (added.length > 0) {
  console.error(`❌ 新增不可解析的文档别名 ${added.length} 处：`);
  for (const h of added)
    console.error(`  - ${h.file}:${h.line} ${h.alias} —— ${h.reason}`);
  process.exit(1);
}
console.log('✅ 文档别名全部可解析（或已登记进基线）');
process.exit(0);
