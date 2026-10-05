/**
 * 长程任务**目标域词表** —— 类型中心（app 侧入口）。
 *
 * 沿革：
 * - 2026-10-01 B11 前置 P1（D-223）：`TaskGoalStatus` / `TaskGoalUpdateReason` /
 *   `GoalDeviationSeverity` / `GoalTemplateKind` 由
 *   `tasks/goal/*`（app）**下沉到 core 类型中心**（本文件）—— 解除
 *   `session/types/eventPayloads.ts` 经 `@modules/tasks`(app) 取用时对 B11 的传递倒挂。
 * - 2026-10-05 P1-18 / L4：4 者均为**纯字面量联合、零出向依赖**，且被**跨端载荷**共同引用
 *   （`client/src/types/events.ts` 曾手写镜像）⇒ 进一步下沉 **shared 单一事实源**
 *   `shared/types/goal-types.ts`，本文件按 R05-013 口径**再导出**
 *   ⇒ `@modules/types/goal` 桶与既有消费方（`tasks/goal/*` · `session/types/*` · `chat`）零改动。
 *
 * 详见表 `.trae/specs/shared-event-name-single-source.md`（§6 L4）。
 */

export type {
  TaskGoalStatus,
  TaskGoalUpdateReason,
  GoalDeviationSeverity,
  GoalTemplateKind,
} from '@shared/types/goal-types';
