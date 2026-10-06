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
