#!/usr/bin/env bun
/**
 * 状态字面量**棘轮门禁**（外部建议 ⑦「Register-or-Fail」，2026-10-20）。
 *
 * 全仓状态机词汇的唯一事实源 = `app/src/state/engine/stateMachineCatalog.ts`
 * （`STATE_MACHINES` 逐台登记 + `BOUNDARY_STATE_MACHINES` 同名不同物登记）。本门禁：
 * - 扫描 `app/src` 下的 ts/tsx 源码字符串字面量，取值落在**已登记状态词汇表**内的
 *   (value, file) 对必须**已报备**（基线 或 目录事实源 `sourceFile` 豁免）；
 * - **新增未报备** ⇒ 退出码 1（CI 阻断）：要么改用规范枚举/常量，要么先在目录登记再
 *   `--update` 基线；
 * - **只拦增量**：现存合法出现点全部收编基线，不追溯清理（与 lint:complexity / lint:fn-size
 *   同哲学）；基线已消失的出现点提示下调以锁定成果。
 *
 * 用法：`bun run lint:state-ratchet`（CI）／`bun run ../scripts/lint-state-literal-ratchet.ts --update`（重生成基线）。
 * 负向自证：`STATE_LITERAL_REPO_ROOT` / `STATE_LITERAL_BASELINE` 可覆盖（供测试注入）。
 * 退出码：0 = 未新增；1 = 有未报备新增（或基线非法）。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  BOUNDARY_STATE_MACHINES,
  STATE_MACHINES,
} from '../app/src/state/engine/stateMachineCatalog';
import {
  collectHits,
  collectSourceFileWhitelist,
  collectVocabulary,
  dedupeHits,
  diffBaseline,
  toBaselineFiles,
  type ScannedFile,
  type StateLiteralBaseline,
} from './stateLiteralRatchetCore';

const repoRoot = process.env.STATE_LITERAL_REPO_ROOT
  ? resolve(process.env.STATE_LITERAL_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const BASELINE = process.env.STATE_LITERAL_BASELINE
  ? resolve(process.env.STATE_LITERAL_BASELINE)
  : resolve(repoRoot, '.trae/architecture/state-literal-baseline.json');
const APP_SRC = resolve(repoRoot, 'app/src');

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'tests']);
const EXTS = new Set(['.ts', '.tsx']);

/** 递归收集 app/src 下的源码文件（repo 相对 POSIX 路径） */
function collectFiles(): ScannedFile[] {
  const files: ScannedFile[] = [];
  const stack = [APP_SRC];
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

const CATALOG_MACHINES = [...STATE_MACHINES, ...BOUNDARY_STATE_MACHINES];
const vocabulary = collectVocabulary(STATE_MACHINES); // 边界条目无 states，仅事实源豁免
const whitelist = collectSourceFileWhitelist(CATALOG_MACHINES);
// 目录自身也在白名单：`states: [...]` 数组即登记动作本体，字面量必然出现于此
whitelist.add('app/src/state/engine/stateMachineCatalog.ts');
const hits = collectHits(collectFiles(), vocabulary, whitelist);

const wantUpdate = process.argv.includes('--update');
if (wantUpdate) {
  const baseline: StateLiteralBaseline = {
    version: 1,
    note: '状态字面量棘轮基线：value → 已报备出现文件（app/src）。只拦增量，不追溯。',
    files: toBaselineFiles(hits),
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `✅ 基线已重生成: ${BASELINE}（value 种类 ${Object.keys(baseline.files).length}）`
  );
  process.exit(0);
}

console.log('=== 状态字面量棘轮门禁（Register-or-Fail） ===');
console.log(
  `词汇表取值 ${vocabulary.size}（目录登记 ${STATE_MACHINES.length} 台 + 边界 ${BOUNDARY_STATE_MACHINES.length} 台）`
);
console.log('----------------------------------------');

if (!existsSync(BASELINE)) {
  console.error(`❌ 基线不存在: ${BASELINE}（首次生成：--update）`);
  process.exit(1);
}
let base: StateLiteralBaseline;
try {
  base = JSON.parse(readFileSync(BASELINE, 'utf8')) as StateLiteralBaseline;
} catch (err) {
  console.error(`基线 JSON 解析失败: ${String(err)}`);
  process.exit(1);
}
if (base.version !== 1 || typeof base.files !== 'object') {
  console.error('基线缺少 version/files 字段');
  process.exit(1);
}

const { newHits, shrinkable } = diffBaseline(hits, base);

if (newHits.length > 0) {
  console.error(
    `❌ 存在**未报备**的状态字面量（${dedupeHits(newHits).length} 处）:`
  );
  for (const h of dedupeHits(newHits)) {
    console.error(`  - [${h.value}] ${h.file}`);
  }
  console.error(
    '处置：改用规范枚举/常量（唯一事实源见 stateMachineCatalog.ts）；'
  );
  console.error(
    '或确认确属状态词汇的新合法出现点 ⇒ 先在目录登记，再以 --update 收编基线。'
  );
  process.exit(1);
}
if (shrinkable.length > 0) {
  console.log(
    `ℹ️ 基线中 ${shrinkable.length} 处已不再出现（可 --update 下调锁定）`
  );
}
console.log('✅ 无未报备新增（棘轮维持）');
