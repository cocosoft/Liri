// MIT License
// Copyright (c) 2026 Liri
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
 * GrepTool 输入校验契约测试（F1，2026-09-04）
 *
 * 守护的修复：模型常把搜索目录写成 path → strictObject 拒收（Unrecognized key 'path'）
 * 导致失败-重试空转（日志见 dev_docs/会话中断日志排查结论与修复清单 R1）。
 * - path → searchPath 别名归一
 * - searchPath 显式存在时优先
 * - headLimit:0 拒绝且带友好引导
 * - 其余未知键仍拒绝且错误含允许参数清单（引导自纠）
 */
import { describe, it, expect } from 'bun:test';
import { validateGrepInput } from '../../../src/tools/GrepTool/schemas';
import type { GrepInputType } from '../../../src/tools/GrepTool/schemas';

function expectValidationError(fn: () => unknown, messagePart: string) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    expect(msg).toContain('Grep输入验证失败');
    expect(msg).toContain(messagePart);
  }
  if (!threw) {
    throw new Error('应当抛出校验错误');
  }
}

describe('GrepTool 输入校验（F1 参数契约）', () => {
  it('path 别名归一到 searchPath（主修复点）', () => {
    const input = validateGrepInput({
      pattern: 'foo',
      path: '/abs/dir',
    }) as GrepInputType;
    expect(input.searchPath).toBe('/abs/dir');
  });

  it('searchPath 显式存在时优先于 path 别名', () => {
    const input = validateGrepInput({
      pattern: 'foo',
      path: '/alias/dir',
      searchPath: '/canonical/dir',
    }) as GrepInputType;
    expect(input.searchPath).toBe('/canonical/dir');
  });

  it('path 为目录时不影响 pattern/headLimit 正常解析', () => {
    const input = validateGrepInput({
      pattern: 'foo',
      path: '/abs/dir',
      headLimit: 500,
    }) as GrepInputType;
    expect(input.searchPath).toBe('/abs/dir');
    expect(input.headLimit).toBe(500);
  });

  it('headLimit=0 拒绝且提示默认值/调大引导', () => {
    expectValidationError(
      () => validateGrepInput({ pattern: 'foo', headLimit: 0 }),
      'headLimit 必须为 ≥1 的整数'
    );
  });

  it('未知键（非 path 别名）仍拒绝，且错误附带允许参数清单', () => {
    expectValidationError(
      () => validateGrepInput({ pattern: 'foo', rootDir: '/x' }),
      '仅允许以下参数'
    );
    expectValidationError(
      () => validateGrepInput({ pattern: 'foo', rootDir: '/x' }),
      'searchPath(兼容别名 path)'
    );
  });

  it('缺少 pattern 拒绝', () => {
    expectValidationError(() => validateGrepInput({ searchPath: '/x' }), 'pattern');
  });
});
