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
 * 2026-10-20（外部建议 ②）：轮次 USD 前置判定的纯函数回归。
 *
 * 只锁判定口径，不碰 IO：
 * ① 只有 `usd` 主口径才判定（token 轨不参与闸门 —— 2026-10-15 裁定）；
 * ② 恰好等于上限**不**重复拦截（`_computeState` 的 `>=` 已判 locked）；
 * ③ 未配置上限 / 估算非法 / 非正 ⇒ 放行（不臆造占用）。
 */
import { describe, expect, it } from 'bun:test';

import { evaluateTurnUsdPreflight } from '../../src/query/turnUsdPreflight';

describe('evaluateTurnUsdPreflight', () => {
  it('usd：已用 + 本轮估算 > 上限 ⇒ 拒绝，并给出预估占比', () => {
    const result = evaluateTurnUsdPreflight({
      unit: 'usd',
      usedUsd: 0.9,
      limitUsd: 1,
      estimatedCostUsd: 0.2,
    });
    expect(result.reject).toBe(true);
    expect(result.projectedPercent).toBeCloseTo(1.1, 5);
  });

  it('usd：未超上限 ⇒ 放行', () => {
    const result = evaluateTurnUsdPreflight({
      unit: 'usd',
      usedUsd: 0.5,
      limitUsd: 1,
      estimatedCostUsd: 0.2,
    });
    expect(result.reject).toBe(false);
    expect(result.projectedPercent).toBeCloseTo(0.7, 5);
  });

  it('usd：恰好等于上限 ⇒ 不重复拦截（locked 已覆盖 >=）', () => {
    const result = evaluateTurnUsdPreflight({
      unit: 'usd',
      usedUsd: 0.8,
      limitUsd: 1,
      estimatedCostUsd: 0.2,
    });
    expect(result.reject).toBe(false);
  });

  it('token 主口径 ⇒ 恒放行（token 轨只观测、不设闸门）', () => {
    const result = evaluateTurnUsdPreflight({
      unit: 'tokens',
      usedUsd: 999,
      limitUsd: 1,
      estimatedCostUsd: 999,
    });
    expect(result.reject).toBe(false);
    expect(result.projectedPercent).toBe(0);
  });

  it('未配置上限（limit<=0）⇒ 放行', () => {
    for (const limitUsd of [0, -1, Number.NaN]) {
      const result = evaluateTurnUsdPreflight({
        unit: 'usd',
        usedUsd: 5,
        limitUsd,
        estimatedCostUsd: 5,
      });
      expect(result.reject).toBe(false);
    }
  });

  it('估算非法 / 非正（免费或本地模型）⇒ 放行', () => {
    for (const estimatedCostUsd of [
      0,
      -0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const result = evaluateTurnUsdPreflight({
        unit: 'usd',
        usedUsd: 0.5,
        limitUsd: 1,
        estimatedCostUsd,
      });
      expect(result.reject).toBe(false);
    }
  });

  it('已结算非法（NaN / 负数）⇒ 按 0 计，不误拒', () => {
    const result = evaluateTurnUsdPreflight({
      unit: 'usd',
      usedUsd: Number.NaN,
      limitUsd: 1,
      estimatedCostUsd: 0.1,
    });
    expect(result.reject).toBe(false);
    expect(result.projectedPercent).toBeCloseTo(0.1, 5);
  });
});
