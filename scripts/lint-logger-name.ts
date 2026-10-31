#!/usr/bin/env bun
/**
 * logger `module` 名**棘轮门禁**（2026-10-31，台账「logger 命名口径」项）
 *
 * 口径：新增/改动的 `getLogger('…')` 名必须是 `域:子域` 结构；存量 PascalCase 历史名
 * 冻结在基线里（**不阻断、不批量改名** —— `module` 是运维检索维度，改名会改变检索口径）。
 *
 * 用法：`bun run lint:logger-name`（CI / pre-commit）；
 *       `bun run ../scripts/lint-logger-name.ts --update`（重生成基线）。
 * 负向自证：`LOGGER_NAME_REPO_ROOT` / `LOGGER_NAME_BASELINE` 可覆盖（供测试注入）。
 * 退出码：0 = 未新增；1 = 有未报备的新增（或基线非法）。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import {
  collectLoggerHits,
  diffBaseline,
  toBaselineNames,
  type LoggerNameBaseline,
} from './loggerNameRatchetCore';

const repoRoot = process.env.LOGGER_NAME_REPO_ROOT
  ? resolve(process.env.LOGGER_NAME_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const BASELINE = process.env.LOGGER_NAME_BASELINE
  ? resolve(process.env.LOGGER_NAME_BASELINE)
  : resolve(repoRoot, '.trae/architecture/logger-name-baseline.json');
const SCAN_ROOTS = [
  resolve(repoRoot, 'app/src'),
  resolve(repoRoot, 'packages/kernel/src'),
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'tests']);
const EXTS = new Set(['.ts', '.tsx']);

function collectFiles(): { file: string; text: string }[] {
  const files: { file: string; text: string }[] = [];
  const stack = [...SCAN_ROOTS].filter((p) => existsSync(p));
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!EXTS.has(ext)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const rel = relative(repoRoot, abs).split(sep).join('/');
      files.push({ file: rel, text: readFileSync(abs, 'utf8') });
    }
  }
  return files;
}

function loadBaseline(): LoggerNameBaseline {
  if (!existsSync(BASELINE)) return { version: 1, names: {} };
  const raw = JSON.parse(readFileSync(BASELINE, 'utf8')) as LoggerNameBaseline;
  if (
    raw.version !== 1 ||
    typeof raw.names !== 'object' ||
    raw.names === null
  ) {
    console.error(`❌ 基线格式非法: ${BASELINE}`);
    process.exit(1);
  }
  return raw;
}

const files = collectFiles();
const hits = collectLoggerHits(files);
const wantUpdate = process.argv.includes('--update');

if (wantUpdate) {
  const names = toBaselineNames(hits);
  const baseline: LoggerNameBaseline = { version: 1, names };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  const nameCount = Object.keys(names).length;
  console.log(
    `✅ logger 名基线已重生成: ${BASELINE}（非合规名 ${nameCount} 个 / 出现点 ${hits.length}）`
  );
  process.exit(0);
}

const baseline = loadBaseline();
const { newHits, staleHits } = diffBaseline(hits, baseline);

console.log('=== logger module 名棘轮（只拦新增） ===');
console.log(
  `扫描 ${files.length} 文件 · 非合规出现点 ${hits.length} · 基线非合规名 ${Object.keys(baseline.names).length}`
);
if (staleHits.length > 0) {
  console.log(
    `ℹ️ 基线内 ${staleHits.length} 条已消失（可择机 \`--update\` 下调，锁定成果）`
  );
}
if (newHits.length > 0) {
  console.error('❌ 新增未报备的非合规 logger 名（请改用「域:子域」）：');
  for (const h of newHits) {
    console.error(`  - ${h.name}  (${h.file})`);
  }
  console.error(
    '   若确属必须保留的历史名，请先说明理由，再以 `--update` 收编基线（只增不减）。'
  );
  process.exit(1);
}
console.log('✅ 无新增非合规 logger 名（棘轮维持）');
process.exit(0);
