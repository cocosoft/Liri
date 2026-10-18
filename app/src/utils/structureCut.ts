// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 结构安全切点（Syntax-Aware Compactor · P0，2026-10-10）。
 *
 * 背景：`dev_docs/20261010/AST语法觉知型上下文回收引擎-设计方案-20261010.md`（用户裁定启动 P0+P1+P2）。
 * P0 = **零新依赖**的 TS 侧"结构感知切点"：切点优先落在**结构闭合**处（括号净深度 0 且不在未闭合
 * 代码围栏内），避免"字符级硬切把代码/结构截半"。
 *
 * **单一来源（CS01）**：本模块是仓内**唯一**的括号净增量/结构闭合判定实现；`channels/messageSplitter.ts`
 * （通道出站长文分片）与 `tools/services/ToolResultPersister.ts`（工具结果安全预览）均复用之。
 *
 * 边界（如实）：
 * - 括号判定用**轻量词法**（逐字符计数，**不**解析字符串/注释）—— 与既有 `messageSplitter` 口径一致；
 *   误判只会**少选**安全点（退回既有行边界/硬切），**不劣化**既有行为。
 * - P0 **不注入**闭括号（避免改坏代码）；"补齐闭合后缀"属 P1（Rust `py_close_structure`）。
 */
import type { NativeLib } from '../../native';

/** 代码围栏行（行首可含空格后接三个反引号） */
const STRUCTURE_CUT_FENCE_RE = /^\s*```/;

/** 轻量括号净增量：`{ [ (` +1，`} ] )` −1（不解析字符串/注释） */
export function bracketDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === '{' || ch === '[' || ch === '(') d++;
    else if (ch === '}' || ch === ']' || ch === ')') d--;
  }
  return d;
}

export interface StructuralCutOptions {
  /** 空行（块/段落边界）可接受的最小位置比例（默认 0.4，沿用既有口径） */
  blankRatio?: number;
  /** 普通行边界可接受的最小位置比例（默认 0.5，沿用既有口径） */
  lineRatio?: number;
}

/**
 * 在 `[0, limit]` 内求**结构安全**的切点字符下标（返回值可直接用于 `text.slice(0, cut)`）。
 *
 * 选择次序：
 *   ① 最新的**空行边界**（且之前结构闭合）且位置 ≥ `blankRatio·limit`；
 *   ② 最新的**行边界**（且之前结构闭合）且位置 ≥ `lineRatio·limit`；
 *   ③ **退回既有"行边界优先"口径**（空行 → 换行 → 硬切），保证不劣化既有行为；
 *   ④ 兜底 = `limit`（硬切）。
 *
 * 折叠末段（被截断的不完整行）**不作**切点。
 */
export function findStructuralCut(
  text: string,
  limit: number,
  opts: StructuralCutOptions = {}
): number {
  if (limit <= 0 || text.length <= limit) return text.length;
  const blankRatio = opts.blankRatio ?? 0.4;
  const lineRatio = opts.lineRatio ?? 0.5;
  const window = text.slice(0, limit);
  const lines = window.split('\n');

  let offset = 0;
  let depth = 0;
  let inFence = false;
  let lastSafeBlank = -1;
  let lastSafeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    // 末段无换行 ⇒ 该行不完整，不作为切点（切在完整行之后）
    if (i === lines.length - 1) break;
    if (STRUCTURE_CUT_FENCE_RE.test(line)) inFence = !inFence;
    depth = Math.max(0, depth + bracketDelta(line));
    offset += line.length + 1; // 含换行符
    if (inFence || depth !== 0) continue;
    if (line.trim() === '') lastSafeBlank = lineStart - 1; // 空行 ⇒ 切在前一行末尾
    lastSafeLine = lineStart + line.length;
  }

  if (lastSafeBlank >= Math.floor(limit * blankRatio)) return lastSafeBlank;
  if (lastSafeLine >= Math.floor(limit * lineRatio)) return lastSafeLine;

  // 结构上找不到安全点 ⇒ 退回既有"行边界优先"口径（不劣化），最后才硬切
  const blank = window.lastIndexOf('\n\n');
  if (blank >= Math.floor(limit * blankRatio)) return blank;
  const nl = window.lastIndexOf('\n');
  if (nl >= Math.floor(limit * lineRatio)) return nl;
  return limit;
}

/**
 * 文本结束时是否仍处于**未闭合**的代码围栏内（与 `findStructuralCut` 同一围栏口径）。
 *
 * 用途：头尾截断的头部若在围栏内被切，必须补一条关闭围栏，否则省略标记与尾部会被
 * Markdown 当作代码块内容（`ToolResultPersister.buildSafePreview` 同口径）。
 */
export function isFenceOpen(text: string): boolean {
  let inFence = false;
  for (const line of text.split('\n')) {
    if (STRUCTURE_CUT_FENCE_RE.test(line)) inFence = !inFence;
  }
  return inFence;
}

export interface StructuralResumeOptions {
  /** 最多向前跳过多少字符（默认 512；用尽 ⇒ 原样返回 `from`，零行为变更） */
  maxSkip?: number;
}

/**
 * 求**尾部**的结构安全恢复点（P2 收尾，2026-10-18）。
 *
 * 背景：头尾截断的尾部此前直接按码点切（`chars.slice(len - keepTail)`），
 * 可能从**半行 / 半个字符串 / 函数体中间 / 未闭合代码围栏内**开始 ⇒ 尾部首行是残片，
 * 模型只能猜测它与被丢弃中段的关系（设计文档 §8.5 边界①）。
 *
 * 选择次序（**保守优先，宁可少保留也不注入假语法**）：
 *   ① 先跳过被切半的行（取 `from` 之后第一个换行符之后的位置）；
 *   ② 若该处结构已闭合（原始括号净深 0 且不在围栏内）⇒ 直接返回该行首；
 *   ③ 否则逐行向后，返回首个「结构重新闭合」的行首（上限 `maxSkip`）；
 *   ④ 找不到 ⇒ **返回原 `from`**（与修复前逐字节一致）。
 *
 * 与 `findStructuralCut` 的差异：此处**不钳位**负深度（负值代表"先遇到闭括号"，
 * 必须保留以识别"尾部从已打开结构内部开始"）。
 */
export function findStructuralResume(
  chars: readonly string[],
  from: number,
  opts: StructuralResumeOptions = {}
): number {
  if (!Number.isInteger(from) || from <= 0 || from >= chars.length) return from;
  const maxSkip = Math.max(0, opts.maxSkip ?? 512);
  if (maxSkip === 0) return from;

  // ① 跳过被切半的行
  let start = -1;
  for (let i = from; i < chars.length && i <= from + maxSkip; i++) {
    if (chars[i] === '\n') {
      start = i + 1;
      break;
    }
  }
  if (start < 0 || start >= chars.length) return from;

  // ② 计算 start 处的原始结构状态
  const prefix = chars.slice(0, start).join('');
  let depth = 0;
  let inFence = false;
  for (const line of prefix.split('\n')) {
    if (STRUCTURE_CUT_FENCE_RE.test(line)) inFence = !inFence;
    depth += bracketDelta(line);
  }
  if (depth === 0 && !inFence) return start;

  // ③ 向后找"结构重新闭合"的行首
  const stopAt = start + maxSkip;
  const lines = chars.slice(start).join('').split('\n');
  let offset = start;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offset;
    if (lineStart > stopAt) break;
    if (i > 0 && depth === 0 && !inFence) return lineStart;
    const line = lines[i];
    if (STRUCTURE_CUT_FENCE_RE.test(line)) inFence = !inFence;
    depth += bracketDelta(line);
    offset += line.length + 1;
  }

  // ④ 无安全恢复点 ⇒ 零行为变更
  return from;
}

// ─────────────────────────────────────────────────────────────
// P1（2026-10-10）：Rust 结构闭合（`py_close_structure`）—— 三态懒加载 + 降级
// ─────────────────────────────────────────────────────────────

type NativeCloseFn = (code: string, lang: string) => unknown;

/**
 * 原生闭合句柄。**三态**：`undefined` = 未尝试加载；`null` = 不可用；函数 = 可用。
 * （同 `security/bash/BashAST.ts` 口径；防"哨兵恒假 ⇒ 原生永不加载"。）
 */
let nativeClose: NativeCloseFn | null | undefined;
let nativeLoadFailed = false;
let nativeCallCount = 0;
let tsFallbackCount = 0;

function lazyInitNative(): NativeCloseFn | null {
  if (nativeClose !== undefined) return nativeClose;
  try {
    const native = require('../../native') as NativeLib | null;
    if (native && typeof native.closeStructure === 'function') {
      nativeClose = (code, lang) => native.closeStructure(code, lang);
    } else {
      nativeClose = null;
      nativeLoadFailed = true;
    }
  } catch {
    nativeClose = null;
    nativeLoadFailed = true;
  }
  return nativeClose;
}

export interface StructureClosureResult {
  balanced: boolean;
  /** 使前缀闭合所需的后缀（已闭合为空串） */
  closureSuffix: string;
  openCount: number;
}

/**
 * 结构闭合求解。原生可用 ⇒ 走 `py_close_structure`；不可用/异常 ⇒ 返回 `null`
 * （调用方据此**降级 P0**：不追加后缀）。
 */
export function closeStructure(
  code: string,
  lang = 'plain'
): StructureClosureResult | null {
  const fn = lazyInitNative();
  if (!fn) {
    tsFallbackCount += 1;
    return null;
  }
  try {
    nativeCallCount += 1;
    const r = fn(code, lang) as Partial<StructureClosureResult> | null;
    if (!r || typeof r.closureSuffix !== 'string') return null;
    return {
      balanced: r.balanced === true,
      closureSuffix: r.closureSuffix,
      openCount: typeof r.openCount === 'number' ? r.openCount : 0,
    };
  } catch {
    tsFallbackCount += 1;
    return null;
  }
}

/** 可观测统计（供测试；契约：调用后 `nativeLoaded || nativeLoadFailed` 必为真） */
export function getStructureNativeStats(): {
  nativeLoaded: boolean;
  nativeLoadFailed: boolean;
  nativeCallCount: number;
  tsFallbackCount: number;
} {
  return {
    nativeLoaded: typeof nativeClose === 'function',
    nativeLoadFailed,
    nativeCallCount,
    tsFallbackCount,
  };
}

/** 仅测试用：重置懒加载与统计 */
export function resetStructureNativeForTest(): void {
  nativeClose = undefined;
  nativeLoadFailed = false;
  nativeCallCount = 0;
  tsFallbackCount = 0;
}

/**
 * 从 markdown 文本推断"当前所处的代码围栏语言"：取**最后一个** ``` 围栏行的语言标签；
 * 关闭围栏（无标签）⇒ 回到 `'plain'`。无围栏 ⇒ `'plain'`。
 */
export function inferFenceLang(text: string): string {
  const re = /^[ \t]*```([A-Za-z0-9_+-]*)/gm;
  let lang = 'plain';
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lang = m[1] || 'plain';
  }
  return lang;
}
