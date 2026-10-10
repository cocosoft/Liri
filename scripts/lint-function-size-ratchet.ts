#!/usr/bin/env bun
/**
 * 超大函数/文件**棘轮门禁**（P2-1 · `dev_docs/20261010/升级优化方案-20261010.md`）
 *
 * 目的：`runStreamMessage` 达 **2532 行 / 复杂度 309**（台账 L-10），拆分为**逐阶段、多 PR** 的长期工程。
 * 本门禁在拆分期间**冻结基线**：**只允许缩小，不允许增长** —— 防止"边治理边长个"，
 * 并让每个拆分会话**可量化验收**（行数下降后可下调基线以锁定成果）。
 *
 * 度量口径（**与基线同算法**，避免口径漂移）：
 *   - `functionLines` = 从 `export … function* <name>(` 行起，到其后**首个顶格 `}`** 行（含）的**行数**；
 *   - `fileLines` = 文件行数（忽略末尾换行）。
 *
 * 负向自证：路径可经 `FN_SIZE_REPO_ROOT` / `FN_SIZE_BASELINE` 覆盖。
 * 退出码：0 = 未增长；1 = 有增长（或基线条目失效）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.env.FN_SIZE_REPO_ROOT
  ? resolve(process.env.FN_SIZE_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const BASELINE = process.env.FN_SIZE_BASELINE
  ? resolve(process.env.FN_SIZE_BASELINE)
  : resolve(repoRoot, '.trae/architecture/function-size-baseline.json');

interface Entry {
  file: string;
  function: string;
  functionLines: number;
  fileLines: number;
  note?: string;
}
interface Baseline {
  version: number;
  entries: Entry[];
}

const problems: string[] = [];
const shrinkable: string[] = [];

if (!existsSync(BASELINE)) {
  console.error(`基线不存在: ${BASELINE}`);
  process.exit(1);
}
let base: Baseline;
try {
  base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
} catch (err) {
  console.error(`基线 JSON 解析失败: ${String(err)}`);
  process.exit(1);
}

for (const e of base.entries) {
  const abs = resolve(repoRoot, e.file);
  if (!existsSync(abs)) {
    problems.push(`基线条目失效（文件不存在）: ${e.file}`);
    continue;
  }
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  const fileLines = lines.length - (text.endsWith('\n') ? 1 : 0);

  const prefix = `export async function* ${e.function}(`;
  const startIdx = lines.findIndex((l) => l.startsWith(prefix));
  if (startIdx < 0) {
    problems.push(`基线条目失效（未找到函数 '${e.function}'）: ${e.file}`);
    continue;
  }
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === '}') {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    problems.push(
      `基线条目失效（未找到函数 '${e.function}' 的顶格闭合）: ${e.file}`
    );
    continue;
  }
  const functionLines = endIdx - startIdx + 1;

  if (functionLines > e.functionLines) {
    problems.push(
      `${e.file} :: ${e.function} 行数 **增长**：${e.functionLines} → ${functionLines}（棘轮只允许缩小）`
    );
  } else if (functionLines < e.functionLines) {
    shrinkable.push(
      `${e.file} :: ${e.function} 已缩小：${e.functionLines} → ${functionLines} ⇒ 请**下调基线**锁定成果`
    );
  }
  if (fileLines > e.fileLines) {
    problems.push(
      `${e.file} 文件行数 **增长**：${e.fileLines} → ${fileLines}（棘轮只允许缩小）`
    );
  } else if (fileLines < e.fileLines) {
    shrinkable.push(
      `${e.file} 文件行数已缩小：${e.fileLines} → ${fileLines} ⇒ 请**下调基线**`
    );
  }
}

console.log('=== 超大函数/文件棘轮门禁（P2-1） ===');
console.log(`基线条目 ${base.entries.length}`);
console.log('----------------------------------------');

if (problems.length > 0) {
  console.error('❌ 存在违规（棘轮：只允许缩小）:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (shrinkable.length > 0) {
  console.log('ℹ️ 已缩小（请下调基线锁定）:');
  for (const s of shrinkable) console.log(`  - ${s}`);
}
console.log('✅ 未增长（棘轮维持）');
