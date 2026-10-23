/**
 * lint-acceptance-criteria.ts — 验收标准「仅形式命中」门禁（Q-40，2026-10-23）
 *
 * 背景（设计 §3.10.5 R5）：验收标准写成「grep 命中 ≥1 行」「文件已生成」「退出码 0」
 * 这类**形式判据**时，全篇【待补充】的骨架产物也能"通过"。运行期已由
 * `core/successCriteria.findFormOnlyCriteria()` 拒绝；本门禁把同一口径前移到
 * **`.trae/specs/**\/*.md` 的验收段落**（用户裁定扫描面，2026-10-23）。
 *
 * 判定复用运行期实现（**唯一事实源**，不在此复制正则）：
 *   `app/src/core/successCriteria.ts` 的 `findFormOnlyCriteria()` / `FORM_ONLY_CRITERIA_PATTERNS`
 *
 * 排除项（不视为"验收条目"）：
 * - 代码块（``` 围栏内）、标题行、空行；
 * - **工具已强制的判据**（`lint:*` / `typecheck` / `tsc` / `eslint` / `bun test` / `vitest`）——
 *   它们是门禁事实，不是"内容判据"，本就该由工具保证。
 *
 * 用法：
 *   bun run scripts/lint-acceptance-criteria.ts                 # 校验（有**新增**违规 ⇒ exit 1）
 *   bun run scripts/lint-acceptance-criteria.ts --list          # 仅列出，不失败
 *   bun run scripts/lint-acceptance-criteria.ts --update-baseline  # 刷新存量基线（有意识接受时）
 *
 * ⚠️ 存量基线（`.trae/architecture/acceptance-criteria-baseline.json`）：
 * specs 是**历史记录**（多数条目已带"实测回填"证据），本门禁按**棘轮**语义只拦**新增**
 * 形式化条目；存量收敛后再逐项下调基线（与 `lint:consts-bare` / `lint:tool-risk` 同口径）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORM_ONLY_CRITERIA_PATTERNS,
  findFormOnlyCriteria,
} from '../packages/kernel/src/core/successCriteria';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = resolve(HERE, '..', '.trae', 'specs');
const BASELINE_PATH = resolve(
  HERE,
  '..',
  '.trae',
  'architecture',
  'acceptance-criteria-baseline.json'
);

/** 工具已强制的判据（不参与"仅形式命中"判定） */
const TOOL_ENFORCED_RE =
  /(lint:[a-z-]+|typecheck|\btsc\b|eslint|bun test|vitest)/i;

const HEADING_RE = /^(#{2,4})\s+(.*)$/;
const ACCEPTANCE_HEADING_RE = /验收/;
const FENCE_RE = /^\s*```/;

interface Violation {
  file: string;
  line: number;
  text: string;
  why: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
}

/** 把验收段落里的行收集为"条目"（去列表/表格前缀），返回 `{line,text}` */
function collectItems(
  lines: string[],
  start: number,
  end: number
): Array<{ line: number; text: string }> {
  const items: Array<{ line: number; text: string }> = [];
  let inFence = false;
  for (let i = start; i < end; i++) {
    const raw = lines[i];
    if (FENCE_RE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (HEADING_RE.test(trimmed)) continue;
    if (TOOL_ENFORCED_RE.test(trimmed)) continue;
    const text = trimmed
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^\|\s*/, '')
      .replace(/\s*\|\s*$/, '')
      .trim();
    if (!text) continue;
    // 表格分隔行（|---|---|）
    if (/^[-:|\s]+$/.test(text)) continue;
    items.push({ line: i + 1, text });
  }
  return items;
}

function scanFile(file: string): Violation[] {
  const rel = file.replace(/\\/g, '/').split('/.trae/').pop() ?? file;
  const lines = readFileSync(file, 'utf8').split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING_RE.exec(lines[i].trim());
    if (!heading) continue;
    if (!ACCEPTANCE_HEADING_RE.test(heading[2])) continue;

    const level = heading[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = HEADING_RE.exec(lines[j].trim());
      if (next && next[1].length <= level) {
        end = j;
        break;
      }
    }

    const items = collectItems(lines, i + 1, end);
    const formOnly = new Set(findFormOnlyCriteria(items.map((it) => it.text)));
    for (const item of items) {
      if (!formOnly.has(item.text)) continue;
      const why =
        FORM_ONLY_CRITERIA_PATTERNS.find(({ re }) => re.test(item.text))?.why ??
        '仅形式命中（需补内容判据）';
      violations.push({ file: rel, line: item.line, text: item.text, why });
    }
  }
  return violations;
}

/** 稳定键：文件 + 条目文本（行号会漂移，不参与） */
function keyOf(v: Violation): string {
  return `${v.file}::${v.text}`;
}

function readBaseline(): Set<string> {
  if (!existsSync(BASELINE_PATH)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
      entries?: string[];
    };
    return new Set(Array.isArray(raw.entries) ? raw.entries : []);
  } catch {
    return new Set();
  }
}

function writeBaseline(keys: string[]): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  const payload = {
    note: 'Q-40 验收标准「仅形式命中」棘轮基线（存量 spec 的历史条目）。新增违规 ⇒ 门禁失败；收敛后请用 --update-baseline 下调。勿手改。',
    entries: [...keys].sort(),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main(): number {
  const listOnly = process.argv.includes('--list');
  const update = process.argv.includes('--update-baseline');
  if (!existsSync(SPECS_DIR)) {
    console.log('[lint-acceptance] 未找到 .trae/specs（跳过）');
    return 0;
  }

  const files: string[] = [];
  walk(SPECS_DIR, files);
  const violations = files.flatMap(scanFile);
  const keys = violations.map(keyOf);

  console.log('=== 验收标准门禁（Q-40：拒绝"仅形式命中"） ===');
  console.log(`扫描 ${files.length} 个 spec · 命中 ${violations.length}`);

  if (update) {
    writeBaseline(keys);
    console.log(
      `[lint-acceptance] 基线已更新：${keys.length} 条 → ${BASELINE_PATH}`
    );
    return 0;
  }

  const baseline = readBaseline();
  const added = violations.filter((v) => !baseline.has(keyOf(v)));
  const fixed = [...baseline].filter((k) => !keys.includes(k));

  for (const v of violations) {
    const isNew = !baseline.has(keyOf(v));
    const line = `  ${isNew ? '[NEW] ' : '[BASE]'} ${v.file}:${v.line}  ${v.why}\n    ${v.text}`;
    if (isNew) console.error(line);
    else console.log(line);
  }

  if (fixed.length > 0) {
    console.log(
      `ℹ️ 已收敛（可从基线移除）：${fixed.length} 条 —— 建议 --update-baseline`
    );
  }
  if (added.length === 0) {
    console.log('✅ 通过（无新增形式化验收条目）');
    return 0;
  }
  if (listOnly) {
    console.log('ℹ️ --list：仅列出，不失败');
    return 0;
  }
  console.error(
    `存在 ${added.length} 条**新增**"仅形式命中"验收标准，请补内容判据（具体值 / 字段 / 结构）。`
  );
  return 1;
}

process.exit(main());
