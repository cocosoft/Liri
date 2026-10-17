/**
 * 阶段 C（2026-10-17）：**会话成本度量**（SB09 的对照实验工具）。
 *
 * 上位方案：`dev_docs/20261014/会话token预算与交接整改方案-20261014.md` §5 阶段 C
 * 规则依据：`.trae/rules/session-budget.md` SB06/SB09
 *
 * 两种用法：
 *  1. **无输入**：从台账 `fix-evidence-log.jsonl` 取最近 N 条，输出每片**台账字符数**
 *     （真实数据；`toolCalls`/`hookChars`/`reportChars` 需要会话侧采集，故显示 `-`）。
 *  2. **`--sessions <file>`**：合并会话侧采集的 JSON 数组
 *     `[{slice, toolCalls, hookChars, reportChars, ledgerChars?}]`，输出四项指标 + 对照判定。
 *
 * 阈值（方案 §5 C）：台账 ≤1,200 字符 · 工具调用 ≤18 · 总字符 ≤25k。
 * 运行：`bun run scripts/measure-session-cost.ts [--limit 10] [--sessions path] [--id ID]`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const LOG = join(ROOT, '.trae/architecture/fix-evidence-log.jsonl');

/** 方案 §5 C 的验收阈值 */
const BUDGET = { ledgerChars: 1200, toolCalls: 18, totalChars: 25_000 } as const;

interface LedgerEntry {
  id: string;
  chars: number;
}

interface SessionRow {
  slice: string;
  ledgerChars?: number;
  toolCalls?: number;
  hookChars?: number;
  reportChars?: number;
}

interface MeasuredRow extends SessionRow {
  totalChars?: number;
  verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  reasons: string[];
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 读取台账每行字符数（`chars` = 该 JSONL 行的实际长度，含中文） */
export function readLedgerChars(path = LOG): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      let id = '(unparseable)';
      try {
        id = String((JSON.parse(line) as { id?: unknown }).id ?? id);
      } catch {
        /* 保留占位 id，字符数仍可度量 */
      }
      return { id, chars: line.length };
    });
}

export function measure(rows: SessionRow[]): MeasuredRow[] {
  return rows.map((row) => {
    const reasons: string[] = [];
    const ledger = row.ledgerChars;
    if (ledger !== undefined && ledger > BUDGET.ledgerChars) {
      reasons.push(`台账 ${ledger} > ${BUDGET.ledgerChars}`);
    }
    if (row.toolCalls !== undefined && row.toolCalls > BUDGET.toolCalls) {
      reasons.push(`调用 ${row.toolCalls} > ${BUDGET.toolCalls}`);
    }
    const parts = [row.ledgerChars, row.hookChars, row.reportChars];
    const total =
      parts.every((v) => typeof v === 'number')
        ? (parts as number[]).reduce((a, b) => a + b, 0)
        : undefined;
    if (total !== undefined && total > BUDGET.totalChars) {
      reasons.push(`总字符 ${total} > ${BUDGET.totalChars}`);
    }
    const complete =
      row.ledgerChars !== undefined && row.toolCalls !== undefined && total !== undefined;
    return {
      ...row,
      ...(total !== undefined ? { totalChars: total } : {}),
      verdict: reasons.length > 0 ? 'FAIL' : complete ? 'PASS' : 'INCOMPLETE',
      reasons,
    };
  });
}

function pad(v: string | number | undefined, width: number): string {
  const s = v === undefined ? '-' : String(v);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function main(): void {
  const limit = Number(argValue('--limit') ?? '10');
  const sessionsPath = argValue('--sessions');
  const onlyId = argValue('--id');

  if (sessionsPath) {
    const raw = JSON.parse(
      readFileSync(resolve(ROOT, sessionsPath), 'utf-8')
    ) as SessionRow[];
    const ledger = new Map(readLedgerChars().map((e) => [e.id, e.chars]));
    const rows = raw.map((r) => ({
      ...r,
      ledgerChars: r.ledgerChars ?? ledger.get(r.slice),
    }));
    const measured = measure(rows);
    console.log(
      `${pad('slice', 32)}${pad('台账', 8)}${pad('调用', 6)}${pad('钩子', 8)}${pad('报告', 8)}${pad('合计', 8)}判定`
    );
    for (const m of measured) {
      console.log(
        `${pad(m.slice, 32)}${pad(m.ledgerChars, 8)}${pad(m.toolCalls, 6)}${pad(
          m.hookChars,
          8
        )}${pad(m.reportChars, 8)}${pad(m.totalChars, 8)}${m.verdict}${
          m.reasons.length > 0 ? `（${m.reasons.join('；')}）` : ''
        }`
      );
    }
    const pass = measured.filter((m) => m.verdict === 'PASS').length;
    const fail = measured.filter((m) => m.verdict === 'FAIL').length;
    console.log(
      `\n[measure-session-cost] 共 ${measured.length} 片：PASS ${pass} · FAIL ${fail} · INCOMPLETE ${
        measured.length - pass - fail
      }（阈值：台账≤${BUDGET.ledgerChars} / 调用≤${BUDGET.toolCalls} / 合计≤${BUDGET.totalChars}）`
    );
    process.exitCode = 0;
    return;
  }

  const entries = readLedgerChars().filter((e) => !onlyId || e.id === onlyId);
  const recent = entries.slice(-Math.max(1, limit));
  console.log(`${pad('id', 48)}台账字符`);
  for (const e of recent) {
    const flag = e.chars > BUDGET.ledgerChars ? ' ❌超预算' : '';
    console.log(`${pad(e.id, 48)}${pad(e.chars, 8)}${flag}`);
  }
  console.log(
    `\n[measure-session-cost] 台账条目 ${entries.length} · 最近 ${recent.length} 条已列出（阈值 ${BUDGET.ledgerChars} 字符/条）`
  );
  process.exitCode = 0;
}

if (import.meta.main) main();
