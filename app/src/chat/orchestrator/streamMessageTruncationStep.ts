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
 * S6「截断 / 降级」的**纯决策**（P2-1d-3）
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S6 / §5。
 *
 * **目的（把「决策」与「重发动作」分离）**：`runStreamMessage` 内该段原本是三层嵌套
 * `if`（`stop_reason === 'max_tokens'` → 无正文 → 未降级过）**夹着** `continue` / `yield`
 * / 事件写入。控制流**无法**外移（`continue` 不能从被调函数里发出），但**分支判据本身是纯的**
 * ⇒ 判据收敛到本模块，**动作**（写事件 / yield / `continue` / `break`）仍留在编排函数内。
 *
 * **策略原文（自 `runStreamMessage` 迁入，2026-10-10）**：`max_tokens` 截断且本轮**无正文**
 * 时，原 2026-08-22 直接跳过重试作废本轮；R2（2026-09-06，走查 W2/W8）改为——先做 **1 次**
 * "降级重试"，仍无产出才作废。典型场景：本地推理模型（DeepSeek-R1-Distill 等）思考过长，
 * thinking 占满输出预算，正文始终为 0；若直接按"有正文"路径**加大** `maxTokens` 重试，模型
 * 只会重新思考（仍会截断），属**无效连环重试**（曾致 4 次重试 / 173s / 空正文）。
 */

/** 截断/降级分支的**决策结果**（判别式联合；`kind` 即状态，CS02 非字符串匹配） */
export type TruncationStep =
  /** 无正文且尚未降级 ⇒ 降级一轮（注入收敛指令 + 更小预算） */
  | { kind: 'degrade'; maxTokens: number }
  /** 无正文且**已**降级过 ⇒ 终态（不再连环重试） */
  | { kind: 'give-up' }
  /** 有正文 ⇒ 以**更大**预算续写（是否耗尽由 `advanceMaxOutputRetry` 判） */
  | { kind: 'grow' }
  /** 非截断结束 ⇒ 不重试 */
  | { kind: 'stop' };

/** 降级预算下限：足够 1-3 句结论 / 单次工具调用 */
export const DEGRADE_BUDGET_FLOOR = 256;

/**
 * 由「停止原因 / 本轮是否有正文 / 是否已降级过」判定下一步（**纯函数**，无副作用）。
 *
 * @param currentMaxTokens 本轮生效的输出预算（用于计算降级预算）
 */
export function decideTruncationStep(params: {
  stopReason: string | undefined;
  hasContent: boolean;
  degradeTried: boolean;
  currentMaxTokens: number;
}): TruncationStep {
  if (params.stopReason !== 'max_tokens') return { kind: 'stop' };
  if (params.hasContent) return { kind: 'grow' };
  if (params.degradeTried) return { kind: 'give-up' };
  // 降级预算 = 上一轮被思考耗尽预算的**一半**（下限 `DEGRADE_BUDGET_FLOOR`）
  return {
    kind: 'degrade',
    maxTokens: Math.max(
      DEGRADE_BUDGET_FLOOR,
      Math.floor(params.currentMaxTokens / 2)
    ),
  };
}
