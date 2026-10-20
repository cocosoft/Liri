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
 * 轮次级 **USD 前置判定**（纯函数，2026-10-20 · 外部建议 ②）。
 *
 * 为什么需要：金额轨档位按 **已结算** 计算（`DailyBudgetManager._computeState` 在 USD
 * 主口径下 `projectedUsed === usedUsd`，2026-10-15 用户裁定「金额轨无本轮预估」）⇒
 * 一个超大附件 / 超长上下文的**单轮**可以先放行，直到下一轮才被拦（单轮可穿透上限）。
 *
 * 本函数只做**纯判定**，不含 IO：
 * - 非 `usd` 主口径（未配置 `limitUsd`）⇒ **恒放行**（与既有口径一致，不做 token 回落闸门）；
 * - 有效上限 `<= 0` ⇒ 放行（未配置）；
 * - 估算金额非法 / `<= 0`（免费或本地模型）⇒ 放行（不臆造占用）；
 * - 判据：`usedUsd + estimatedCostUsd > limitUsd`（**严格大于**；恰好等于上限时
 *   `_computeState` 的 `>=` 已将其判为 locked，无需本函数重复拦截）。
 *
 * 是否启用由调用方门控（`FEATURE_USD_TURN_PREFLIGHT`，默认关）。
 */

/** 主口径单位（与 `DailyBudgetState.unit` 对齐） */
export type TurnPreflightUnit = 'usd' | 'tokens';

export interface TurnUsdPreflightInput {
  /** 主口径单位（`tokens` ⇒ 不判定） */
  unit: TurnPreflightUnit;
  /** 已结算金额（USD） */
  usedUsd: number;
  /** 有效上限（USD；`<= 0` ⇒ 视为未配置） */
  limitUsd: number;
  /** 本轮估算金额（USD） */
  estimatedCostUsd: number;
}

export interface TurnUsdPreflightResult {
  /** 是否拒绝本轮发送 */
  reject: boolean;
  /** 本轮估算后的占比（日志用；未配置上限 ⇒ 0） */
  projectedPercent: number;
}

export function evaluateTurnUsdPreflight(
  input: TurnUsdPreflightInput
): TurnUsdPreflightResult {
  if (input.unit !== 'usd') return { reject: false, projectedPercent: 0 };
  if (!(input.limitUsd > 0)) return { reject: false, projectedPercent: 0 };

  const estimated =
    Number.isFinite(input.estimatedCostUsd) && input.estimatedCostUsd > 0
      ? input.estimatedCostUsd
      : 0;
  const used =
    Number.isFinite(input.usedUsd) && input.usedUsd > 0 ? input.usedUsd : 0;
  const projected = used + estimated;

  return {
    reject: projected > input.limitUsd,
    projectedPercent: projected / input.limitUsd,
  };
}
