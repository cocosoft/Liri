/**
 * OfficeStatusBadge — 办公模块状态徽章
 * 统一使用 "active" | "degraded" | "inactive" 三级状态
 */

export type ModuleCardStatus = "active" | "degraded" | "inactive";

/** 状态 → Tailwind 颜色类映射 */
const statusColors: Record<ModuleCardStatus, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  degraded:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  inactive: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/** 状态 → 指示器图标 */
const statusIcons: Record<ModuleCardStatus, string> = {
  active: "●",
  degraded: "◐",
  inactive: "○",
};

/** 状态徽章组件 */
export function OfficeStatusBadge({
  status,
  text,
}: {
  status: ModuleCardStatus;
  text: string;
}) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusColors[status]}`}
    >
      <span className="text-[10px]">{statusIcons[status]}</span>
      {text}
    </span>
  );
}
