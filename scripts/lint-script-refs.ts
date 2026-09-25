/**
 * 脚本引用可达性检查器（Script Reference Reachability Linter）
 *
 * **背景**（台账 N-51）：`app/package.json#build:update:win` 曾引用
 * `scripts/package-update.ts`，而该文件**全仓不存在**（`git log --all` 零记录，
 * 从未被提交过）—— 属"写了引用但从未实现"，任何人执行该 script 都必然失败，
 * 却没有任何自动检查能拦下它。
 *
 * **判定规则（宁可少检，不可误报）**：
 * 只认"**命令名紧随其后的第一个路径**"（中间允许夹 flag），形态为
 * `<bun run | bun | node | tsx> [flags] <path>.<ts|tsx|js|mjs|cjs>`。
 *
 * **为什么不用"宽匹配所有像路径的 token"**：`package.json#scripts` 里大量存在
 * **输出路径**与**内联代码字符串**，它们本就**不该存在**：
 *   - 输出路径：`--outfile=../dist/liri_terminal`、`--outdir=../dist/pkg`
 *   - 内联代码：`bun -e "...renameSync('../dist/pkg/pyapp.js', '../dist/pkg/liri.js')"`
 *   - 非文件取值：`node -p "require('./package.json').version"`
 * 宽匹配会把它们全部判为"缺失"⇒ **误报直接阻断 CI**。
 * 本规则下它们天然被排除：flag 的取值被 flag 模式吞掉、以引号起始的 token 不匹配路径。
 *
 * **已知漏检（有意为之）**：入口写在引号内的引用（如 `bun run "scripts/x.ts"`）——
 * 与内联代码字符串无法用正则可靠区分，故不检。
 *
 * 运行：cd app && bun run lint:refs（cwd = app/，项目根 = ../）
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');

/** 待检查的 package.json（相对项目根；根 package.json 可选存在） */
const PACKAGE_FILES = ['app/package.json', 'package.json'];

/**
 * 入口文件引用：`(^|&&|||;||) <bun run|bun|node|tsx> [flags] <path>.<ext>`
 *
 * - 命令段以 `&&` / `||` / `;` / `|` / 行首分界，避免跨段误抓；
 * - `[flags]` 支持 `--flag` 与 `--flag=value` 两种写法（后者是 `--outfile=…` 的形态）；
 * - 路径 token 显式排除引号与 `=`（故 `--outfile=x` 的取值、`"…"` 内的字面量都不会命中）。
 */
const ENTRY_REF =
  /(?:^|&&|\|\||;|\|)\s*(?:bun\s+run|bun|node|tsx)\s+(?:run\s+)?(?:(?:--?[A-Za-z-]+(?:=[^\s"']+)?)\s+)*([^\s"'`|&;=]+\.(?:ts|tsx|js|mjs|cjs))(?![A-Za-z0-9])/g;

function main(): void {
  const violations: string[] = [];
  let checked = 0;

  for (const pkgRel of PACKAGE_FILES) {
    const pkgPath = join(PROJECT_ROOT, pkgRel);
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
      bin?: Record<string, string>;
    };
    const pkgDir = join(pkgPath, '..');

    // `bin` 字段同为"文件引用"（N-52 实测：`bin.liri-memory` 曾指向已移动的 `./src/cli.ts`）
    for (const [name, ref] of Object.entries(pkg.bin ?? {})) {
      checked++;
      if (!existsSync(join(pkgDir, ref))) {
        violations.push(`${pkgRel}#bin.${name} → ${ref}`);
      }
    }

    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      for (const match of cmd.matchAll(ENTRY_REF)) {
        const ref = match[1];
        checked++;
        // 以 package.json 所在目录解析（`../scripts/x.ts` → 项目根，`scripts/x.ts` → app/）
        if (!existsSync(join(pkgDir, ref))) {
          violations.push(`${pkgRel}#${name} → ${ref}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      '❌ 以下 npm script 引用了**不存在的文件**（执行时必然失败）：'
    );
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    console.error(
      '\n修法：把路径改正确；若该脚本本就从未实现，则删除对应引用（见台账 N-51）。'
    );
    process.exit(1);
  }

  console.log(`✅ 脚本引用可达性检查通过（已检查 ${checked} 处入口引用）`);
  process.exit(0);
}

main();
