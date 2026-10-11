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
 * dailyBudgetGate —— 日预算闸门**唯一收口**（G-1 前置 / Spec `daily-budget-over-limit-ux.md`）。
 *
 * **为什么要有这个模块**：闸门原先内联在 `preSendContextProtection`（仅流式、仅请求开始判定一次）。
 * "超额才拦"的根因是**工具循环每轮不复检** ⇒ 必须有一个**无副作用、可被逐轮调用**的判定入口。
 *
 * **单位无关（Metric-Agnostic，Spec §11）**：对外快照用与单位无关的命名并携带 `unit`/`formatted`，
 * 使后续"以钱（USD）为准"的专项只需替换 `unit`/折算逻辑，而不改判定点与调用方签名。
 */

import { getDailyBudget } from './DailyBudgetManager.js';

/** 日预算档位（对齐 `DailyBudgetManager` 内部同名联合类型）。 */
export type BudgetMode = 'normal' | 'report_only' | 'locked';

/**
 * 单位无关的预算快照（Spec §11）。
 *
 * `formatted` **只描述已用量**（对齐 Spec §11 的示例 `"901.2 K Tokens"`）。
 */
export interface BudgetSnapshot {
  /** 已用量（当前单位；今日为**实际**用量，不含在途预留） */
  used: number;
  /** 上限（当前单位） */
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

/**
 * 判定"本轮能否发起模型调用"（**纯读，无副作用**）。
 *
 * `allowed = mode !== 'locked' && (projectedUsed + estimatedTokens) < dailyLimit`。
 *
 * - 与既有 `preSendContextProtection` 的内联判定**互补等价**：
 *   原拒绝条件 = `mode === 'locked' || (projected + estimate) >= limit`。
 * - **不做预扣**：预扣（`reserveFor`）仍由调用方负责；本函数可被工具循环**逐轮**安全调用。
 */
export function checkDailyBudget(input: {
  sessionId: string;
  estimatedTokens: number;
}): { allowed: boolean; snapshot: BudgetSnapshot } {
  const state = getDailyBudget().getMode();
  const projected = state.projectedUsed + input.estimatedTokens;
  return {
    allowed: state.mode !== 'locked' && projected < state.dailyLimit,
    snapshot: {
      used: state.todayUsed,
      limit: state.dailyLimit,
      unit: 'tokens',
      formatted: formatBudget(state.todayUsed, 'tokens'),
      mode: state.mode,
    },
  };
}
