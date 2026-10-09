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

import { describe, expect, it } from 'bun:test';
import { splitMessage } from '../../src/channels/messageSplitter';

/**
 * R11 / L-11.2：共享**长文本分片器**契约。
 * 锁定：≤maxLen 硬保证 · 内容无损（无围栏时逐字保持）· **代码围栏成对**（每片偶数个 ``` ）。
 */
const fenceCount = (s: string): number => (s.match(/```/g) ?? []).length;

describe('splitMessage（L-11.2 长文本分片器）', () => {
  it('短文本 / 边界 ⇒ 单元素且内容不变', () => {
    expect(splitMessage('hello', 10)).toEqual(['hello']);
    expect(splitMessage('12345', 5)).toEqual(['12345']);
    expect(splitMessage('', 5)).toEqual(['']);
  });

  it('maxLen<=0 ⇒ 不分片（返回原内容，避免死循环）', () => {
    expect(splitMessage('abc', 0)).toEqual(['abc']);
    expect(splitMessage('abc', -1)).toEqual(['abc']);
  });

  it('多行长文本 ⇒ 每片 ≤ maxLen，且无围栏时内容逐字无损', () => {
    const content = Array.from({ length: 30 }, (_, i) => `第 ${i} 行内容`).join(
      '\n'
    );
    const chunks = splitMessage(content, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    // 无围栏 ⇒ 不注入任何标记，拼接后逐字等于原文
    expect(chunks.join('\n')).toBe(content);
  });

  it('代码围栏成对：含 ``` 的长文本每片围栏数为偶数', () => {
    const body = Array.from(
      { length: 40 },
      (_, i) => `console.log(${i});`
    ).join('\n');
    const content = `说明\n\`\`\`ts\n${body}\n\`\`\`\n结束`;
    const chunks = splitMessage(content, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(60);
      expect(fenceCount(c) % 2).toBe(0);
    }
  });

  it('超长单行 ⇒ 硬切且每片 ≤ maxLen', () => {
    const long = 'x'.repeat(95);
    const chunks = splitMessage(long, 40);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    expect(chunks.join('')).toBe(long);
  });

  it('结构感知（R18-A）：不在花括号块中间切（每片括号平衡）', () => {
    // 预算边界本会落在函数体中间（缺 `}`）；结构感知应回退到块前的闭合点
    const content = [
      'AAAA',
      'function f() {',
      '  a;',
      '  b;',
      '  c;',
      '}',
      'BBBB',
    ].join('\n');
    const chunks = splitMessage(content, 34);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(34);
      const open = (c.match(/\{/g) ?? []).length;
      const close = (c.match(/\}/g) ?? []).length;
      expect(open).toBe(close); // 每片花括号平衡
    }
  });

  it('块边界优先（R18-C）：有顶层空行时在**空行处**切（块之间，非块内部）', () => {
    // 行：AAA / BBB / （空行）/ CCC / DDD；maxLen=13 ⇒ 预算本可含到 CCC
    const content = ['AAA', 'BBB', '', 'CCC', 'DDD'].join('\n');
    const chunks = splitMessage(content, 13);
    // 优先块边界（空行）⇒ 首片止于空行，次片自 CCC 起
    expect(chunks[0]).toBe('AAA\nBBB\n');
    expect(chunks[1]).toBe('CCC\nDDD');
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(13);
  });
});
