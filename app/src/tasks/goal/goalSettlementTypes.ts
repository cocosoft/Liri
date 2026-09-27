/**
 * `GoalRunSettlement` —— 目标"批次落定结果"的**类型叶子**（自 `goalRunBinding.ts` 抽离）。
 *
 * **为什么抽离**（2026-09-26，CI `Static Checks` 的循环依赖门禁 10 > 基线 7）：
 * `GoalEvents.ts` 需要该类型，原先
 * `import type { GoalRunSettlement } from './goalRunBinding'` ⇒ 形成
 * `GoalEvents → goalRunBinding` 这条边，进而构成两条环：
 * `GoalEvents > goalRunBinding` 与 `GoalEvents > goalRunBinding > goalBudget`
 * （`madge --circular` 把 `import type` 也计环）。
 *
 * 本文件**零 import**（纯类型叶子）⇒ 回边消失、两条环一并被打断；运行时行为**零变化**。
 * 对外路径保持：`goalRunBinding.ts` 以 `export type` 再导出本类型。
 */

export interface GoalRunSettlement {
  goalId: string;
  /**
   * 落定的状态。
   * - `budget_limited`：因用量触顶收尾；
   * - `failed`：本次批次全败，**或**连续未达成达停止阈值（见 `NO_PROGRESS_STOP_THRESHOLD`）。
   */
  status: 'completed' | 'blocked' | 'failed' | 'cancelled' | 'budget_limited';
  /** 触顶时的**收尾指令**（`budget_limit` 模板渲染；未触顶 ⇒ undefined） */
  closingInstruction?: string;
  /** **停止条件**成立时的指令（`progress_stalled` 模板渲染）⇒ 该次已落终态 */
  stopInstruction?: string;
  /** 本次记账后的连续未达成批次数（仅 `blocked` 路径给出） */
  noProgressStreak?: number;
}
