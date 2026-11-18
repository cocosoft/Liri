/**
 * 单个定时任务行（CronPage 拆分批 1，2026-11-18）
 *
 * 含折叠面板（表达式 / 下次执行 / 上次执行）；行内动作全部经 props 回调。
 */
import { useTranslation } from "react-i18next";
import type { CronTask } from "../../../types";
import { currentLocale } from "../../../utils/format";

interface Props {
  task: CronTask;
  selected: boolean;
  expanded: boolean;
  saving: boolean;
  onToggleSelect: () => void;
  onRunNow: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  running:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  idle: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
};

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(currentLocale());
}

export default function CronTaskRow({
  task,
  selected,
  expanded,
  saving,
  onToggleSelect,
  onRunNow,
  onToggleEnabled,
  onDelete,
  onToggleExpand,
}: Props) {
  const { t } = useTranslation();
  const statusText: Record<string, string> = {
    running: t("cron.running"),
    error: t("cron.error"),
    idle: t("cron.idle"),
  };

  return (
    <li
      className={`group px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
        selected ? "ring-2 ring-blue-500" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[task.status] || ""}`}
              >
                {statusText[task.status] || task.status}
              </span>
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  task.enabled
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                }`}
              >
                {task.enabled
                  ? `✓ ${t("cron.enabledLabel", "Enabled")}`
                  : `✗ ${t("cron.disabledLabel", "Disabled")}`}
              </span>
              {task.silent && (
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                  {t("cron.silent", "Silent")}
                </span>
              )}
              {task.scheduleDisplay && (
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                  {task.scheduleDisplay}
                </span>
              )}
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {task.name}
              </h3>
            </div>
            {task.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                {task.description}
              </p>
            )}
            {task.expression && (
              <div className="mt-2">
                <code className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded font-mono text-gray-600 dark:text-gray-300">
                  {task.expression}
                </code>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRunNow();
              }}
              disabled={saving}
              className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded disabled:opacity-40"
              title={t("cron.forceRun", "Force Run")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleEnabled();
              }}
              className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
              title={
                task.enabled
                  ? t("cron.disable", "Disable")
                  : t("cron.enable", "Enable")
              }
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                {task.enabled ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                )}
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0"
                />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (
                  confirm(t("cron.deleteConfirm", "Delete this cron task?"))
                ) {
                  onDelete();
                }
              }}
              className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
              title={t("cron.deleteTask", "Delete")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRunNow();
              }}
              disabled={saving}
              className="text-xs px-2 py-1 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/30 disabled:opacity-40"
            >
              {t("cron.forceRun", "强制执行")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleEnabled();
              }}
              className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
            >
              {task.enabled ? t("cron.disable") : t("cron.enable")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t("cron.deleteConfirm"))) {
                  onDelete();
                }
              }}
              className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t("cron.deleteTask")}
            </button>
          </div>

          {task.expression && (
            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("cron.expression", "Cron Expression")}
              </span>
              <code className="block mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre font-mono bg-white dark:bg-gray-800 p-2 rounded">
                {task.expression}
              </code>
            </div>
          )}

          {task.nextRun && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <span className="text-xs font-medium text-blue-500 dark:text-blue-400">
                {t("cron.nextRunTime", "Next Run")}
              </span>
              <p className="mt-1 text-sm text-blue-600 dark:text-blue-300">
                {formatTimestamp(task.nextRun)}
              </p>
            </div>
          )}

          {task.lastRun && (
            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("cron.lastRunTime", "Last Run")}
              </span>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                {formatTimestamp(task.lastRun)}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
