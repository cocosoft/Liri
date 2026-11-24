/**
 * 计划（Plan）状态 → 圆点色 / 文本色 / 文案键 —— **单一事实源**（批次 4，2026-11-24）。
 *
 * 缺口：`PlansPage` 与 `PlansPanel` 各自维护一份映射（键集同为
 * `pending/running/completed/failed/aborted`，但一处是文本色、一处是圆点色），
 * 且 `PlansPanel` 直接把英文枚举 `plan.status` 打到界面上（未翻译）。
 *
 * 口径：状态取值来自 `/v1/plans` 的 `plan.status`；本模块只做展示映射。
 * 未登记取值 ⇒ 调用方回退显示原始值（不臆造状态）。
 */
export type PlanStatusCode =
  "pending" | "running" | "completed" | "failed" | "aborted";

export interface PlanStatusStyle {
  /** 圆点底色（PlansPanel） */
  dotColor: string;
  /** 文本色（PlansPage 状态标签） */
  textColor: string;
  /** 文案 i18n 键（`plans.*`，zh/en 均已存在） */
  labelKey: string;
}

export const PLAN_STATUS_STYLES: Record<PlanStatusCode, PlanStatusStyle> = {
  pending: {
    dotColor: "bg-yellow-400",
    textColor: "text-yellow-600 dark:text-yellow-400",
    labelKey: "plans.pending",
  },
  running: {
    dotColor: "bg-blue-500",
    textColor: "text-blue-600 dark:text-blue-400",
    labelKey: "plans.running",
  },
  completed: {
    dotColor: "bg-green-500",
    textColor: "text-green-600 dark:text-green-400",
    labelKey: "plans.completed",
  },
  failed: {
    dotColor: "bg-red-500",
    textColor: "text-red-600 dark:text-red-400",
    labelKey: "plans.failed",
  },
  aborted: {
    dotColor: "bg-orange-500",
    textColor: "text-gray-500 dark:text-gray-400",
    labelKey: "plans.aborted",
  },
};

/** 取计划状态样式；未登记取值 ⇒ `undefined`（调用方回退原始值） */
export function getPlanStatusStyle(
  status: string,
): PlanStatusStyle | undefined {
  return PLAN_STATUS_STYLES[status as PlanStatusCode];
}
