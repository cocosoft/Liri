/**
 * copy-prompts.ts — 把包内提示词资源复制进发布产物（C-3b 发布链路修复，2026-10-18）。
 *
 * 背景：`PromptVersionManager` 通过文件系统读取 `app/prompts/<locale>/{sections,tools,tool-params.json}`。
 * `bun build --compile` / `build:bundle` 不会自动携带这些**运行时读取**的文件，故发布包必须显式复制：
 *   - compile 模式：`dist/liri_terminal(.exe)` 同级 → `dist/prompts/`
 *   - bundle 模式：`dist/pkg/liri.js` 同级 → `dist/pkg/prompts/`
 *
 * 用法：
 *   bun run scripts/copy-prompts.ts --target=../dist
 *   bun run scripts/copy-prompts.ts --target=../dist/pkg
 *
 * 目标目录不存在时创建；源目录缺失则失败退出（避免静默产出「无提示词」的包）。
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SOURCE = resolve(import.meta.dir, '..', 'prompts');

/**
 * `--target` 与 `copy-external-deps` / `copy-seed-data` 同口径：**相对 CWD**
 * （构建脚本从 `app/` 执行，故 `../dist` = 发布根 `dist`、`../dist/pkg` = bundle 产物目录）。
 */
function parseTarget(): string {
  const arg = process.argv.find((item) => item.startsWith('--target='));
  if (!arg) return resolve(import.meta.dir, '..', '..', 'dist');
  return resolve(arg.slice('--target='.length));
}

function main(): number {
  const targetRoot = parseTarget();
  const dest = join(targetRoot, 'prompts');

  if (!existsSync(SOURCE)) {
    console.error(`✗ 源目录不存在：${SOURCE}`);
    return 1;
  }

  mkdirSync(dirname(dest), { recursive: true });
  cpSync(SOURCE, dest, { recursive: true, force: true });
  console.log(`✓ 提示词资源已复制：${SOURCE} → ${dest}`);
  return 0;
}

process.exit(main());
