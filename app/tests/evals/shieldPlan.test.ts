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
 * A7 防泄题：屏蔽清单的**汇总与 fail-closed 校验**（`evals/shieldPlan.ts`）。
 *
 * 这两条判据的职责是"**别让评测静默变成泄题**"：题源任务的价值完全依赖"答案读不到"——
 * 若任务声明了题源路径却没被沙箱接受，通过率会虚高且无人察觉。
 */
import { describe, expect, test } from 'bun:test';
import {
  collectShieldedPaths,
  verifyShieldApplied,
} from '../../src/evals/shieldPlan';

describe('collectShieldedPaths：跨任务取并集', () => {
  test('去空、去重、保持声明顺序；无声明 ⇒ 空', () => {
    expect(
      collectShieldedPaths([
        { id: 't1', shieldedPaths: ['E:\\repo\\a.ts', '  '] },
        { id: 't2' },
        { id: 't3', shieldedPaths: [' E:\\repo\\a.ts ', 'E:\\repo\\b.ts'] },
      ])
    ).toEqual(['E:\\repo\\a.ts', 'E:\\repo\\b.ts']);
    expect(collectShieldedPaths([])).toEqual([]);
  });
});

describe('verifyShieldApplied：声明了就必须真的屏蔽上（否则拒绝运行）', () => {
  test('全部应用 ⇒ ok', () => {
    const verdict = verifyShieldApplied(
      ['E:\\repo\\a.ts', 'E:\\repo\\b.ts'],
      ['E:\\repo\\a.ts', 'E:\\repo\\b.ts']
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  test('大小写 / 分隔符 / 尾分隔符差异不算缺失（用同一规整口径比较）', () => {
    const verdict = verifyShieldApplied(['E:\\repo\\a.ts'], ['e:/repo/a.ts/']);
    expect(verdict.ok).toBe(true);
  });

  test('缺一条 ⇒ ok:false 且逐条报出（fail-closed 的依据）', () => {
    const verdict = verifyShieldApplied(
      ['E:\\repo\\a.ts', 'E:\\repo\\b.ts'],
      ['E:\\repo\\a.ts']
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['E:\\repo\\b.ts']);
  });
});
