/**
 * 定时任务统计卡（CronPage 拆分批 1，2026-11-18）
 *
 * 纯展示：按 `status` 计数，不持有状态。行为与拆分前**逐字一致**（仅把内联 JSX 外移）。
 */
import { useTranslation } from "react-i18next";
import type { CronTask } from "../../../types";

interface Props {
  tasks: CronTask[];
}

/** 单张统计卡（图标底色 + 标题 + 计数） */
function StatCard({
  iconBg,
  iconColor,
  pathD,
  label,
  count,
}: {
  iconBg: string;
  iconColor: string;
  pathD: string;
  label: string;
  count: number;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-center gap-2">
        <div
          className={`w-8 h-8 ${iconBg} rounded-lg flex items-center justify-center`}
        >
          <svg
            className={`w-4 h-4 ${iconColor}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={pathD}
            />
          </svg>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
            {count}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CronStatsGrid({ tasks }: Props) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <StatCard
        iconBg="bg-blue-100 dark:bg-blue-900/30"
        iconColor="text-blue-600 dark:text-blue-400"
        pathD="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        label={t("cron.totalTasks", "Total")}
        count={tasks.length}
      />
      <StatCard
        iconBg="bg-green-100 dark:bg-green-900/30"
        iconColor="text-green-600 dark:text-green-400"
        pathD="M5 13l4 4L19 7"
        label={t("cron.running", "Running")}
        count={tasks.filter((task) => task.status === "running").length}
      />
      <StatCard
        iconBg="bg-yellow-100 dark:bg-yellow-900/30"
        iconColor="text-yellow-600 dark:text-yellow-400"
        pathD="M13 10V3L4 14h7v7l9-11h-7z"
        label={t("cron.idle", "Idle")}
        count={tasks.filter((task) => task.status === "idle").length}
      />
      <StatCard
        iconBg="bg-red-100 dark:bg-red-900/30"
        iconColor="text-red-600 dark:text-red-400"
        pathD="M6 18L18 6M6 6l12 12"
        label={t("cron.error", "Errors")}
        count={tasks.filter((task) => task.status === "error").length}
      />
    </div>
  );
}
