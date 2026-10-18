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
 * Syntax-Aware Compactor · **P0** 结构安全切点单测（2026-10-10）。
 *
 * 依据：`dev_docs/20261010/AST语法觉知型上下文回收引擎-设计方案-20261010.md` §4（P0）。
 * 锁定：括号净深度/围栏感知的切点选择；**结构无安全点时退回既有口径**（不劣化）。
 */
import { describe, expect, it } from 'bun:test';
import {
  bracketDelta,
  findStructuralCut,
  findStructuralResume,
  isFenceOpen,
  inferFenceLang,
  closeStructure,
  getStructureNativeStats,
  resetStructureNativeForTest,
} from '../../src/utils/structureCut';

/** 前缀的括号是否平衡（净深度 0） */
const balanced = (s: string): boolean =>
  s.split('\n').reduce((d, l) => Math.max(0, d + bracketDelta(l)), 0) === 0;

describe('bracketDelta', () => {
  it('配对括号净增量为 0；未闭合为正', () => {
    expect(bracketDelta('foo(a, b)')).toBe(0);
    expect(bracketDelta('foo(')).toBe(1);
    expect(bracketDelta('})]')).toBe(-3);
    expect(bracketDelta('{}[]()')).toBe(0);
  });
});

describe('findStructuralCut：基本边界', () => {
  it('文本不超限 ⇒ 返回全文长度', () => {
    expect(findStructuralCut('abc', 10)).toBe(3);
    expect(findStructuralCut('abc', 3)).toBe(3);
  });

  it('无换行且超长 ⇒ 硬切到 limit', () => {
    expect(findStructuralCut('x'.repeat(100), 40)).toBe(40);
  });
});

describe('findStructuralCut：结构感知（P0 增量）', () => {
  it('末行在未闭合结构内 ⇒ 回退到**更早的结构闭合行**（不切半）', () => {
    // 关键用例：旧口径（lastIndexOf('\n')）会在 'foo(' 之后切（未闭合）；
    // 新口径回退到 'bbbbbbb' 之后（括号平衡）。
    const text = 'aaaaaaa\nbbbbbbb\nfoo(\nxxxxx\n';
    const cut = findStructuralCut(text, 22);
    expect(cut).toBe(15);
    expect(text.slice(0, cut)).toBe('aaaaaaa\nbbbbbbb');
    expect(balanced(text.slice(0, cut))).toBe(true);
  });

  it('优先**空行**边界（块/段落）且结构闭合', () => {
    const text = `${'X'.repeat(30)}\n\n${'Y'.repeat(30)}`;
    expect(findStructuralCut(text, 40)).toBe(30);
  });

  it('结构内无任何安全点 ⇒ **退回既有"行边界优先"口径**（不劣化）', () => {
    // 'f(' 后深度恒 > 0 ⇒ 无安全行边界 ⇒ 退回最后一个换行（既有行为）
    const text = 'f(\n  a\n  b\n';
    expect(findStructuralCut(text, 10)).toBe(6);
    expect(text.slice(0, 6)).toBe('f(\n  a');
  });
});

describe('P1 结构闭合（原生桥 + 降级契约）', () => {
  it('inferFenceLang：取**最后一个**围栏语言；关闭围栏/无围栏 ⇒ plain', () => {
    expect(inferFenceLang('```ts\ncode')).toBe('ts');
    expect(inferFenceLang('```ts\ncode\n```')).toBe('plain');
    expect(inferFenceLang('plain text')).toBe('plain');
    expect(inferFenceLang('```\nx')).toBe('plain');
    expect(inferFenceLang('```js\na\n```\n```python\nb')).toBe('python');
  });

  it('closeStructure：加载状态必居其一；原生不可用 ⇒ null（降级 P0）', () => {
    resetStructureNativeForTest();
    const r = closeStructure('function f() {', 'ts');
    const stats = getStructureNativeStats();
    // 契约：尝试过加载 ⇒ nativeLoaded 或 nativeLoadFailed 必有一真（防哨兵恒假）
    expect(stats.nativeLoaded || stats.nativeLoadFailed).toBe(true);
    if (r) expect(typeof r.closureSuffix).toBe('string');
    else expect(r).toBeNull();
  });
});

describe('findStructuralResume（P2 收尾：尾部结构恢复点）', () => {
  const chars = (s: string): string[] => Array.from(s);

  it('从半行开始 ⇒ 跳到下一个行首', () => {
    const text = 'line-one\nline-two\nline-three';
    const from = text.indexOf('two') + 1; // 位于第二行中间
    expect(findStructuralResume(chars(text), from)).toBe(
      text.indexOf('line-three')
    );
  });

  it('前缀结构已闭合 ⇒ 直接取下一个行首（不额外跳跃）', () => {
    const text = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const from = text.indexOf('b') + 2;
    expect(findStructuralResume(chars(text), from)).toBe(
      text.indexOf('const c')
    );
  });

  it('尾部从函数体中间开始 ⇒ 跳到闭括号后的行首', () => {
    const text =
      'function f() {\n  const a = 1;\n  const b = 2;\n}\nconst c = 3;';
    const from = text.indexOf('const b') + 4; // 位于函数体内
    expect(findStructuralResume(chars(text), from)).toBe(
      text.indexOf('const c')
    );
  });

  it('尾部从代码围栏内开始 ⇒ 跳过围栏关闭行', () => {
    const text = '```ts\nconst a = 1;\n```\nafter-fence';
    const from = text.indexOf('const a') + 2;
    expect(findStructuralResume(chars(text), from)).toBe(
      text.indexOf('after-fence')
    );
  });

  it('maxSkip 用尽 ⇒ 返回原 from（零行为变更）', () => {
    const text = 'function f() {\n  const a = 1;\n}\n';
    const from = text.indexOf('const a');
    expect(findStructuralResume(chars(text), from, { maxSkip: 4 })).toBe(from);
  });

  it('边界：from <= 0 / from >= 长度 / maxSkip=0 ⇒ 原样返回', () => {
    const text = 'a\nb\nc';
    expect(findStructuralResume(chars(text), 0)).toBe(0);
    expect(findStructuralResume(chars(text), text.length)).toBe(text.length);
    expect(findStructuralResume(chars(text), 1, { maxSkip: 0 })).toBe(1);
  });
});

describe('isFenceOpen（头尾截断的围栏闭合判据）', () => {
  it('未闭合围栏 ⇒ true；成对围栏/无围栏 ⇒ false', () => {
    expect(isFenceOpen('```ts\ncode')).toBe(true);
    expect(isFenceOpen('```ts\ncode\n```')).toBe(false);
    expect(isFenceOpen('plain text')).toBe(false);
  });
});
