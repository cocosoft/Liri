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
  closeStructure,
  inferFenceLang,
} from '../src/utils/structureCut';

const LIMITS = [4_000, 8_000, 16_000];
const MAX_FILES = 400;

function balanced(s: string): boolean {
  let d = 0;
  for (const line of s.split('\n')) d = Math.max(0, d + bracketDelta(line));
  return d === 0;
}

/** 递归收集 `src` 下所有 `.ts` 路径（避开 `Bun.Glob` 的类型缺失） */
function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
}

async function collectCorpus(): Promise<string[]> {
  const files: string[] = [];
  walk('src', files);
  const texts: string[] = [];
  for (const f of files.slice(0, MAX_FILES)) {
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
      `  平均闭合后缀 new=${(acc.suffixChars / acc.n).toFixed(2)} 字符\n`
    );
  }
}

void main();
