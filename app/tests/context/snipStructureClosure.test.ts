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

/** 取出截断标记之后的"尾部" */
function tailOf(content: string): string {
  const i = content.indexOf('保留头尾 ...]\n\n');
  return i >= 0 ? content.slice(i + '保留头尾 ...]\n\n'.length) : '';
}

/** 围栏是否成对（偶数个围栏行） */
function fencesBalanced(s: string): boolean {
  return s.split('\n').filter((l) => /^\s*```/.test(l)).length % 2 === 0;
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

describe('② P2 收尾：尾部结构恢复点 + 围栏补齐（2026-10-18）', () => {
  it('尾部落在未闭合代码围栏内 ⇒ 头部补关闭围栏，尾部从围栏后的行首开始', () => {
    // 布局：filler 5000 / 围栏 5006~10216 / post 6201（总 16411 > 16000）
    // 头部 9600 落在围栏内；尾部起点 = len-6400 = 10011，也在围栏内。
    const pre = '// filler\n'.repeat(500); // 5000
    const code = 'const a = 1;\n'.repeat(400); // 5200
    const post = 'const b = 2;\n'.repeat(477); // 6201
    const big = `${pre}\`\`\`ts\n${code}\`\`\`\n${post}`;
    expect(big.length).toBeGreaterThan(16_000);

    const messages = [
      { role: 'assistant', content: big },
      { role: 'user', content: 'latest' },
    ] as unknown as ChatMessage[];
    const truncated = String(
      snipMessages(messages, { enabled: true }).messages[0].content
    );

    const head = headOf(truncated);
    const tail = tailOf(truncated);
    // 头部停在围栏内 ⇒ 必须补一条关闭围栏（否则标记与尾部被当成代码块内容）
    expect(head.trimEnd().endsWith('```')).toBe(true);
    expect(fencesBalanced(head)).toBe(true);
    // 尾部跳过围栏关闭行，从围栏后的第一行开始
    expect(tail.startsWith('const b = 2;')).toBe(true);
  });

  it('尾部无结构恢复点（maxSkip 用尽）⇒ 与修复前的原样切逐字节一致', () => {
    // 尾部起点在函数体内且 512 字符内无闭括号 ⇒ 回退原样切（零行为变更）
    const big =
      '// filler\n'.repeat(1_000) +
      'function f() {\n' +
      '  const a = 1;\n'.repeat(1_200);
    expect(big.length).toBeGreaterThan(16_000);

    const messages = [
      { role: 'assistant', content: big },
      { role: 'user', content: 'latest' },
    ] as unknown as ChatMessage[];
    const truncated = String(
      snipMessages(messages, { enabled: true }).messages[0].content
    );

    const rawTail = Array.from(big)
      .slice(big.length - 6_400)
      .join('');
    expect(tailOf(truncated)).toBe(rawTail);
  });
});
