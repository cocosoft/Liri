/**
 * RunningTasksCard — 运行中任务列表（批次 4 职责收敛，2026-11-24）
 *
 * 收敛前的两个问题（`frontend-task-tools-governance.md` §6）：
 * 1. 自己再发一次 `GET /v1/cron`（CronPage 已有同一份数据）⇒ 同页同源双请求；
 * 2. 自带一套统计网格（`idle = enabled && status !== 'running'`）⇒ `error` 任务被
 *    同时计入「待机」与「异常」，而「总数」又含未启用任务 ⇒ 四项之和 ≠ 总数。
 *
 * 现口径：
 * - **数据来源**：由宿主页（CronPage）传入 `tasks`，本组件不再取数；
 * - **统计口径**：只保留 `CronStatsGrid` 一处（按 status 分区），本组件只列任务。
 */

import { useTranslation } from "react-i18next";
import type { CronTask } from "../types";

interface RunningTasksCardProps {
  /** 与 CronPage 同源的任务列表（不再自取） */
  tasks: CronTask[];
}

/** 运行中任务列表 */
function RunningTasksList({ tasks }: { tasks: CronTask[] }) {
  const { t } = useTranslation();
  const running = tasks.filter((t) => t.enabled && t.status === "running");

  if (tasks.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
        {t("tasks.noRunningTasks")}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {running.length > 0 ? (
        running.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-gray-600 dark:text-gray-400 truncate">
              {task.name}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              {t("tasks.running")}
            </span>
          </div>
        ))
      ) : (
        <div className="flex flex-col gap-1">
          {tasks
            .filter((t) => t.enabled)
            .slice(0, 5)
            .map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    task.status === "error" ? "bg-red-500" : "bg-yellow-400"
                  }`}
                />
                <span className="text-gray-600 dark:text-gray-400 truncate">
                  {task.name}
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  {task.status === "error"
                    ? t("tasks.statusError")
                    : t("tasks.statusStandby")}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────

export default function RunningTasksCard({ tasks }: RunningTasksCardProps) {
  const { t } = useTranslation();
  const runningCount = tasks.filter(
    (task) => task.enabled && task.status === "running",
  ).length;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("tasks.runningTasks")}
          {runningCount > 0 && (
            <span className="ml-2 text-xs text-blue-500">({runningCount})</span>
          )}
        </h3>
      </div>
      <div className="p-4">
        <RunningTasksList tasks={tasks} />
      </div>
    </div>
  );
}
