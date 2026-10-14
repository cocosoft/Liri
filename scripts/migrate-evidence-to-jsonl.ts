/**
 * 阶段 B · 提交①：存量台账 → **JSONL 单写入点** + **叙事归档（短行）**
 *
 * 上位方案：`dev_docs/20261014/阶段B-台账单写入点与视图生成-方案.md`（§3.1 / §4；Q1 已裁定）
 * 规则依据：`.trae/rules/session-budget.md` SB01（单写入点 ≤400 字符）/ SB03 / SB04（叙事外迁）
 *
 * 做什么（一次性迁移，幂等）：
 *  1. 读 `.trae/architecture/fix-evidence-registry.json` 的 `items`（当前 210 条）
 *  2. **叙事外迁**：把每条的 `title`/`source`/`reopenWhen`/`notes` 原文写入归档
 *     `.trae/architecture/archive/evidence-notes.md` —— 按 **≤300 字符硬折行**（仅按空格折，
 *     不切词），使归档**同样满足 SB03**（不再把 R2 的长行问题搬家）
 *  3. **结论写入点**：`.trae/architecture/fix-evidence-log.jsonl`，**每片 1 行 ≤400 字符**
 *     字段：`id` / `scope`（title 结论短句）/ `stages`（码）/ `flags`（码）/ `files`（code 计数，
 *     Q1 裁定）/ `tn`（tests 计数）/ `ref`（归档指针）；可选 `date`/`commit`/`verify`/`baseline`/`reopen`
 *     —— **缺失字段一律不写、绝不编造**（CS06）
 *  4. **无损自检**（必过，否则 `exit 1`）：
 *     ① id 双向一致且不重复；② 归档**含** `title`/`reopenWhen`/`notes` 原文
 *     （**空白归一化**后比较 —— 折行只为排版，不改语义）；③ JSONL 可 `JSON.parse` 且
 *     `stages`/`flags`/`files`/`tn` 与源条目一致；④ JSONL 每行 ≤400；⑤ 归档每行 ≤300
 *
 * 运行：`bun run scripts/migrate-evidence-to-jsonl.ts`（幂等：重复运行结果一致）
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const REG = join(ROOT, '.trae/architecture/fix-evidence-registry.json');
const LOG = join(ROOT, '.trae/architecture/fix-evidence-log.jsonl');
const ARCHIVE_DIR = join(ROOT, '.trae/architecture/archive');
const ARCHIVE = join(ARCHIVE_DIR, 'evidence-notes.md');

/** SB01：JSONL 单行上限 */
const MAX_LINE = 400;
/** SB03：归档同样守 300 字符 */
const ARCHIVE_WIDTH = 300;
/** `scope` 上限（为整行留余量） */
const SCOPE_MAX = 80;

interface RegistryItem {
  id: string;
  title?: string;
  source?: string;
  stages?: Record<string, boolean>;
  flags?: Record<string, boolean>;
  code?: unknown[];
  tests?: unknown[];
  changelog?: unknown[];
  reopenWhen?: string;
  notes?: string;
}

/** 阶段码：discovered→D fixed→F testVerified→T postReleaseReviewed→R */
function stageCode(stages: Record<string, boolean> | undefined): string {
  const s = stages ?? {};
  return (
    (s.discovered ? 'D' : '') +
    (s.fixed ? 'F' : '') +
    (s.testVerified ? 'T' : '') +
    (s.postReleaseReviewed ? 'R' : '')
  );
}

/** 状态码：designed→d coded→c unitTested→u e2eVerified→e */
function flagCode(flags: Record<string, boolean> | undefined): string {
  const f = flags ?? {};
  return (
    (f.designed ? 'd' : '') +
    (f.coded ? 'c' : '') +
    (f.unitTested ? 'u' : '') +
    (f.e2eVerified ? 'e' : '')
  );
}

/** title → 结论短句（全文在归档 ⇒ 截断零丢失） */
function scopeOf(title: string | undefined): string {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const after = t.includes('：') ? t.slice(t.lastIndexOf('：') + 1) : t;
  const s = after.trim() || t;
  return s.length <= SCOPE_MAX ? s : `${s.slice(0, SCOPE_MAX - 1)}…`;
}

/** 去空白比对（折行只影响排版，不改语义；**CJK 折行处不插空格**，故按「去空白」等价） */
const noWs = (s: string): string => s.replace(/\s+/g, '');

/** 原子切分：ASCII 连写段为一原子（不切词），其余（CJK/标点/空格）逐字符可断 */
function splitAtoms(s: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9_./:@#$%&*+=\-~^\\]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    for (const ch of s.slice(last, m.index)) out.push(ch);
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  for (const ch of s.slice(last)) out.push(ch);
  return out;
}

/** 折行：每行 ≤ width；超宽原子（如超长 URL）硬切 */
function wrapSmart(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const atom of splitAtoms(para)) {
      if (line.length + atom.length <= width) {
        line += atom;
        continue;
      }
      if (line !== '') out.push(line);
      let rest = atom;
      while (rest.length > width) {
        out.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** 带标签的短行字段：首行 `- label: `，续行缩进 2 空格 */
function field(label: string, text: string | undefined): string[] {
  const prefix = `- ${label}: `;
  const value = (text ?? '').trim();
  if (!value) return [`${prefix}`];
  const width = Math.max(20, ARCHIVE_WIDTH - 2 - prefix.length);
  const chunks = wrapSmart(value, width);
  return [prefix + chunks[0], ...chunks.slice(1).map((c) => `  ${c}`)];
}

function main(): void {
  const reg = JSON.parse(readFileSync(REG, 'utf-8')) as { items: RegistryItem[] };
  const items = reg.items ?? [];

  // ① 归档（叙事原文，短行折行）
  const body: string[] = [];
  for (const it of items) {
    body.push(`## ${it.id}`, '');
    body.push(...field('title', it.title));
    body.push(...field('source', it.source));
    body.push(...field('reopenWhen', it.reopenWhen));
    body.push(...field('notes', it.notes));
    body.push('');
  }
  const archiveText =
    `<!-- 生成物（阶段 B 迁移自 fix-evidence-registry.json）；**勿手改**。\n` +
    `     承载体：叙事原文（按空格硬折行 ≤${ARCHIVE_WIDTH} 字符，空白归一化后与原文等价）。 -->\n\n` +
    `# 证据台账 · 叙事归档（${items.length} 条）\n\n${body.join('\n')}\n`;

  // ② JSONL（结论 + 指针；缺失字段不写）
  const lines = items.map((it) => {
    const rec: Record<string, unknown> = {
      id: it.id,
      scope: scopeOf(it.title),
      stages: stageCode(it.stages),
      flags: flagCode(it.flags),
      files: (it.code ?? []).length,
      tn: (it.tests ?? []).length,
      ref: `archive/evidence-notes.md#${it.id}`,
    };
    return JSON.stringify(rec);
  });

  // ③ 自检
  const problems: string[] = [];
  const over = lines.filter((l) => l.length > MAX_LINE);
  if (over.length > 0) {
    problems.push(`JSONL ${over.length} 行超 ${MAX_LINE}（首例 ${over[0].length}）`);
  }
  const archiveLines = archiveText.split('\n');
  const archOver = archiveLines.filter((l) => l.length > ARCHIVE_WIDTH);
  if (archOver.length > 0) {
    problems.push(`归档 ${archOver.length} 行超 ${ARCHIVE_WIDTH}（首例 ${archOver[0].length}）`);
  }
  const seen = new Set<string>();
  items.forEach((it, i) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      problems.push(`${it.id}: JSONL 不可解析`);
      return;
    }
    if (parsed.id !== it.id) problems.push(`${it.id}: id 不一致`);
    if (seen.has(it.id)) problems.push(`${it.id}: id 重复`);
    seen.add(it.id);
    if (parsed.stages !== stageCode(it.stages)) problems.push(`${it.id}: stages 不一致`);
    if (parsed.flags !== flagCode(it.flags)) problems.push(`${it.id}: flags 不一致`);
    if (parsed.files !== (it.code ?? []).length) problems.push(`${it.id}: files 计数不一致`);
    if (parsed.tn !== (it.tests ?? []).length) problems.push(`${it.id}: tn 计数不一致`);
    // 渲染无损：`field()` 折行后「去空白」必须等于原文（防折行实现丢字/截断）
    for (const [name, text] of [
      ['title', it.title],
      ['source', it.source],
      ['reopenWhen', it.reopenWhen],
      ['notes', it.notes],
    ] as Array<[string, string | undefined]>) {
      const v = (text ?? '').trim();
      if (!v) continue;
      const prefix = `- ${name}: `;
      const rendered = field(name, v).join(' ');
      const body = rendered.startsWith(prefix) ? rendered.slice(prefix.length) : rendered;
      if (noWs(body) !== noWs(v)) problems.push(`${it.id}: ${name} 渲染丢字`);
    }
  });

  if (problems.length > 0) {
    console.error('[migrate-evidence] ❌ 自检未过：');
    for (const p of problems.slice(0, 10)) console.error(`  - ${p}`);
    process.exit(1);
  }

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  writeFileSync(ARCHIVE, archiveText, 'utf-8');
  writeFileSync(LOG, `${lines.join('\n')}\n`, 'utf-8');

  const maxJsonl = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const maxArch = archiveLines.reduce((m, l) => Math.max(m, l.length), 0);
  console.log(
    `[migrate-evidence] ✅ items=${items.length} · jsonlLines=${lines.length} · ` +
      `maxJsonl=${maxJsonl}/${MAX_LINE} · archiveLines=${archiveLines.length} · ` +
      `maxArchive=${maxArch}/${ARCHIVE_WIDTH} · archiveChars=${archiveText.length}`
  );
}

main();
