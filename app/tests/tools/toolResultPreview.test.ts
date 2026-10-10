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
import { buildSafePreview } from '../../src/tools/services/ToolResultPersister';

/**
 * R18-B：大工具结果被替换为**预览**时，避免字符级硬切造成的**语法盲截断**。
 * 锁定：短文本原样 · 长文本在**行边界**切 · 截在**围栏内**则补收尾 ``` （围栏成对）。
 */
const fenceCount = (s: string): number => (s.match(/```/g) ?? []).length;

describe('buildSafePreview（R18-B 安全预览）', () => {
  it('短文本 ⇒ 原样返回', () => {
    expect(buildSafePreview('abc', 10)).toBe('abc');
    expect(buildSafePreview('12345', 5)).toBe('12345');
  });

  it('长多行 ⇒ 在行边界切断（是原文前缀，且不超过 limit）', () => {
    const content = Array.from({ length: 50 }, (_, i) => `line-${i}`).join(
      '\n'
    );
    const preview = buildSafePreview(content, 40);
    expect(preview.length).toBeLessThanOrEqual(40);
    expect(content.startsWith(preview)).toBe(true);
    // 行边界 ⇒ 不以半行结尾（切点处应为完整行）
    expect(preview.endsWith('line')).toBe(false);
  });

  it('截在围栏内（``` 奇）⇒ 补收尾，围栏成对', () => {
    const content = `标题\n\`\`\`ts\n${'const x = 1;\n'.repeat(50)}\`\`\``;
    const preview = buildSafePreview(content, 60);
    expect(fenceCount(preview) % 2).toBe(0);
    expect(preview.endsWith('```')).toBe(true);
    // 正文主体仍是原文前缀
    expect(content.startsWith(preview.replace(/\n```$/, ''))).toBe(true);
  });

  it('无换行且超长 ⇒ 退回硬切（长度 == limit）', () => {
    const content = 'x'.repeat(100);
    expect(buildSafePreview(content, 40)).toBe('x'.repeat(40));
  });

  it('块边界优先（R18-C）：有**空行**时在空行处切（段落/块边界）', () => {
    const content = `${'X'.repeat(30)}\n\n${'Y'.repeat(30)}`;
    const preview = buildSafePreview(content, 40);
    expect(preview).toBe('X'.repeat(30)); // 止于空行，未切进第二段
    expect(preview.length).toBeLessThanOrEqual(40);
  });

  it('结构感知（P0，2026-10-10）：不把预览切在未闭合结构中间', () => {
    // 旧口径会在 'foo(' 之后切（括号未闭合）；P0 回退到结构闭合行 'bbbbbbb' 之后
    const content = 'aaaaaaa\nbbbbbbb\nfoo(\nxxxxx\n';
    const preview = buildSafePreview(content, 22);
    expect(preview).toBe('aaaaaaa\nbbbbbbb');
    expect(preview.includes('foo(')).toBe(false);
  });
});
