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
 * G-05（2026-10-19）：剩余 USD 水位 → Tier-3 的**影子观察**（纯函数）。
 *
 * 取证结论（`dev_docs/20261019/G-05-G-09-取证报告.md`）：低水位成功样本不足，
 * **不启用**真实触发；本模块只把「若启用 20% 水位是否会被触发」如实记录，
 * 供后续复评（不改压缩决策、不产生额外 LLM 调用）。
 */
export const USD_WATERLINE_TRIGGER_PCT = 20;

export interface UsdWaterlineShadow {
  /** 剩余额度百分比（0–100；未配置/非法 ⇒ `null`） */
  remainingPct: number;
  /** 若启用 20% 水位规则，本次是否会触发 */
  wouldTriggerAt20: boolean;
}

/**
 * 计算影子观察结果。
 * @returns `null` = 未配置金额上限（`limitUsd` 为 `null`/非法）⇒ 不臆造百分比
 */
export function evaluateUsdWaterlineShadow(
  usedUsd: number,
  limitUsd: number | null | undefined
): UsdWaterlineShadow | null {
  if (
    limitUsd === null ||
    limitUsd === undefined ||
    !Number.isFinite(limitUsd) ||
    limitUsd <= 0 ||
    !Number.isFinite(usedUsd)
  ) {
    return null;
  }
  const remainingPct = Math.max(0, (1 - usedUsd / limitUsd) * 100);
  return {
    remainingPct: Number(remainingPct.toFixed(1)),
    wouldTriggerAt20: remainingPct <= USD_WATERLINE_TRIGGER_PCT,
  };
}
