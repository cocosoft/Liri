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
 * budgetGate —— 预算**判定式 + 拒绝理由词汇**的唯一实现（P2 待办 2/2，2026-11-04）。
 *
 * ## 为什么要单独成模块
 *
 * 改造前"为什么被拦"只存在于各入口自己拼的字符串里：HTTP 入口拼 `entry/unit/todayUsed`、
 * 长程执行器拼 `taskId/unit/todayUsed` —— **同一判定有两份证据形状**，且都答不出
 * "是手动总闸还是额度用完"。本模块把**判定式**与**理由词汇**收成一份**纯函数**（零 I/O、
 * 零依赖），`dailyBudgetGate.checkDailyBudget()` 与各拒绝载体都从它取结论。
 *
 * ## 口径（与既有裁定逐字一致，不改任何阈值）
 *
 * 1. **金额是唯一硬闸**：主口径档位 `locked` ⇒ 拒发；`waiver`（一次性通行证）⇒ 放行本轮；
 * 2. **kill-switch 是手动总闸**：任何情况下拒发，且**不可**被 `waiver` 绕过；
 * 3. **Token 轨不参与判定**（用户 2026-10-15 裁定）⇒ 本模块**没有** `token_limit` 理由；
 *    越界只经 `checkDailyBudget` 的 `tokenTrack` 观测块记录。
 *
 * ## 未合并的部分（如实记录）
 *
 * ReAct 轮级熔断（`query/ReActLoop.ts#checkCircuitBreaker`）是**循环内部状态**（连续无效轮数），
 * 没有跨入口的消费者，也没有与日预算共享的判定点 ⇒ 本模块**不**把它当作输入；
 * 需要时由循环自己在 `state.lastError` 里解释。硬合并只会造出一份没人用的入参。
 */
import type { BudgetMode } from './dailyBudgetSnapshot.js';
import { isBudgetModeLocked } from './dailyBudgetSnapshot.js';

/** 拒发理由：手动总闸 / 额度用尽（单位见调用方 evidence 的 `unit`） */
export type BudgetBlockedBy = 'kill_switch' | 'budget_limit';

export interface BudgetGateInput {
  /** 主口径档位（USD 轨启用时按金额计算；`locked` ⇒ 额度已用尽） */
  mode: BudgetMode;
  /** 手动总闸（独立于用量） */
  killSwitch: boolean;
  /** 一次性通行证（只放行本轮，不消费） */
  waiver: boolean;
}

export interface BudgetGateVerdict {
  allowed: boolean;
  /** 放行时恒为 `null`；拒发时区分"手动总闸"与"额度用尽" */
  blockedBy: BudgetBlockedBy | null;
}

export function evaluateBudgetGate(input: BudgetGateInput): BudgetGateVerdict {
  const primaryAllows = !isBudgetModeLocked(input.mode);
  const allowed = !input.killSwitch && (input.waiver || primaryAllows);
  if (allowed) return { allowed: true, blockedBy: null };
  return {
    allowed: false,
    blockedBy: input.killSwitch ? 'kill_switch' : 'budget_limit',
  };
}
