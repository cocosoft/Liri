/**
 * 台账「单写入点 + 视图生成」共享库（阶段 B）
 *
 * 上位方案：`dev_docs/20261014/阶段B-台账单写入点与视图生成-方案.md`
 * 规则依据：`.trae/rules/session-budget.md` SB01（写入点 ≤400）/ SB03（≤300）/ SB04
 *
 * 三个使用者：
 *  - `scripts/migrate-evidence-to-jsonl.ts`（存量一次性迁移）
 *  - `scripts/gen-evidence-views.ts`（视图生成：registry + 修复证据登记.md）
 *  - （后续）drift 门禁
 *
 * 数据结构（**唯一事实链**）：
 *  写入点 `fix-evidence-log.jsonl`（结论 + 计数 + 指针，一行一片 ≤400）
 *    └─ `ref` → 明细归档 `archive/evidence-detail.jsonl`（chunk，"可无损反解"，每行 ≤300）
 *         ⇒ 明细（title/source/reopenWhen/notes + code[]/tests[]/changelog[]）**零丢失**
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
export const REGISTRY = join(
  PROJECT_ROOT,
  '.trae/architecture/fix-evidence-registry.json'
);
export const LOG = join(
  PROJECT_ROOT,
  '.trae/architecture/fix-evidence-log.jsonl'
);
export const DOC = join(PROJECT_ROOT, '.trae/architecture/修复证据登记.md');
export const DETAIL = join(
  PROJECT_ROOT,
  '.trae/architecture/archive/evidence-detail.jsonl'
);
export const DETAIL_REF_PREFIX = 'archive/evidence-detail.jsonl#';
/** CHANGELOG（**部分生成**：仅「未发布段」的锚点区；发布历史仍手写） */
export const CHANGELOG = join(PROJECT_ROOT, 'CHANGELOG.md');
/** 未发布段归档的合成 id / 键（非台账条目） */
export const CL_BLOCK_ID = '@changelog-unreleased';
export const CL_BLOCK_KEY = 'block#0';
export const CL_BEGIN =
  '<!-- EVIDENCE-VIEWS:BEGIN（生成物：未发布段。改 fix-evidence-log.jsonl 后跑 ' +
  'gen-evidence-views.ts 重新生成） -->';
export const CL_END = '<!-- EVIDENCE-VIEWS:END -->';

/** 找锚点区（返回锚点所在行下标；内容 = `begin+1 .. end-1`） */
export function findAnchor(
  lines: string[]
): { begin: number; end: number } | null {
  const b = lines.findIndex((l) =>
    l.trim().startsWith('<!-- EVIDENCE-VIEWS:BEGIN')
  );
  const e = lines.findIndex((l) => l.trim() === CL_END);
  if (b < 0 || e < 0 || e < b) return null;
  return { begin: b, end: e };
}

/** 未发布段（`## [未发布]` 之下、首个 `---` 之前；含块内空行） */
export function findUnreleasedBlock(
  lines: string[]
): { start: number; end: number } | null {
  const h = lines.findIndex((l) => l.trim() === '## [未发布]');
  if (h < 0) return null;
  const sep = lines.findIndex((l, i) => i > h && l.trim() === '---');
  if (sep < 0) return null;
  return { start: h + 1, end: sep - 1 };
}

/** SB01：写入点单行上限 */
export const MAX_LOG_LINE = 400;
/** SB03：归档单行上限 */
export const MAX_DETAIL_LINE = 300;
/** 归档片段长度（保证整行 ≤ MAX_DETAIL_LINE） */
export const CHUNK = 180;
/** 短化上限（`reopenWhen`/`notes` 的首句长度） */
export const SHORT_MAX = 160;
/** `scope` 上限 */
export const SCOPE_MAX = 80;

export interface RegistryItem {
  id: string;
  title?: string;
  source?: string;
  stages?: Record<string, boolean>;
  flags?: Record<string, boolean>;
  code?: string[];
  tests?: string[];
  changelog?: string[];
  reopenWhen?: string;
  notes?: string;
}

export interface DetailRow {
  id: string;
  k: string;
  i: number;
  c: string;
}

export interface LogRecord {
  id: string;
  scope: string;
  stages: string;
  flags: string;
  files: number;
  tn: number;
  ref: string;
  /** `1` ⇒ 该片需在 CHANGELOG「未发布段」渲染一行 bullet（新片写入时置；历史条目**不写**） */
  cl?: number;
  verify?: string;
  baseline?: string;
}

/** 阶段码：discovered→D fixed→F testVerified→T postReleaseReviewed→R */
export function stageCode(stages: Record<string, boolean> | undefined): string {
  const s = stages ?? {};
  return (
    (s.discovered ? 'D' : '') +
    (s.fixed ? 'F' : '') +
    (s.testVerified ? 'T' : '') +
    (s.postReleaseReviewed ? 'R' : '')
  );
}

/** 状态码：designed→d coded→c unitTested→u e2eVerified→e */
export function flagCode(flags: Record<string, boolean> | undefined): string {
  const f = flags ?? {};
  return (
    (f.designed ? 'd' : '') +
    (f.coded ? 'c' : '') +
    (f.unitTested ? 'u' : '') +
    (f.e2eVerified ? 'e' : '')
  );
}

/** 码 → 阶段对象（`stageCode` 的逆） */
export function stageFromCode(code: string): Record<string, boolean> {
  return {
    discovered: code.includes('D'),
    fixed: code.includes('F'),
    testVerified: code.includes('T'),
    postReleaseReviewed: code.includes('R'),
  };
}

/** 码 → 状态对象（`flagCode` 的逆） */
export function flagFromCode(code: string): Record<string, boolean> {
  return {
    designed: code.includes('d'),
    coded: code.includes('c'),
    unitTested: code.includes('u'),
    e2eVerified: code.includes('e'),
  };
}

/** title → 结论短句（全文在归档 ⇒ 截断零丢失） */
export function scopeOf(title: string | undefined): string {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const after = t.includes('：') ? t.slice(t.lastIndexOf('：') + 1) : t;
  const s = after.trim() || t;
  return s.length <= SCOPE_MAX ? s : `${s.slice(0, SCOPE_MAX - 1)}…`;
}

/** 首句（截断到 `SHORT_MAX`，用于视图短行；全文见归档） */
export function headOf(text: string | undefined, max = SHORT_MAX): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** 原子切分：ASCII 连写段为一原子（不切词），其余（CJK/标点/空格）逐字符可断 */
export function splitAtoms(s: string): string[] {
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

/** 无损切片：按原子贪心打包，每片 ≤ CHUNK（超宽原子硬切） */
export function chunkText(text: string): string[] {
  if (text === '') return [''];
  const out: string[] = [];
  let cur = '';
  for (const atom of splitAtoms(text)) {
    if (cur.length + atom.length <= CHUNK) {
      cur += atom;
      continue;
    }
    if (cur !== '') out.push(cur);
    let rest = atom;
    while (rest.length > CHUNK) {
      out.push(rest.slice(0, CHUNK));
      rest = rest.slice(CHUNK);
    }
    cur = rest;
  }
  out.push(cur);
  return out;
}

/** 源条目 → 归档行（标量 `k=字段`；数组 `k=字段#下标`） */
export function encodeDetailRows(items: RegistryItem[]): DetailRow[] {
  const rows: DetailRow[] = [];
  const pushScalar = (
    id: string,
    k: string,
    text: string | undefined
  ): void => {
    const v = text ?? '';
    if (v === '') return;
    chunkText(v).forEach((c, i) => rows.push({ id, k, i, c }));
  };
  const pushArray = (
    id: string,
    field: string,
    arr: string[] | undefined
  ): void => {
    (arr ?? []).forEach((el, n) =>
      chunkText(el).forEach((c, i) =>
        rows.push({ id, k: `${field}#${n}`, i, c })
      )
    );
  };
  for (const it of items) {
    pushScalar(it.id, 'title', it.title);
    pushScalar(it.id, 'source', it.source);
    pushScalar(it.id, 'reopenWhen', it.reopenWhen);
    pushScalar(it.id, 'notes', it.notes);
    pushArray(it.id, 'code', it.code);
    pushArray(it.id, 'tests', it.tests);
    pushArray(it.id, 'changelog', it.changelog);
  }
  return rows;
}

/** 归档行 → 明细（`encodeDetailRows` 的逆；**无损**） */
export function decodeDetailRows(rows: DetailRow[]): Map<string, RegistryItem> {
  const byId = new Map<string, RegistryItem>();
  const parts = new Map<string, Map<number, string>>();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, { id: r.id });
    const key = `${r.id}\u0000${r.k}`;
    let m = parts.get(key);
    if (!m) {
      m = new Map<number, string>();
      parts.set(key, m);
    }
    m.set(r.i, r.c);
  }
  const joinParts = (id: string, k: string): string | undefined => {
    const m = parts.get(`${id}\u0000${k}`);
    if (!m) return undefined;
    return [...m.keys()]
      .sort((a, b) => a - b)
      .map((i) => m.get(i) ?? '')
      .join('');
  };
  const fieldIdxs = (id: string, field: string): number[] => {
    const out: number[] = [];
    for (const key of parts.keys()) {
      const idx = key.indexOf('\u0000');
      if (key.slice(0, idx) !== id) continue;
      const pk = key.slice(idx + 1);
      if (!pk.startsWith(`${field}#`)) continue;
      out.push(Number(pk.slice(field.length + 1)));
    }
    return [...new Set(out)].sort((a, b) => a - b);
  };
  for (const [id, it] of byId) {
    for (const k of ['title', 'source', 'reopenWhen', 'notes'] as const) {
      const v = joinParts(id, k);
      if (v !== undefined) it[k] = v;
    }
    for (const field of ['code', 'tests', 'changelog'] as const) {
      const idxs = fieldIdxs(id, field);
      if (idxs.length > 0) {
        it[field] = idxs.map((n) => joinParts(id, `${field}#${n}`) ?? '');
      }
    }
  }
  return byId;
}

/** 读 JSONL（跳过空行） */
export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

/** 读明细归档（已反解） */
export function loadDetail(): Map<string, RegistryItem> {
  return decodeDetailRows(readJsonl<DetailRow>(DETAIL));
}

/**
 * 取任意字段的分片并拼接（用于**非条目**字段，如 `@changelog-unreleased` 的 `block#0`）。
 * 与 `decodeDetailRows` 同源（分片按 `i` 升序拼接）。
 */
export function joinField(rows: DetailRow[], id: string, k: string): string {
  return rows
    .filter((r) => r.id === id && r.k === k)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.c)
    .join('');
}
