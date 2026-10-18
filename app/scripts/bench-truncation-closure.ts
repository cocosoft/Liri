/**
 * ② P2 **截断级质量度量**（非 CI 门禁，2026-10-10）
 *
 * 方案：`dev_docs/20261010/AST语法觉知型上下文回收引擎-设计方案-20261010.md` §8.1（P2）——
 * 立项 P2 的**前置**是"先建截断级质量度量 + 收益证据"（否则停在 P1）。
 *
 * 度量口径（**真实语料** = 本仓 `app/src` 下的全部 `.ts` 文件，非合成数据）：
 *   - **结构闭合率**：截断后的头部是否"括号平衡"（`bracketDelta` 累计净深 0）；
 *   - **平均保留量**：头部保留字符数（越接近 limit 越好）；
 *   - **对照**：`old` = 现有"按 limit 硬切"；`new` = `findStructuralCut` 结构安全切点 + `closeStructure` 闭合后缀。
 *
 * 运行：`bun run scripts/bench-truncation-closure.ts`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  bracketDelta,
  findStructuralCut,
  findStructuralResume,
  closeStructure,
  inferFenceLang,
} from '../src/utils/structureCut';

const LIMITS = [4_000, 8_000, 16_000];
const BENCH_MAX_FILES = 400;
/** 与 `SnipEngine.TRUNCATE_KEEP_HEAD_RATIO` 同口径（头部 60% / 尾部 40%） */
const KEEP_HEAD_RATIO = 0.6;

function balanced(s: string): boolean {
  let d = 0;
  for (const line of s.split('\n')) d = Math.max(0, d + bracketDelta(line));
  return d === 0;
}

/** 指定下标处的原始结构状态（不钳位负深度；`inFence` 取围栏奇偶） */
function stateAt(
  text: string,
  index: number
): { depth: number; inFence: boolean } {
  let depth = 0;
  let inFence = false;
  for (const line of text.slice(0, index).split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    depth += bracketDelta(line);
  }
  return { depth, inFence };
}

/** 递归收集 `src` 下所有 `.ts` 路径（避开 `Bun.Glob` 的类型缺失） */
function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= BENCH_MAX_FILES) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
}

async function collectCorpus(): Promise<string[]> {
  const files: string[] = [];
  walk('src', files);
  const texts: string[] = [];
  for (const f of files.slice(0, BENCH_MAX_FILES)) {
    try {
      const t = readFileSync(f, 'utf8');
      if (t.length > 2_000) texts.push(t); // 只用"会被截断"的长文本
    } catch {
      // @ignore-catch — 读失败跳过
    }
  }
  return texts;
}

interface Acc {
  n: number;
  closedOld: number;
  closedNew: number;
  retainedOld: number;
  retainedNew: number;
  suffixChars: number;
  /** 尾部指标（2026-10-18 新增） */
  tailN: number;
  tailLineOld: number;
  tailLineNew: number;
  tailClosedOld: number;
  tailClosedNew: number;
  tailRetainedOld: number;
  tailRetainedNew: number;
  tailSkipped: number;
}

async function main(): Promise<void> {
  const corpus = await collectCorpus();
  console.log(`语料：${corpus.length} 个长文件（app/src 下 .ts）\n`);

  for (const limit of LIMITS) {
    const acc: Acc = {
      n: 0,
      closedOld: 0,
      closedNew: 0,
      retainedOld: 0,
      retainedNew: 0,
      suffixChars: 0,
      tailN: 0,
      tailLineOld: 0,
      tailLineNew: 0,
      tailClosedOld: 0,
      tailClosedNew: 0,
      tailRetainedOld: 0,
      tailRetainedNew: 0,
      tailSkipped: 0,
    };
    for (const text of corpus) {
      if (text.length <= limit) continue;
      acc.n += 1;
      const oldHead = text.slice(0, limit);
      const cut = findStructuralCut(text, limit);
      const newHead = text.slice(0, cut);
      const closure = closeStructure(newHead, inferFenceLang(newHead));
      const suffix = closure && !closure.balanced ? closure.closureSuffix : '';

      if (balanced(oldHead)) acc.closedOld += 1;
      if (balanced(newHead + suffix)) acc.closedNew += 1;
      acc.retainedOld += oldHead.length;
      acc.retainedNew += newHead.length;
      acc.suffixChars += suffix.length;

      // ── 尾部指标：与 SnipEngine 同口径（尾 40%），old = 原样切，new = findStructuralResume ──
      const chars = Array.from(text);
      const keepTail = Math.floor(limit * (1 - KEEP_HEAD_RATIO));
      const tailOldStart = chars.length - keepTail;
      const tailNewStart = findStructuralResume(chars, tailOldStart);
      const oldAtLine = text[tailOldStart - 1] === '\n';
      const newAtLine = text[tailNewStart - 1] === '\n';
      const oldState = stateAt(text, tailOldStart);
      const newState = stateAt(text, tailNewStart);
      acc.tailN += 1;
      if (oldAtLine) acc.tailLineOld += 1;
      if (newAtLine) acc.tailLineNew += 1;
      if (oldState.depth === 0 && !oldState.inFence) acc.tailClosedOld += 1;
      if (newState.depth === 0 && !newState.inFence) acc.tailClosedNew += 1;
      acc.tailRetainedOld += tailOldStart === 0 ? chars.length : keepTail;
      acc.tailRetainedNew += chars.length - tailNewStart;
      acc.tailSkipped += tailNewStart - tailOldStart;
    }
    if (acc.n === 0) continue;
    const pct = (x: number): string => `${((x / acc.n) * 100).toFixed(1)}%`;
    console.log(`limit=${limit}  n=${acc.n}`);
    console.log(
      `  结构闭合率   old(硬切)=${pct(acc.closedOld)}  new(结构切+闭合)=${pct(acc.closedNew)}`
    );
    console.log(
      `  平均保留量   old=${(acc.retainedOld / acc.n).toFixed(0)}  new=${(acc.retainedNew / acc.n).toFixed(0)}  （new 少保留 ${((acc.retainedOld - acc.retainedNew) / acc.n) | 0} 字符）`
    );
    console.log(
      `  平均闭合后缀 new=${(acc.suffixChars / acc.n).toFixed(2)} 字符`
    );
    const tpct = (x: number): string =>
      `${((x / acc.tailN) * 100).toFixed(1)}%`;
    console.log(
      `  尾部行首对齐 old=${tpct(acc.tailLineOld)}  new=${tpct(acc.tailLineNew)}`
    );
    console.log(
      `  尾部结构闭合 old=${tpct(acc.tailClosedOld)}  new=${tpct(acc.tailClosedNew)}`
    );
    console.log(
      `  尾部平均保留 old=${(acc.tailRetainedOld / acc.tailN).toFixed(0)}  new=${(acc.tailRetainedNew / acc.tailN).toFixed(0)}  （平均跳过 ${(acc.tailSkipped / acc.tailN).toFixed(1)} 字符）\n`
    );
  }
}

void main();
