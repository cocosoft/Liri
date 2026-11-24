/**
 * 任务/步骤状态 → 图标 / 颜色 / 文案键 —— **单一事实源**（批次 5 / C2，2026-11-24）。
 *
 * 缺口（已收口，2026-11-24）：同一套状态词汇曾在 5 处各维护一份表（`TaskCard` / `StatusFloatBar` /
 * `ProgressCard` / `DAGFullScreen` / `DAGMiniMap`）⇒ 新增状态（如 `skipped`）时
 * 总有一两处漏改（真机：被跳过任务在 Mini 面板显示 `?`）。
 *
 * 口径：**状态取值**仍是领域类型（`TaskCardTask["status"]`）；本模块只做展示映射。
 * 未登记取值回退 `pending` 样式（不臆造新状态）。
 */
import type { TaskCardTask } from "@/types";

export type TaskStatusCode = TaskCardTask["status"];

export interface TaskStatusStyle {
  /** 图标（纯文本/emoji） */
  icon: string;
  /** Tailwind 文本色类（可含 animate-spin 等） */
  color: string;
  /** 文案 i18n 键 */
  labelKey: string;
}

/** 任务状态展示样式（TaskCard / StatusFloatBar 共用） */
export const TASK_STATUS_STYLES: Record<TaskStatusCode, TaskStatusStyle> = {
  pending: { icon: "○", color: "text-gray-400", labelKey: "chat.taskPending" },
  in_progress: {
    icon: "⟳",
    color: "text-blue-500 animate-spin inline-block",
    labelKey: "chat.executing",
  },
  completed: { icon: "✓", color: "text-green-500", labelKey: "chat.completed" },
  failed: { icon: "✗", color: "text-red-500", labelKey: "chat.failed" },
  // S3 修复（2026-08-23）：cancelled 独立终态（用户中止），橙色区别于 failed
  cancelled: {
    icon: "⏹",
    color: "text-orange-500",
    labelKey: "chat.taskCancelled",
  },
  blocked: {
    icon: "⏸",
    color: "text-orange-400",
    labelKey: "chat.taskBlocked",
  },
  // T5 修复：后端 todo-types.ts 存在 skipped 状态
  skipped: { icon: "↷", color: "text-gray-400", labelKey: "chat.taskSkipped" },
};

/**
 * 取任务状态样式（**宽松入参**：容错进度卡片的 `done` 别名与历史未知取值）。
 * 未登记 ⇒ `pending` 样式（不谎报完成/执行中）。
 */
export function getTaskStatusStyle(status: string): TaskStatusStyle {
  const key = status === "done" ? "completed" : status;
  return (
    TASK_STATUS_STYLES[key as TaskStatusCode] ?? TASK_STATUS_STYLES.pending
  );
}

export interface DagStatusColors {
  bg: string;
  border: string;
  text: string;
}

/** DAG 节点配色（DAGFullScreen / DAGMiniMap 共用；全部走主题变量） */
export const DAG_STATUS_COLORS: Record<TaskStatusCode, DagStatusColors> = {
  pending: {
    bg: "var(--status-pending-bg)",
    border: "var(--status-pending-border)",
    text: "var(--status-pending-text)",
  },
  in_progress: {
    bg: "var(--status-running-bg)",
    border: "var(--status-running-border)",
    text: "var(--status-running-text)",
  },
  completed: {
    bg: "var(--status-done-bg)",
    border: "var(--color-success-strong)",
    text: "var(--status-done-text)",
  },
  failed: {
    bg: "var(--color-error-bg)",
    border: "var(--color-error)",
    text: "var(--color-error-strong)",
  },
  // S3 修复：cancelled 独立终态色（橙色"已取消"）
  cancelled: {
    bg: "var(--status-cancelled-bg)",
    border: "var(--status-cancelled-border)",
    text: "var(--status-cancelled-text)",
  },
  blocked: {
    bg: "var(--status-blocked-bg)",
    border: "var(--status-cancelled-border)",
    text: "var(--status-cancelled-text)",
  },
  skipped: {
    bg: "var(--status-skipped-bg)",
    border: "var(--status-skipped-border)",
    text: "var(--status-pending-text)",
  },
};
