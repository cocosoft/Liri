/**
 * 共享 UI 常量（client 内多处复用的展示口径）。
 *
 * 收敛动机（U-20/B5-2-90）：`DEFAULT_COLOR` / `INTERACTIONS` / `ENABLE_TRACE_REDESIGN`
 * 此前在两个组件内各写一份**同值同名**常量 ⇒ `lint:consts` 报同名重复；
 * 三者语义一致（徽章默认配色、伙伴互动清单、追踪视图开关），故收敛为单一事实源。
 */

/** 模型 / 供应商徽章的默认配色（Tailwind 类名） */
export const DEFAULT_BADGE_COLOR =
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";

/** 伙伴互动动作清单（顺序即 UI 展示顺序） */
export const BUDDY_INTERACTIONS = [
  "pet",
  "feed",
  "play",
  "praise",
  "scold",
] as const;

/** 追踪（trace）视图重设计开关 —— 日志页与仪表盘共用 */
export const ENABLE_TRACE_REDESIGN = true;
