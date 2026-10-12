/**
 * taor/budgetSuspendHook.ts — TAOR 链日预算耗尽挂起落点（Task 6）
 *
 * 承载 `TAORLoop.beforeReasoning` 耗尽分支的**全部新增逻辑**（TAORLoop 只留一次调用，
 * 满足巨型文件行数守则）：① 保持原日志语义（`logExhaustionAbort`）② 开关开时落
 * `type='budget_suspend'` 检查点并登记协调器；开关关时**只打日志**（零行为变更）。
 *
 * 边界：`BUDGET_SUSPEND_RESUME`（**默认开**；`=false` 即关）门控新增行为；挂起事实源 = 检查点，协调器仅内存登记。
 */

import { feature } from '@modules/core';
import { getDailyBudget } from '../DailyBudgetManager.js';
import { getBudgetSuspendCoordinator } from '../budgetSuspend.js';

/**
 * 处理 TAOR 链因日预算耗尽而中止：记日志（原语义），并按开关落挂起检查点 + 登记。
 *
 * @param deps.sessionId 会话 id（既入日志，也作挂起登记主键与检查点归属）
 * @param deps.reason 挂起原因（缺省 `daily_budget_exhausted`）
 * @param deps.logContext 原 `logExhaustionAbort` 的上下文字段（逐字保留，如 `{ turnCount }`）
 * @param deps.saveCheckpoint 落检查点（注入 `TAORLoop.saveCheckpoint`，返回检查点 id）
 */
export async function handleTaorBudgetExhaustion(deps: {
  sessionId: string;
  reason?: string;
  logContext?: Record<string, unknown>;
  saveCheckpoint: (t: 'budget_suspend') => Promise<string>;
}): Promise<void> {
  // ① 原日志语义（开关无关；耗尽可见性不因开关而变）
  getDailyBudget().logExhaustionAbort({
    sessionId: deps.sessionId,
    ...deps.logContext,
  });

  // ② 关（默认）⇒ 到此为止（零行为变更）
  if (!feature('BUDGET_SUSPEND_RESUME')) return;

  const checkpointRef = await deps.saveCheckpoint('budget_suspend');
  getBudgetSuspendCoordinator().suspend({
    sessionId: deps.sessionId,
    chain: 'taor',
    checkpointRef,
    reason: deps.reason ?? 'daily_budget_exhausted',
  });
}
