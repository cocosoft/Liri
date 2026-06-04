import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import type { CronTask } from "../../types";

interface ExecutionRecord {
  id: string;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime?: string;
  duration: number;
  status: "success" | "failed" | "running";
  output: string;
  error?: string;
}

interface CronExecutionHistoryProps {
  tasks: CronTask[];
}

function CronExecutionHistory({ tasks }: CronExecutionHistoryProps) {
  const { t, i18n } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const locale = i18n.language === "zh" ? "zh-CN" : "en-US";

  // Derive execution records from cron tasks with lastRun data
  const records: ExecutionRecord[] = tasks
    .filter((task) => task.lastRun)
    .map((task) => ({
      id: `${task.id}-${task.lastRun}`,
      taskId: task.id,
      taskName: task.name,
      startTime: new Date(task.lastRun!).toLocaleString(locale),
      endTime: task.lastDurationMs
        ? new Date(task.lastRun! + task.lastDurationMs).toLocaleString(locale)
        : undefined,
      duration: Math.round((task.lastDurationMs ?? 0) / 1000),
      status: (
        task.lastStatus === "ok"
          ? "success"
          : task.lastStatus === "error"
            ? "failed"
            : task.status === "running"
              ? "running"
              : "success"
      ) as "success" | "failed" | "running",
      output: task.lastStatus === "ok" ? t("cron.historyCompleted", "Completed") : "",
      error: task.lastError,
    }))
    .sort((a, b) => {
      const ta = a.startTime;
      const tb = b.startTime;
      return tb.localeCompare(ta);
    });

  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const filteredRecords =
    filter === "all" ? records : records.filter((r) => r.status === filter);

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "success":
        return isDark
          ? "bg-green-900/30 text-green-400"
          : "bg-green-100 text-green-700";
      case "failed":
        return isDark
          ? "bg-red-900/30 text-red-400"
          : "bg-red-100 text-red-700";
      case "running":
        return isDark
          ? "bg-blue-900/30 text-blue-400"
          : "bg-blue-100 text-blue-700";
      default:
        return isDark
          ? "bg-gray-700 text-gray-400"
          : "bg-gray-100 text-gray-600";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "success":
        return t("cron.statusSuccess", "Success");
      case "failed":
        return t("cron.statusFailed", "Failed");
      case "running":
        return t("cron.statusRunning", "Running");
      default:
        return status;
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return "—";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  if (records.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center">
        <svg
          className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-gray-400 dark:text-gray-500 text-sm mb-1">
          {t("cron.noHistoryTitle", "No execution history")}
        </p>
        <p className="text-gray-400 dark:text-gray-500 text-xs">
          {t("cron.noHistoryDesc", "Records will appear here after tasks run")}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("cron.tabHistory", "Execution History")}
          <span className="ml-1 text-xs text-gray-400">({records.length})</span>
        </h3>
        <div className="flex gap-2">
          {(["all", "success", "failed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : isDark
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "all"
                ? t("cron.all", "All")
                : f === "success"
                  ? t("cron.statusSuccess", "Success")
                  : t("cron.statusFailed", "Failed")}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filteredRecords.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">
            {t("cron.noFilterMatch", "No matching records")}
          </p>
        ) : (
          filteredRecords.map((record) => (
            <div
              key={record.id}
              className={`rounded-lg border ${isDark ? "border-gray-700 bg-gray-700/30" : "border-gray-200 bg-gray-50"}`}
            >
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${getStatusStyle(record.status)}`}
                    >
                      {getStatusText(record.status)}
                    </span>
                    <span
                      className={`text-sm font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      {record.taskName}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                      {record.startTime}
                    </span>
                    <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                      {formatDuration(record.duration)}
                    </span>
                  </div>
                </div>
                {record.error && (
                  <div className="mt-2">
                    <pre
                      className={`text-xs p-2 rounded ${isDark ? "bg-red-900/20 text-red-300" : "bg-red-50 text-red-700"}`}
                    >
                      {record.error}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default CronExecutionHistory;
