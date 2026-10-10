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
 * ② P2 —— Tier2 单条截断的**结构闭环**单测（2026-10-10）。
 *
 * 依据：`dev_docs/20261010/AST语法觉知型上下文回收引擎-设计方案-20261010.md` §8.1（P2）——
 * 头部结构安全切点 + 闭合后缀，使"被截断保留的内容"结构上闭环。
 */
import { describe, expect, it } from 'bun:test';
import { snipMessages } from '../../src/context/compaction/SnipEngine';
import { bracketDelta } from '../../src/utils/structureCut';
import type { ChatMessage } from '@modules/ai';

/** 括号净深是否 0（结构闭合的**保守**判据） */
function balanced(s: string): boolean {
  let d = 0;
  for (const line of s.split('\n')) d = Math.max(0, d + bracketDelta(line));
  return d === 0;
}

/** 取出截断标记之前的"头部" */
function headOf(content: string): string {
  const i = content.indexOf('[... 内容过长已截断');
  return i >= 0 ? content.slice(0, i) : content;
}

describe('② P2 Tier2 单条截断：头部结构闭环', () => {
  it('函数体中途截断 ⇒ 头部补齐闭括号（结构闭合）', () => {
    // 无闭合 `}` 的函数体，且长度 > MAX_MESSAGE_CHARS(16000) ⇒ 头部 60% = 9600 处必然在结构内
    const big = 'function f() {\n' + '  const a = 1;\n'.repeat(1_500);
    expect(big.length).toBeGreaterThan(16_000);

    const messages = [
      { role: 'user', content: 'q0' },
      { role: 'assistant', content: big },
      { role: 'user', content: 'latest' },
    ] as unknown as ChatMessage[];

    const result = snipMessages(messages, { enabled: true });
    const truncated = String(result.messages[1].content);
    expect(truncated).toContain('[... 内容过长已截断');

    const head = headOf(truncated);
    // 关键：头部结构闭合（旧实现硬切 ⇒ 必然不平衡）
    expect(balanced(head)).toBe(true);
    expect(head.trimEnd().endsWith('}')).toBe(true);
  });

  it('结构已平衡的长文本 ⇒ 头部保持闭合且不引入多余括号', () => {
    const big = 'const a = 1;\n'.repeat(2_000); // 无括号，天然平衡
    const messages = [
      { role: 'assistant', content: big },
      { role: 'user', content: 'latest' },
    ] as unknown as ChatMessage[];

    const truncated = String(
      snipMessages(messages, { enabled: true }).messages[0].content
    );
    expect(balanced(headOf(truncated))).toBe(true);
    expect(headOf(truncated).includes('}')).toBe(false);
  });
});
