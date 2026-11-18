/**
 * 调度器状态栏（CronPage 拆分批 1，2026-11-18）
 *
 * 纯展示三态：无状态（加载中）/ 运行中（含活跃数与运行时长）/ 已停止。
 */
import { useTranslation } from "react-i18next";

interface Props {
  status: {
    running: boolean;
    activeJobs: number;
    uptimeMs: number;
  } | null;
  loading: boolean;
}

export default function CronSchedulerStatusBar({ status, loading }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={`mb-4 px-4 py-2 rounded-lg border text-sm flex items-center gap-3 ${
        !status
          ? "bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-700"
          : status.running
            ? "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-800"
            : "bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-800"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          !status
            ? "bg-gray-400"
            : status.running
              ? "bg-green-500"
              : "bg-red-500"
        }`}
      />
      <span className="text-gray-700 dark:text-gray-300">
        {!status || loading
          ? t("cron.schedulerStatusLoading", "调度器状态加载中...")
          : status.running
            ? t("cron.schedulerRunning", "调度器运行中")
            : t("cron.schedulerStopped", "调度器已停止")}
      </span>
      {status?.running && (
        <>
          <span className="text-gray-400">|</span>
          <span className="text-gray-500 dark:text-gray-400">
            {t("cron.activeJobs", "活跃")}: {status.activeJobs}
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-gray-500 dark:text-gray-400">
            {t("cron.uptime", "运行")}: {Math.floor(status.uptimeMs / 60000)}m
          </span>
        </>
      )}
    </div>
  );
}
