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
 * 通道**长文本分片器**（共享单一实现；台账 L-11.2 / 第九轮审查 §5.2）。
 *
 * 背景：多数通道出站此前直接 `content.slice(0, maxMessageLength)` —— **截断**（尾部丢失，
 * 且可能把 Markdown 代码围栏截成"半开"）。本模块提供**按平台上限分片**且**保持代码围栏成对**
 * 的共享实现（CS01：单一路径，避免各通道各写一套）。
 *
 * 约定：
 * - **硬保证**：每个分片长度 ≤ `maxLen`（对超长单行做硬切，见 `hardSplit`）。
 * - **分片优先在行边界**；跨分片时若处于**未闭合围栏**内 ⇒ 本片补 ` ``` ` 收尾、下一片以 ` ``` `
 *   重开（每片自身围栏成对，Markdown 渲染不吞后续内容）。
 * - **内容无损**：各分片按序拼接，正文行序列与原内容一致（补的围栏除外）。
 */
const FENCE = '```';
const FENCE_RE = /^\s*```/;

/**
 * 把一个字符串切成不超过 `maxLen` 的片段。
 *
 * **结构感知（R18-A）**：优先在**结构闭合**处切 —— 即该行结束后**无未闭合围栏**且
 * **括号/花括号/方括号净深度为 0**。找不到闭合点时才退回"预算边界 + 围栏收尾/重开"。
 * 说明：括号深度用**轻量词法**（逐字符计数，不解析字符串/注释）—— 误判只会**少选**安全点
 * （退回预算边界），**不会**恶化既有行为；不做"注入闭括号"，以免改坏代码。
 */
export function splitMessage(content: string, maxLen: number): string[] {
  if (maxLen <= 0 || content.length <= maxLen) return [content];

  const lines = content.split('\n');
  const n = lines.length;

  // 预处理：每行结束后的 围栏状态 / 括号净深度 / 是否"结构闭合"（安全切点）
  const fenceOpenAfter = new Array<boolean>(n);
  const safeAfter = new Array<boolean>(n);
  let inFence = false;
  let depth = 0;
  for (let i = 0; i < n; i++) {
    if (FENCE_RE.test(lines[i])) inFence = !inFence;
    depth = Math.max(0, depth + bracketDelta(lines[i]));
    fenceOpenAfter[i] = inFence;
    safeAfter[i] = !inFence && depth === 0;
  }

  const out: string[] = [];
  let start = 0;
  let pendingReopen = false;

  while (start < n) {
    const prefix = pendingReopen ? `${FENCE}\n` : '';

    // 超长单行 ⇒ 硬切（单行内不可能有跨行围栏）
    if (lines[start].length > maxLen) {
      const hard = hardSplit(lines[start], maxLen);
      if (prefix) hard[0] = prefix + hard[0];
      for (let k = 0; k < hard.length - 1; k++) out.push(hard[k]);
      out.push(hard[hard.length - 1]);
      pendingReopen = false;
      start++;
      continue;
    }

    let end = start + 1;
    let len = lines[start].length;
    let lastSafe = safeAfter[start] ? start : -1;
    // R18-C：在"结构闭合"点中**优先块边界**（空行 = 顶层块/段落边界），
    // 使切点落在**块之间**而非块内部（无运行时 AST 下的最强"作用域闭合"启发式）。
    let lastSafeBlank =
      safeAfter[start] && lines[start].trim() === '' ? start : -1;
    while (end < n) {
      const add = 1 + lines[end].length;
      if (len + add > maxLen) break;
      len += add;
      if (safeAfter[end]) {
        lastSafe = end;
        if (lines[end].trim() === '') lastSafeBlank = end;
      }
      end++;
    }

    // 优先"块边界"（空行且结构闭合）→ 次选"结构闭合行" → 退回预算边界
    const blockBoundary =
      lastSafeBlank >= start && lastSafeBlank + 1 < end ? lastSafeBlank : -1;
    const safeBoundary =
      lastSafe >= start && lastSafe + 1 < end ? lastSafe : -1;
    const preferred = blockBoundary >= 0 ? blockBoundary : safeBoundary;
    const cutEnd = preferred >= 0 ? preferred + 1 : end;
    const seg = lines.slice(start, cutEnd).join('\n');

    if (cutEnd < end) {
      // 结构闭合点 ⇒ 无未闭合围栏，无需补收尾
      out.push(prefix + seg);
      pendingReopen = false;
    } else if (fenceOpenAfter[cutEnd - 1]) {
      // 预算边界且仍在围栏内 ⇒ 收尾 + 下一片重开
      out.push(`${prefix}${seg}\n${FENCE}`);
      pendingReopen = true;
    } else {
      out.push(prefix + seg);
      pendingReopen = false;
    }
    start = cutEnd;
  }

  return out;
}

/** 轻量括号净增量：`{ [ (` +1，`} ] )` −1（不解析字符串/注释） */
function bracketDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === '{' || ch === '[' || ch === '(') d++;
    else if (ch === '}' || ch === ']' || ch === ')') d--;
  }
  return d;
}

/** 把超长单行按字符硬切成 ≤ maxLen 的片段（无围栏语义） */
function hardSplit(line: string, maxLen: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += maxLen) {
    parts.push(line.slice(i, i + maxLen));
  }
  return parts;
}
