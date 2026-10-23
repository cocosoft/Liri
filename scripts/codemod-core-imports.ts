/**
 * 别名切换 codemod（方案 §4-P5）：`@modules/core` ⇒ `@openliri/kernel`
 *
 * 背景：内核自 P4 起物理位于 `packages/kernel/src/core`，包名 `@openliri/kernel`。
 * 本脚本把仓内对**旧别名**的引用整体切到新包名 —— **纯字符串替换**，不做 AST 改写
 * （方案复审 R5：改名 diff 必须只允许 import 说明符行变化，便于 review）。
 *
 * 用法：
 *   bun scripts/codemod-core-imports.ts            # 执行
 *   bun scripts/codemod-core-imports.ts --check    # 只检查（有残留 ⇒ exit 1，供 CI 用）
 *
 * 扫描面（只改**被 app 构建/测试覆盖**的源码，避免误改历史归档与文档）：
 *   app/src、app/tests、app/scripts、app/packages、app/_archive
 *
 * ❗ 迁移期注意事项：本脚本只改**引号内的说明符**，不改注释里的示例（注释属于叙事，不是依赖）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const OLD = '@modules/core';
const NEW = '@openliri/kernel';

const repoRoot = process.env['CODEMOD_REPO_ROOT']
  ? join(process.env['CODEMOD_REPO_ROOT'])
  : join(import.meta.dir, '..');

const ROOTS = [
  'app/src',
  'app/tests',
  'app/scripts',
  'app/packages',
  'app/_archive',
];
const EXTS = ['.ts', '.tsx'];

/** 只匹配**引号内**的说明符：`'@modules/core…'` / `"@modules/core…"` */
const SPECIFIER = /(['"])@modules\/core(?=[/'"])/g;

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTS.some((ext) => e.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const checkOnly = process.argv.includes('--check');
const hits: Array<{ file: string; count: number }> = [];

for (const root of ROOTS) {
  for (const file of walk(join(repoRoot, root))) {
    const text = readFileSync(file, 'utf8');
    const matches = text.match(SPECIFIER);
    if (!matches) continue;
    hits.push({
      file: relative(repoRoot, file).split('\\').join('/'),
      count: matches.length,
    });
    if (!checkOnly) {
      writeFileSync(file, text.replace(SPECIFIER, `$1${NEW}`), 'utf8');
    }
  }
}

const total = hits.reduce((n, h) => n + h.count, 0);
for (const h of hits)
  console.log(`  ${h.count.toString().padStart(3)}  ${h.file}`);
console.log(
  `\n${checkOnly ? '检查' : '替换'}完成：${total} 处 / ${hits.length} 个文件（${OLD} ⇒ ${NEW}）`
);

if (checkOnly && total > 0) {
  console.error(
    '❌ 仍存在旧别名引用；请运行 `bun scripts/codemod-core-imports.ts`'
  );
  process.exit(1);
}
