// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * executorBudgetGuard —— 长程任务执行器的**日预算统一收口**（计账 + 闸门）
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外移（R04-001 行数上限；2026-11-08）：
 * **只搬不改**（含全部原注释与日志文案），宿主仅保留一行调用。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { estimateMessagesTokens } from '@modules/ai';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import type { ExecutorFn } from './contracts.js';
import { recordDailyBudgetFromUsage } from '../../query/DailyBudgetManager';
// G-2/D（2026-10-11）：闸门**单一收口**（与流式/非流式 chat 同源判定），用于长程任务执行器
import {
  checkDailyBudget,
  formatBudgetExhausted,
} from '../../query/dailyBudgetGate';

const logger = getLogger('tasks:longRunning');

/**
 * G-2/D（2026-10-11，Spec `daily-budget-over-limit-ux.md` §5-D-1 D / §1.2 G-2）：
 * 长程任务执行器的**日预算统一收口**（计账 + 闸门）。
 *
 * **为什么需要**：长程任务走的是**非 chat 管线**（默认执行器直调 `AIService.generate`）——
 * 它不经 `CoreAPI.chatStream`（流式闸门）也不经 `sendMessageFlow`（非流式闸门）⇒ 此前
 * **既无闸门也无（自定义执行器的）计账**，可在预算耗尽后继续跑（G-2 的绕过路径）。
 *
 * **收口口径**（对齐流式/非流式 chat 的单一收口 `checkDailyBudget()`）：
 *   1. **判定在前**：以"系统提示 + 用户提示"的估算为 `estimatedTokens`，超限即抛
 *      `DAILY_BUDGET_EXCEEDED`（**不发起模型调用**）；
 *   2. **中止即可续跑**（本节无新挂起机制，见 Spec §10-8）：抛出点在阶段边界之后
 *      （`setPhase()` 已落 checkpoint）⇒ 任务停在当前阶段，放行后**重发/续跑**即可；
 *   3. **计账**：自定义执行器若回传 `usage` 则计入日预算；默认执行器已在内部记账
 *      （其返回值不含 `usage`）⇒ **不会被重复计入**。
 */
export function guardExecutorWithDailyBudget(
  base: ExecutorFn,
  taskId: string
): ExecutorFn {
  return async (params) => {
    const estimatedTokens = estimateMessagesTokens([
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ]);
    const decision = checkDailyBudget({
      sessionId: taskId,
      estimatedTokens,
    });
    if (!decision.allowed) {
      logger.warn('lro:budget — 执行器调用前置检查拒绝', {
        taskId,
        taskType: params.taskType,
        todayUsed: decision.snapshot.used,
        dailyLimit: decision.snapshot.limit,
        estimateThisRound: estimatedTokens,
        mode: decision.snapshot.mode,
      });
      throw new AppError(
        `${formatBudgetExhausted(decision.snapshot)}，为避免超额，本次未调用模型；任务已停在当前阶段，放行后可直接续跑/重发。`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        'DAILY_BUDGET_EXCEEDED',
        {
          taskId,
          // 口径随快照（2026-10-15：主口径已切 USD）—— 与 `resolveEntryBudgetDenial` 的 context 同形。
          unit: decision.snapshot.unit,
          todayUsed: decision.snapshot.used,
          dailyLimit: decision.snapshot.limit,
          estimateThisRound: estimatedTokens,
          blockedBy: decision.blockedBy,
        }
      );
    }
    const result = await base(params);
    // 计账：仅"执行器回传 usage"时计入（默认执行器内部已记账 ⇒ 不回传 usage ⇒ 不重复计）
    // 债四「换算接线」（2026-10-13）：**自定义** ExecutorFn 的实际模型对编排器不可见
    // （见 `lro/contracts.ts` 的 `ExecutorResult` 说明）⇒ 该路径**只记 token、不记金额**
    // （`recordTurnCostUsd` 以 `debug` 留痕，**不取兜底价、不臆造金额**）。
    if (result && typeof result === 'object') {
      recordDailyBudgetFromUsage((result as { usage?: unknown }).usage);
    }
    return result;
  };
}
