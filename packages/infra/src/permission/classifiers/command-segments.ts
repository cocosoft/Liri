// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令结构分段器（P2a，2026-11-12）—— L3 结构解析的最小实现。
 *
 * ## 为什么需要
 * 现有判定是「整串 → 令牌」的**字符串层**匹配：复合命令只能靠 `' | '` / `' && '`
 * 这类字面量子串兜底，于是
 *  - 归因粗糙：`Get-Acl a.txt | Set-Acl b.txt` 报的是「管道」，而不是真正要审批的 `Set-Acl`；
 *  - 无法逐段判定（管道左右两侧的风险等级天然不同）。
 *
 * 本模块只做一件事：把一条命令拆成**段**（不做完整 shell 语法），并把分隔符语义带出来。
 *
 * ## 边界（刻意不做）
 * - 不展开变量 / 命令替换（`$()`、反引号仍由既有令牌硬拦）；
 * - 不解析 here-doc 正文（`<<` 仍由既有令牌硬拦）；
 * - 引号内的分隔符**不拆**（`echo "a | b"` 是一段）。
 *
 * 纯函数、零 IO；单条命令耗时 ≪ 2ms（见 `commandSegments.test.ts` 的性能哨兵）。
 */

/** 段与段之间的分隔符（该段**前面**的运算符） */
export type SegmentOperator =
  | 'start'
  | 'seq' // ;
  | 'and' // &&
  | 'or' // ||
  | 'pipe' // |
  | 'newline'
  | 'subshell'; // ( ) { }

export interface CommandSegment {
  /** 段原文（已 trim，引号保留） */
  text: string;
  /** 该段前面的分隔符 */
  operator: SegmentOperator;
  /** 段序号（从 0 开始） */
  index: number;
}

/** 子 shell / 分组符号：视为段落边界（符号本身丢弃） */
const GROUPING_CHARS = new Set(['(', ')', '{', '}']);

/**
 * 把命令拆成段。
 *
 * 例：
 *  - `git status | head` ⇒ [git status(pipe? no, start), head(pipe)]
 *  - `a && b; c` ⇒ [a(start), b(and), c(seq)]
 *  - `echo "a | b"` ⇒ [echo "a | b"(start)]（引号内不拆）
 */
export function splitCommandSegments(surface: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current = '';
  let operator: SegmentOperator = 'start';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const flush = (next: SegmentOperator): void => {
    const text = current.trim();
    if (text) {
      segments.push({ text, operator, index: segments.length });
    }
    current = '';
    operator = next;
  };

  for (let i = 0; i < surface.length; i += 1) {
    const ch = surface[i]!;

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '\n') {
      flush('newline');
      continue;
    }
    if (ch === ';') {
      flush('seq');
      continue;
    }
    if (ch === '&' && surface[i + 1] === '&') {
      flush('and');
      i += 1;
      continue;
    }
    // P9-2（2026-11-12）：cmd 的**单** `&` 也是命令分隔符（`where a & where b`）。
    // 只认「两侧都有空白」的形态，并排除三种非分隔语义：
    //  - `&>`（cmd/PowerShell 重定向）、`2>&1`（句柄复制）；
    //  - PowerShell 调用符 `& $exe` / `& 'x'` / `& (…)`；
    // 无空白的 `a&b` 保持原样（保守，宁可少拆）。
    if (
      ch === '&' &&
      surface[i + 1] !== '>' &&
      surface[i + 1] !== '$' &&
      surface[i + 1] !== '(' &&
      surface[i + 1] !== "'" &&
      surface[i + 1] !== '"' &&
      surface[i - 1] !== '>' &&
      /\s/.test(surface[i - 1] ?? '') &&
      /\s/.test(surface[i + 1] ?? '')
    ) {
      flush('seq');
      continue;
    }
    if (ch === '|' && surface[i + 1] === '|') {
      flush('or');
      i += 1;
      continue;
    }
    if (ch === '|') {
      flush('pipe');
      continue;
    }
    if (GROUPING_CHARS.has(ch)) {
      flush('subshell');
      continue;
    }

    current += ch;
  }

  flush('start');
  // `flush` 末尾会把 operator 重置为 'start'，但不产生空段；这里只返回已收集段。
  return segments;
}
