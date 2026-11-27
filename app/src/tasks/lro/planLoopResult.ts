/**
 * lro/planLoopResult.ts — PlanDrivenLoop 的**结果类型 + 汇总构建**（2026-11-28 外移）
 *
 * **来源**：`tasks/PlanDrivenLoop.ts` 的 `StepState` / `StepResult` / `BlockedStepInfo` /
 * `PlanDrivenLoopResult` 类型与私有方法 `_buildResult`（**逐字搬迁**；唯一改动是
 * `this.pausedForApproval/startTime/aborted/budgetExhausted/totalTokens` → 入参）。
 *
 * 为什么外移：`PlanDrivenLoop.ts` 已到 R04-001 的 2000 行边界（例外 FSE-002）；汇总构建是
 * **纯文本/计数**逻辑、无宿主副作用，属最安全的可外移簇。宿主侧保留同名薄委托，调用点零改动。
 *
 * 行为不变红线：计数口径（`paused` 不计 failed）、文案（"执行完成/结束"、暂停、阻断明细）逐字未变。
 */

/** 子任务执行状态 */
export type StepState = 'pending' | 'in_progress' | 'completed' | 'failed';

/** 单步执行结果 */
export interface StepResult {
  stepId: string;
  description: string;
  state: StepState;
  output: string;
  error?: string;
  /**
   * 2026-11-13（PDL 暂停态）：本步**停在等待工具审批**（不是失败）。
   *
   * 保留 `state='failed'` 以兼容既有呈现，但计数与文案一律按"暂停"处理
   * （`buildPlanLoopResult` 不把它计入 failedSteps）。
   */
  paused?: boolean;
  /** P1-3（2026-09-06）：失败路线保留——终败前已产出片段（供 P0-2 重试/终局综合引用） */
  partialOutput?: string;
  durationMs: number;
  turnCount: number;
  tokenCount: number;
}

/**
 * 13-P1-1：被依赖阻断（未执行）的步骤明细。
 * 供 `PlanDrivenLoopResult` 回灌——`PdcaLauncher` 据此落**模型可见**的会话消息（Step 2）。
 */
export interface BlockedStepInfo {
  stepId: string;
  description: string;
  /** 阻断原因（`[DEPENDENCY_BLOCKED]` 原因部分，来自 `computeTopoSkips`） */
  reason: string;
}

/** PlanDrivenLoop 运行结果 */
export interface PlanDrivenLoopResult {
  /** 最终汇总文本 */
  summary: string;
  /** 是否使用了任务分解 */
  decomposed: boolean;
  /** 子任务数 */
  stepCount: number;
  /** 完成子任务数 */
  completedSteps: number;
  /** 失败子任务数 */
  failedSteps: number;
  /** 13-P1-1：因依赖阻断**未执行**的子任务数（plan 步 `cancelled`；不计入 completed/failed） */
  skippedSteps: number;
  /** 13-P1-1：被阻断步骤明细（模型可见回灌的载体，见 `BlockedStepInfo`） */
  blockedSteps: BlockedStepInfo[];
  /** 是否被用户中止（abort 不抛错、run 正常返回；上游据此写中止终态而非 completed） */
  aborted?: boolean;
  /** run 级 token 预算耗尽（成本护栏中止；上游按 failed 收尾而非 completed） */
  budgetExhausted?: boolean;
  /**
   * 2026-11-13：**停在等待工具审批**（不是失败、也不是完成）。
   *
   * 上游据此写"暂停"回执/检查点相位（`stage_awaiting_approval`），而不是把
   * "等用户批准"粉饰成"任务已结束"（会话 `session_mwdcivrue74d4838ff` 的用户可见问题）。
   */
  pausedForApproval?: boolean;
  /** 总耗时 ms */
  totalDurationMs: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 各步骤结果 */
  stepResults: StepResult[];
}

/** 汇总构建的输入（宿主 `this.*` 的显式投影） */
export interface PlanLoopResultInput {
  decomposed: boolean;
  stepResults: StepResult[];
  totalSteps: number;
  blockedSteps: readonly BlockedStepInfo[];
  pausedForApproval: boolean;
  aborted: boolean;
  budgetExhausted: boolean;
  totalTokens: number;
  startTime: number;
}

/** 构建最终结果（原 `PlanDrivenLoop._buildResult`，逐字搬迁） */
export function buildPlanLoopResult(
  input: PlanLoopResultInput
): PlanDrivenLoopResult {
  const { decomposed, stepResults, totalSteps, blockedSteps } = input;
  const completed = stepResults.filter((r) => r.state === 'completed').length;
  // 2026-11-13：等待审批的步骤不算失败（否则回执/汇总会把"等用户批"粉饰成未达成）
  const failed = stepResults.filter(
    (r) => r.state === 'failed' && r.paused !== true
  ).length;
  const blocked = blockedSteps.length;
  // 2026-11-02：因"连续受阻熔断"**未执行**的步骤（既不在 stepResults，也不在依赖阻断明细）
  const cascadeSkipped = Math.max(0, totalSteps - stepResults.length - blocked);

  let summary: string;
  if (input.pausedForApproval) {
    // 用户可见口径：暂停 ≠ 失败 ≠ 完成（会话 `session_mwdcivrue74d4838ff`）
    summary = `任务暂停：等待工具审批（${completed}/${totalSteps} 步完成；批准后自动续跑，剩余步骤未执行）`;
  } else if (decomposed) {
    // 轮数/总 token 等内部指标不进入 summary（用户可见），仅留在 StepResult 字段与日志
    // 13-P1-1 Step 2（2026-10-06）：分母改用**真实子任务数**——被阻断步骤不进 stepResults，
    // 原 `stepResults.length` 会把"2/4 被阻断"粉饰成"2/2 步骤成功"（CS06：不粉饰）。
    // 2026-11-02：**只有全部达成才可用"执行完成"** —— 0/2 步达成还说"执行完成"是新的一层粉饰。
    const allAchieved = totalSteps > 0 && completed === totalSteps;
    const parts = [
      allAchieved
        ? `任务分解执行完成：${completed}/${totalSteps} 步骤成功`
        : `任务分解执行结束：${completed}/${totalSteps} 步骤达成`,
      failed > 0 ? `，${failed} 步骤未达成` : '',
      blocked > 0 ? `，${blocked} 步骤因依赖阻断未执行` : '',
      cascadeSkipped > 0 ? `，${cascadeSkipped} 步骤因连续受阻提前终止` : '',
      `。总耗时 ${((Date.now() - input.startTime) / 1000).toFixed(1)}s`,
    ];
    summary = parts.join('');
    // 13-P1-1 Step 2：**阻断原因回灌** —— `[DEPENDENCY_BLOCKED]` 原先只落 plan 步 + SSE
    // （用户可见），模型侧完全不可见（F8 取证）⇒ 随 summary 进入会话消息。
    if (blocked > 0) {
      summary += `\n[依赖阻断明细]\n${blockedSteps
        .map((b) => `- ${b.description}：${b.reason}`)
        .join('\n')}`;
    }
  } else {
    summary = stepResults[0]?.output || '任务完成';
  }

  return {
    summary,
    decomposed,
    stepCount: stepResults.length,
    completedSteps: completed,
    failedSteps: failed,
    skippedSteps: blocked,
    blockedSteps: [...blockedSteps],
    aborted: input.aborted,
    budgetExhausted: input.budgetExhausted,
    pausedForApproval: input.pausedForApproval,
    totalDurationMs: Date.now() - input.startTime,
    totalTokens: input.totalTokens,
    stepResults,
  };
}
