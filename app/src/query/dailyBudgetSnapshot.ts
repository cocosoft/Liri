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
 * dailyBudgetSnapshot.ts —— 预算快照的**叶子模块**（类型 + 纯格式化，**零依赖**）。
 *
 * **为什么单独成模块**：闸门（`dailyBudgetGate`）与状态机（`DailyBudgetManager`）都要这套
 * "单位无关（Metric-Agnostic）"形状（Spec §11）；若把它留在闸门内，状态机引用闸门就会与
 * "闸门 → 状态机（`getDailyBudget`）"形成**循环导入**。放在叶子模块后依赖方向单向：两侧 → 本模块。
 */

/** 日预算档位（对齐 `DailyBudgetManager` 内部同名联合类型）。 */
export type BudgetMode = 'normal' | 'report_only' | 'locked';

/**
 * 单位无关的预算快照（Spec §11）。
 *
 * `formatted` **只描述已用量**（对齐 Spec §11 的示例 `"901.2 K Tokens"`）。
 */
export interface BudgetSnapshot {
  /** 已用量（当前单位；为**实际**用量，不含在途预留） */
  used: number;
  /** 上限（当前单位；relief 生效时为**有效上限**） */
  limit: number;
  /**
   * 单位：`'tokens'`（Token 轨，默认）或 `'usd'`（金额轨 —— USD-4 双轨从严命中金额轨时）。
   *
   * 快照描述的是**导致本次拒绝的那条轨**；放行时恒为 `'tokens'`（与 USD-4 之前**逐字一致**）。
   */
  unit: 'tokens' | 'usd';
  /** 已用量的展示串（如 `"901.2 K Tokens"` / `"$12.50"`） */
  formatted: string;
  /** 当前档位 */
  mode: BudgetMode;
}

/** 金额（USD）→ 展示串：最少 2 位、最多 4 位小数（与前端 `formatUsd` 同口径）。 */
export function formatUsdAmount(n: number): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

/** 数字 ↔ 展示串：`<1000` 原样，`≥1000` 走 `K` 后缀并保留 1 位小数；金额轨走货币格式。 */
export function formatBudget(
  used: number,
  unit: BudgetSnapshot['unit']
): string {
  if (unit === 'usd') return formatUsdAmount(used);
  const shown = used >= 1000 ? `${(used / 1000).toFixed(1)} K` : `${used}`;
  return `${shown} Tokens`;
}

/**
 * 单位无关的「预算已用完」**人读前缀**（调用方在其后追加各自的出路指引）。
 *
 * **Token 轨逐字保留**既有文案 ⇒ USD 未启用 / 未命中金额轨时，全链用户可见文案**零变更**。
 */
export function formatBudgetExhausted(snapshot: BudgetSnapshot): string {
  if (snapshot.unit === 'usd') {
    return `今日金额预算已用完（已用 ${formatUsdAmount(snapshot.used)} / 上限 ${formatUsdAmount(snapshot.limit)}）`;
  }
  return `今日 Token 预算已用完（已用 ${snapshot.used} / 上限 ${snapshot.limit}）`;
}
