/**
 * StatusBadge — 日历事件状态标签组件
 */

import type { EventStatus } from "../../../types/office";

const STATUS_STYLES: Record<
  EventStatus,
  { bg: string; text: string; dot: string; label: string }
> = {
  pending: {
    bg: "bg-blue-100 dark:bg-blue-900",
    text: "text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    label: "待办",
  },
  in_progress: {
    bg: "bg-yellow-100 dark:bg-yellow-900",
    text: "text-yellow-700 dark:text-yellow-300",
    dot: "bg-yellow-500",
    label: "进行中",
  },
  completed: {
    bg: "bg-green-100 dark:bg-green-900",
    text: "text-green-700 dark:text-green-300",
    dot: "bg-green-500",
    label: "已完成",
  },
  cancelled: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-400 dark:text-gray-500",
    dot: "bg-gray-400",
    label: "已取消",
  },
  overdue: {
    bg: "bg-red-100 dark:bg-red-900",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    label: "超时",
  },
};

interface StatusBadgeProps {
  status: EventStatus;
  /** 只显示圆点（用于紧凑布局） */
  dotOnly?: boolean;
}

export default function StatusBadge({ status, dotOnly }: StatusBadgeProps) {
  const style = STATUS_STYLES[status];
  if (!style) return null;

  if (dotOnly) {
    return (
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`}
        title={style.label}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded ${style.bg} ${style.text}`}
    >
      <span className={`inline-block w-1 h-1 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

export { STATUS_STYLES };
