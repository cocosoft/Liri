/**
 * lro/pureDecisions.ts — PDCA resume 扩容续跑的纯函数判定
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §46）：**只搬不改**（含原注释）。
 * 零宿主依赖 ⇒ 无循环；公开面由宿主 **re-export** 保持。
 */

/**
 * B-任务（2026-09-05）：max_turns 扩容续跑判定（纯函数，可单测）。
 * steps 含 max_turns 终止步骤且续跑次数未达上限 → 本轮放大轮次预算（×2）并计数+1。
 */
export function planTurnsExtensionDecision(
  steps: Array<{ terminationReason?: string }>,
  currentExtensions: number,
  limit: number
): { apply: boolean; multiplier: number; count: number } {
  const candidates = steps.filter(
    (s) => s.terminationReason === 'max_turns'
  ).length;
  if (candidates > 0 && currentExtensions < limit) {
    return { apply: true, multiplier: 2, count: currentExtensions + 1 };
  }
  return { apply: false, multiplier: 1, count: currentExtensions };
}

/** B-任务：扩容激活时，max_turns 终止的步骤置回 pending 重跑（loop_detected 拒绝） */
export function shouldReRollMaxTurnsStep(
  multiplierActive: boolean,
  terminationReason?: string
): boolean {
  return multiplierActive && terminationReason === 'max_turns';
}

/**
 * U-02（2026-10-19）：终止原因是否表示「预算耗尽但未收敛」。
 *
 * 这类步骤**不得**记为 completed（否则 review 只审 completed 步骤、目标门也可能
 * 看到"步骤全过"而形成假完成）；应落 failed 并保留 terminationReason，
 * 供 resume 扩容续跑 / 目标级评估使用。
 */
const NON_CONVERGED_TERMINATION_REASONS = new Set([
  'max_turns',
  'timeout',
  'budget_exhausted',
  /**
   * 2026-11-08（真机 `pdca_mw7sfwyf`）：TAORLoop 的 `no_tool_call` 死循环检测 critical
   * 会把 `stopReason` 置 `'aborted'`（模型连续多轮只回文本、不调工具）。此前该原因
   * **不在本集合** ⇒ 步骤被记为 `completed`（假完成）⇒ Review 判 REJECT ⇒ retry ⇒
   * 再次 aborted ⇒ 同一批步骤 4 轮反复"完成—拒绝"，最终 escalate/replan 也救不回来。
   * 中止 ≠ 完成：必须落 failed，交给重试/升级链处理。
   */
  'aborted',
]);

export function isNonConvergedTermination(reason?: string): boolean {
  return (
    typeof reason === 'string' && NON_CONVERGED_TERMINATION_REASONS.has(reason)
  );
}

/**
 * U-02（2026-10-19）：计划审批门是否应**自动通过**（无人值守模式）。
 *
 * 语义：仅当调用方要求审批、且当前处于无人值守模式时才自动通过；其余情况保持人工审批。
 * 抽成纯函数以便单测（`runFullPdca` 的审批分支依赖模型计划生成，难以在单测中直驱）。
 */
export function shouldAutoApprovePlan(
  requireApproval: boolean,
  isUnattended: boolean
): boolean {
  return requireApproval && isUnattended;
}

/**
 * PDCA 终态裁决（2026-11-09，真机 `pdca_mw81e4z5`）。
 *
 * 背景：`allDone` 的判据是"步骤全部终态"，而 `failed` 也是终态 ⇒ 此前「1 步 failed +
 * 其余 approved」会落 `completed`（汇总显示 `completed:2 / failed:1` 却报成功）。
 * 口径：`failed` **阻塞**成功；`cancelled`（用户 skip）不阻塞；escalate 走可续跑（不算成功）。
 *
 * 抽成纯函数以便直驱单测（终态分支在 `runFullPdca` 尾部，依赖模型计划生成）。
 */
export function decideTerminalOutcome(input: {
  allDone: boolean;
  hasEscalated: boolean;
  failureReason: string | null;
  /** 仅 `failed` 参与裁决（`cancelled` 视为用户主动跳过） */
  failedSteps: ReadonlyArray<{ id: string; description?: string }>;
}): { failureReason: string | null; succeeded: boolean } {
  let failureReason = input.failureReason;
  if (input.failedSteps.length > 0 && failureReason === null) {
    const first = input.failedSteps[0];
    failureReason =
      `PDCA_STEP_FAILED: 步骤「${(first.description || first.id).slice(0, 80)}」未完成` +
      (input.failedSteps.length > 1
        ? `（共 ${input.failedSteps.length} 步失败）`
        : '');
  }
  const succeeded =
    input.allDone &&
    !input.hasEscalated &&
    failureReason === null &&
    input.failedSteps.length === 0;
  return { failureReason, succeeded };
}
