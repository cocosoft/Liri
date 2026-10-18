/**
 * A-4 基线口径：统计「工具名字符串分支」并做**棘轮**（只减不增）。
 *
 * 计数口径（行级，命中即 1）：
 *   `toolName|tool_name|tool.name|*.toolName` 后紧跟 `===|!==|==|!=` 与**字符串字面量**。
 * 例：`toolName === 'bash'`、`tool.name === "powershell"`、`d.toolName === 'image_generate'`。
 *
 * 用途：`20261018/待修复任务清单` A-4 验收的**唯一基线来源**（禁止手写数字）。
 * 基线：`.trae/architecture/toolname-branches-baseline.json`（**按文件计数**，不含行号 ——
 * 行号会随无关编辑漂移，造成假增）。
 *
 * 运行：
 *   cd app && bun run ../scripts/count-toolname-branches.ts          # 校验（新增/扩大 ⇒ exit 1）
 *   cd app && bun run ../scripts/count-toolname-branches.ts --write  # 播种 / 下调基线
 *   cd app && bun run ../scripts/count-toolname-branches.ts --list   # 仅列站点
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROJECT_ROOT,
  collectFiles,
  isCommentLine,
  readLines,
  toRel,
} from './lib/hardcodeScan';

const BASELINE_PATH = join(
  PROJECT_ROOT,
  '.trae',
  'architecture',
  'toolname-branches-baseline.json'
);

/** 与**非空**字符串字面量比较的工具名表达式（`!= ''` 这类 SQL 空串比较不计） */
const PATTERN =
  /\b(?:toolName|tool_name|tool\.name|[\w$]+\.toolName)\s*(?:===|!==|==|!=)\s*(['"`])([^'"`\n]+)\1/;

/** 非「工具名」字面量：`typeof` 类型名 与 规则通配符 `*` */
const IGNORED_LITERALS = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'undefined',
  'function',
  'symbol',
  'bigint',
  '*',
]);

interface Site {
  file: string;
  line: number;
  text: string;
}

interface Baseline {
  note: string;
  generatedAt: string;
  total: number;
  files: Record<string, number>;
}

function scan(): Site[] {
  const sites: Site[] = [];
  for (const abs of collectFiles()) {
    const rel = toRel(abs);
    // 测试文件不在治理面（`collectFiles` 已跳过 `__tests__`，这里补 `*.test.ts`）
    if (rel.includes('.test.') || rel.includes('.spec.')) continue;
    const lines = readLines(abs);
    lines.forEach((text, i) => {
      if (isCommentLine(text)) return;
      const m = PATTERN.exec(text);
      if (!m || IGNORED_LITERALS.has(m[2])) return;
      sites.push({ file: rel, line: i + 1, text: text.trim() });
    });
  }
  return sites;
}

function byFile(sites: Site[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sites) counts[s.file] = (counts[s.file] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))
  );
}

function write(sites: Site[]): void {
  const baseline: Baseline = {
    note: 'A-4 工具名字符串分支基线（棘轮：只减不增）。由 scripts/count-toolname-branches.ts 生成。',
    generatedAt: new Date().toISOString().slice(0, 10),
    total: sites.length,
    files: byFile(sites),
  };
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(baseline, null, 2)}\n`,
    'utf8'
  );
  console.log(
    `写入基线：${baseline.total} 处 / ${Object.keys(baseline.files).length} 文件`
  );
}

function verify(sites: Site[]): number {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`缺少基线文件：${BASELINE_PATH}（先跑 --write）`);
    return 1;
  }
  const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  const now = byFile(sites);
  const grown: string[] = [];
  for (const [file, count] of Object.entries(now)) {
    const prev = base.files[file] ?? 0;
    if (count > prev) grown.push(`${file}: ${prev} → ${count}`);
  }
  for (const [file, prev] of Object.entries(base.files)) {
    const count = now[file] ?? 0;
    if (count < prev) {
      console.log(`↓ ${file}: ${prev} → ${count}`);
    }
  }
  if (grown.length > 0 || sites.length > base.total) {
    console.error(
      `✗ 工具名字符串分支增加（基线 ${base.total}，当前 ${sites.length}）：`
    );
    for (const g of grown) console.error(`   + ${g}`);
    return 1;
  }
  console.log(
    `✓ 工具名字符串分支：${sites.length} 处 / ${Object.keys(now).length} 文件（基线 ${base.total}）`
  );
  if (sites.length < base.total) {
    console.log(
      '  基线可下调：bun run ../scripts/count-toolname-branches.ts --write'
    );
  }
  return 0;
}

const sites = scan();
const arg = process.argv[2];

if (arg === '--write') {
  write(sites);
  process.exit(0);
}

if (arg === '--list') {
  for (const s of sites) console.log(`${s.file}:${s.line}  ${s.text}`);
  console.log(
    `共 ${sites.length} 处 / ${Object.keys(byFile(sites)).length} 文件`
  );
  process.exit(0);
}

process.exit(verify(sites));
