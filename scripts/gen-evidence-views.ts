/**
 * 阶段 B · 提交②：**视图生成器** —— 从「单写入点 + 明细归档」渲染台账视图
 *
 * 上位方案：`dev_docs/20261014/阶段B-台账单写入点与视图生成-方案.md`（§3.2 / §4；Q2 已降级：
 *   **CHANGELOG 治理段仍手写**，本期只生成 `registry` 与 `修复证据登记.md`）
 * 规则依据：`.trae/rules/session-budget.md` SB01/SB02/SB03/SB04
 *
 * 输入：`.trae/architecture/fix-evidence-log.jsonl`（写入点，一行一片）
 *       `.trae/architecture/archive/evidence-detail.jsonl`（明细，**无损反解**）
 * 输出：
 *   1. `fix-evidence-registry.json` —— 机器可读；**与门禁字段兼容**（`items[]`/`stages`/`flags`/
 *      `code[]`/`tests[]`/`changelog[]` **全量**），且**每行 ≤300**（SB03）；
 *      `title`/`source`/`reopenWhen`/`notes` 短化 + **归档指针**（全文在归档，零丢失）
 *   2. `修复证据登记.md` —— §1 概览表 + §2 裁定点表，每行 ≤300
 *
 * 校验：`--verify-against <旧 registry>` ⇒ 逐条断言 `stages/flags/code/tests/changelog` **全等**，
 *   `title/source/reopenWhen/notes` **为原文前缀**（短化不丢内容）。
 * 运行：`bun run scripts/gen-evidence-views.ts`（幂等）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import {
  CHANGELOG,
  CL_BLOCK_ID,
  CL_BLOCK_KEY,
  DETAIL,
  DETAIL_REF_PREFIX,
  DOC,
  LOG,
  MAX_DETAIL_LINE,
  REGISTRY,
  flagCode,
  flagFromCode,
  findAnchor,
  headOf,
  joinField,
  loadDetail,
  readJsonl,
  scopeOf,
  stageCode,
  stageFromCode,
  type DetailRow,
  type LogRecord,
  type RegistryItem,
} from './lib/evidenceStore';

const VERIFY_IDX = process.argv.indexOf('--verify-against');

/**
 * `$comment` 重写为**短行**：原值 ~320 字符 ⇒ 会使 registry 出现 >300 行（SB03 禁止）。
 * 语义（四段 stages 与四个 flags 的判据）以 `scripts/lint-fix-evidence.ts` 头注为准（单一真源）。
 */
const SHORT_COMMENT =
  '修复证据登记（生成物）：改 fix-evidence-log.jsonl 后跑 gen-evidence-views.ts；' +
  'stages/flags 判据见 scripts/lint-fix-evidence.ts。';

/** 归档指针（人可读） */
const pointer = (id: string): string => `（全文见 ${DETAIL_REF_PREFIX}${id}）`;

/** 短化 + 指针；空文本 ⇒ 仅指针（保证 `reopenWhen` 非空，满足门禁必填） */
const shorten = (
  text: string | undefined,
  id: string,
  max?: number
): string => {
  const head = max === undefined ? headOf(text) : headOf(text, max);
  return head === '' ? pointer(id) : `${head}${pointer(id)}`;
};

/** 空格分隔的码（`DFTR` → `D F T R`；空 ⇒ `·`） */
const spaced = (code: string): string =>
  code === '' ? '·' : code.split('').join(' ');

function buildItems(): {
  meta: Record<string, unknown>;
  items: RegistryItem[];
} {
  const cur = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as Record<
    string,
    unknown
  >;
  const meta: Record<string, unknown> = { ...cur };
  delete meta.items;
  meta.$comment = SHORT_COMMENT;

  const logs = readJsonl<LogRecord>(LOG);
  const detail = loadDetail();

  const items = logs.map((l) => {
    const d: RegistryItem = detail.get(l.id) ?? { id: l.id };
    const it: RegistryItem = {
      id: l.id,
      title: headOf(d.title, 240),
      source: headOf(d.source, 180),
      stages: stageFromCode(l.stages),
      flags: flagFromCode(l.flags),
      code: d.code ?? [],
      tests: d.tests ?? [],
      changelog: d.changelog ?? [],
      reopenWhen: shorten(d.reopenWhen, l.id),
    };
    if ((d.notes ?? '').trim() !== '') it.notes = shorten(d.notes, l.id);
    return it;
  });
  return { meta, items };
}

/** registry 序列化（2 空格缩进 ⇒ 数组每项独占一行 ⇒ 可用 ≤300 断言） */
function renderRegistry(
  meta: Record<string, unknown>,
  items: RegistryItem[]
): string {
  return `${JSON.stringify({ ...meta, items }, null, 2)}\n`;
}

/** CHANGELOG：**只重写锚点区**（新片 bullet + 历史归档块），锚点外逐字节保留 */
function renderChangelog(logs: LogRecord[]): {
  text: string;
  ok: boolean;
  fresh: string[];
} {
  const lines = readFileSync(CHANGELOG, 'utf-8').split('\n');
  const anchor = findAnchor(lines);
  if (!anchor) return { text: lines.join('\n'), ok: false, fresh: [] };
  const rows = readJsonl<DetailRow>(DETAIL);
  const blockText = joinField(rows, CL_BLOCK_ID, CL_BLOCK_KEY);
  // fail-closed：归档块缺失时**绝不**渲染空块（否则会把「未发布段」抹掉 —— 实测教训 2026-10-14）
  if (blockText.trim() === '')
    return { text: lines.join('\n'), ok: false, fresh: [] };
  const block = blockText.split('\n');
  const fresh = logs
    .filter((l) => l.cl === 1)
    .reverse()
    .map(
      (l) =>
        `- ✅ **${l.id}**：${l.scope} —— 验证 ${l.verify ?? '—'}；` +
        `基线 ${l.baseline ?? '—'}（详情见 ${DETAIL_REF_PREFIX}${l.id}）`
    );
  const rendered = [...fresh, ...(fresh.length > 0 ? [''] : []), ...block];
  const out = [
    ...lines.slice(0, anchor.begin + 1),
    ...rendered,
    ...lines.slice(anchor.end),
  ];
  return { text: out.join('\n'), ok: true, fresh };
}

/** §1 概览表 + §2 裁定点表（短行） */
function renderDoc(items: RegistryItem[]): string {
  const lines: string[] = [
    '<!-- 生成物：**勿手改**。改 `.trae/architecture/fix-evidence-log.jsonl`（一行一片）后',
    '     运行 `bun run scripts/gen-evidence-views.ts` 重新生成；',
    '     明细原文见 `.trae/architecture/archive/evidence-detail.jsonl`。 -->',
    '',
    `# 修复证据登记（生成物 · ${items.length} 条）`,
    '',
    '## §1 概览',
    '',
    '| 条目 | 结论 | 阶段 | 状态 | 文件/测试 | 归档指针 |',
    '|---|---|---|---|---|---|',
  ];
  for (const it of items) {
    lines.push(
      `| **${it.id}** | ${scopeOf(it.title)} | ${spaced(stageCode(it.stages))} | ` +
        `${spaced(flagCode(it.flags))} | ${(it.code ?? []).length}/${(it.tests ?? []).length} | ` +
        `\`${DETAIL_REF_PREFIX}${it.id}\` |`
    );
  }
  lines.push(
    '',
    '## §2 重开条件（裁定点；只列首句，全文见归档）',
    '',
    '| 条目 | reopenWhen（首句 ≤120） | 归档指针 |',
    '|---|---|---|'
  );
  for (const it of items) {
    lines.push(
      `| \`${it.id}\` | ${headOf(it.reopenWhen, 120)} | \`${DETAIL_REF_PREFIX}${it.id}\` |`
    );
  }
  return `${lines.join('\n')}\n`;
}

/** 等价性校验：与「迁移前 registry」比对（短化允许，内容不得丢） */
function verify(items: RegistryItem[]): number {
  const oldPath = resolve(process.argv[VERIFY_IDX + 1] as string);
  if (!existsSync(oldPath)) {
    console.error(`[gen-evidence] ❌ --verify-against 路径不存在：${oldPath}`);
    process.exit(1);
  }
  const old = JSON.parse(readFileSync(oldPath, 'utf-8')) as {
    items: RegistryItem[];
  };
  const oldById = new Map(old.items.map((i) => [i.id, i]));
  const diffs: string[] = [];
  if (old.items.length !== items.length)
    diffs.push(`条目数 ${items.length} ≠ ${old.items.length}`);

  const stripPointer = (s: string | undefined): string =>
    (s ?? '').replace(/（全文见 [^）]*）$/, '');
  for (const it of items) {
    const o = oldById.get(it.id);
    if (!o) {
      diffs.push(`${it.id}: 旧表缺失`);
      continue;
    }
    for (const k of ['stages', 'flags'] as const) {
      if (JSON.stringify(it[k]) !== JSON.stringify(o[k]))
        diffs.push(`${it.id}: ${k} 不等`);
    }
    for (const k of ['code', 'tests', 'changelog'] as const) {
      if (JSON.stringify(it[k] ?? []) !== JSON.stringify(o[k] ?? [])) {
        diffs.push(`${it.id}: ${k} 不等`);
      }
    }
    for (const k of ['title', 'source', 'reopenWhen', 'notes'] as const) {
      const head = stripPointer(it[k]).replace(/…$/, '');
      const src = (o[k] ?? '').replace(/\s+/g, ' ').trim();
      if (head !== '' && !src.startsWith(head))
        diffs.push(`${it.id}: ${k} 非原文前缀`);
    }
  }
  if (diffs.length > 0) {
    console.error(`[gen-evidence] ❌ 等价性校验未过（${diffs.length} 处）：`);
    for (const d of diffs.slice(0, 10)) console.error(`  - ${d}`);
    process.exit(1);
  }
  return old.items.length;
}

function main(): void {
  const { meta, items } = buildItems();
  const regText = renderRegistry(meta, items);
  const docText = renderDoc(items);
  const logs = readJsonl<LogRecord>(LOG);
  const cl = renderChangelog(logs);

  const problems: string[] = [];
  const maxReg = regText.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  const maxDoc = docText.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  if (maxReg > MAX_DETAIL_LINE)
    problems.push(`registry 最长行 ${maxReg} > ${MAX_DETAIL_LINE}`);
  if (maxDoc > MAX_DETAIL_LINE)
    problems.push(`登记文档最长行 ${maxDoc} > ${MAX_DETAIL_LINE}`);
  if (!cl.ok)
    problems.push(
      'CHANGELOG 缺锚点 ⇒ 先跑 scripts/migrate-evidence-to-jsonl.ts'
    );
  const maxFresh = cl.fresh.reduce((m, l) => Math.max(m, l.length), 0);
  if (maxFresh > MAX_DETAIL_LINE) {
    problems.push(
      `CHANGELOG 新片 bullet 最长 ${maxFresh} > ${MAX_DETAIL_LINE}`
    );
  }
  if (new Set(items.map((i) => i.id)).size !== items.length)
    problems.push('存在重复 id');
  for (const it of items) {
    if (!it.reopenWhen) problems.push(`${it.id}: reopenWhen 为空（门禁必填）`);
    if ((it.stages?.fixed || it.flags?.coded) && (it.code ?? []).length === 0) {
      problems.push(`${it.id}: fixed/coded 但 code 为空（门禁会红）`);
    }
  }
  if (problems.length > 0) {
    console.error('[gen-evidence] ❌ 生成结果自检未过：');
    for (const p of problems.slice(0, 10)) console.error(`  - ${p}`);
    process.exit(1);
  }

  const verified = VERIFY_IDX >= 0 ? verify(items) : -1;
  // `EVIDENCE_VIEWS_OUT_DIR`：输出到指定目录（供 **drift 门禁** 生成到临时目录比对，不污染工作区）
  const outDir = process.env.EVIDENCE_VIEWS_OUT_DIR;
  const out = (p: string): string => (outDir ? join(outDir, basename(p)) : p);
  writeFileSync(out(REGISTRY), regText, 'utf-8');
  writeFileSync(out(DOC), docText, 'utf-8');
  writeFileSync(out(CHANGELOG), cl.text, 'utf-8');
  console.log(
    `[gen-evidence] ✅ items=${items.length} · registryLines=${regText.split('\n').length} (max ${maxReg}) · ` +
      `docLines=${docText.split('\n').length} (max ${maxDoc})` +
      (verified >= 0 ? ` · 等价校验通过（${verified} 条）` : '')
  );
}

main();
