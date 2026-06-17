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
 * 截断 JSON 修复
 *
 * 本地修复被截断的 JSON 字符串：补全括号、闭合字符串、填充空值。
 * 不涉及模型调用，为纯语法修复。
 *
 * 借鉴: DeepSeek-Reasonix src/repair/truncation.ts
 */

import type { TruncationRepairResult } from './types';

/**
 * 修复被截断的 JSON 字符串
 */
export function repairTruncatedJson(input: string): TruncationRepairResult {
  const notes: string[] = [];
  if (!input || !input.trim()) {
    return {
      repaired: '{}',
      changed: input !== '{}',
      notes: ['empty input → {}'],
      fallback: false,
    };
  }

  // 快速路径：已可解析
  try {
    JSON.parse(input);
    return { repaired: input, changed: false, notes: [], fallback: false };
  } catch {
    /* 继续修复 */
  }

  const stack: Array<'}' | ']' | '"'> = [];
  let escaped = false;
  let inString = false;
  let lastSignificant = -1;

  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r')
      lastSignificant = i;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        stack.pop();
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stack.push('"');
      continue;
    }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }

  let s = input.slice(0, lastSignificant + 1);

  // 去除尾部逗号（会阻止重新解析）
  if (s.endsWith(',')) {
    s = s.slice(0, -1);
    notes.push('trimmed trailing comma');
  }

  // 以 key 无 value 结尾: "foo": → "foo": null
  if (/"\s*:\s*$/.test(s)) {
    s += ' null';
    notes.push('filled dangling key with null');
  }

  // 在字符串内部结束，闭合字符串
  if (inString) {
    s += '"';
    stack.pop();
    notes.push('closed unterminated string');
  }

  // 反向弹出剩余的开放结构
  while (stack.length > 0) {
    const top = stack.pop()!;
    s += top;
  }

  try {
    JSON.parse(s);
    return { repaired: s, changed: s !== input, notes, fallback: false };
  } catch (err) {
    const preview =
      input.length <= 500
        ? input
        : `${input.slice(0, 500)} …[+${input.length - 500} chars]`;
    notes.push(`fallback to {}: ${(err as Error).message}`);
    notes.push(`unrecoverable truncation — original args preview: ${preview}`);
    return { repaired: '{}', changed: true, notes, fallback: true };
  }
}
