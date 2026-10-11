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
  /** 单位（当前仅 `'tokens'`；USD 专项切换点） */
  unit: 'tokens';
  /** 已用量的展示串（如 `"901.2 K Tokens"`） */
  formatted: string;
  /** 当前档位 */
  mode: BudgetMode;
}

/** 数字 ↔ 展示串：`<1000` 原样，`≥1000` 走 `K` 后缀并保留 1 位小数。 */
export function formatBudget(
  used: number,
  unit: BudgetSnapshot['unit']
): string {
  const label = unit === 'tokens' ? 'Tokens' : unit;
  const shown = used >= 1000 ? `${(used / 1000).toFixed(1)} K` : `${used}`;
  return `${shown} ${label}`;
}
