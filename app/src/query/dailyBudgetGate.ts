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
import { formatBudget } from './dailyBudgetSnapshot.js';
import type { BudgetSnapshot } from './dailyBudgetSnapshot.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

// 快照形状与格式化已下沉到**叶子模块**（`dailyBudgetSnapshot`）以避免与状态机形成循环导入；
// 此处仅**再导出**，既有消费方（本模块的导入者）无需改动。
export type { BudgetMode, BudgetSnapshot } from './dailyBudgetSnapshot.js';
export { formatBudget } from './dailyBudgetSnapshot.js';

// 快照形状与格式化见 `dailyBudgetSnapshot`（叶子模块，本模块再导出）。

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

/**
 * **入口闸门**（G-2 阶段 3 · D-g 的 F/G/K/M）：非 chat 管线对话类入口的"判定 + 出路"统一收口。
 *
 * 各入口的**判定**同为 `checkDailyBudget()`（单一收口）；差别只在**出路载体**
 * （HTTP JSON / 协议任务态 / 流式 error 块 / 终端回显）⇒ 此处只产**载荷**，载体由各入口决定。
 */
export interface EntryBudgetDenial {
  code: 'DAILY_BUDGET_EXCEEDED';
  /** 人读文案（已含"去哪里放行"的指引，可由各载体原样透出） */
  message: string;
  /** 结构化上下文（供 HTTP/协议面拼可操作响应） */
  context: Record<string, unknown>;
}

/**
 * 判定"该入口本轮能否进入模型调用"（**纯函数，不抛**）。
 *
 * @returns `null` ⇒ 放行；否则为带文案与上下文的拒绝载荷
 */
export function resolveEntryBudgetDenial(input: {
  entry: string;
  estimatedTokens: number;
}): EntryBudgetDenial | null {
  const decision = checkDailyBudget({
    sessionId: input.entry,
    estimatedTokens: input.estimatedTokens,
  });
  if (decision.allowed) return null;
  return {
    code: 'DAILY_BUDGET_EXCEEDED',
    message:
      `今日 Token 预算已用完（已用 ${decision.snapshot.used} / 上限 ${decision.snapshot.limit}），为避免超额，本次未调用模型。` +
      '放行方式：在桌面端「用量中心 → 日限额」临时提额 / 今日解除（或调高每日上限）后重试。',
    context: {
      entry: input.entry,
      todayUsed: decision.snapshot.used,
      dailyLimit: decision.snapshot.limit,
      estimateThisRound: input.estimatedTokens,
    },
  };
}

/** 由拒绝载荷构造业务异常（唯一构造点；调用方可据此 throw 或自行转载体） */
export function createEntryBudgetError(denial: EntryBudgetDenial): AppError {
  return new AppError(
    denial.message,
    ErrorCategory.RESOURCE,
    ErrorSeverity.MEDIUM,
    denial.code,
    denial.context
  );
}

/** 入口闸门的"抛异常"载体：放行即返回，拒绝即抛带真实业务码的 `AppError`。 */
export function assertEntryBudget(input: {
  entry: string;
  estimatedTokens: number;
}): void {
  const denial = resolveEntryBudgetDenial(input);
  if (denial) throw createEntryBudgetError(denial);
}
