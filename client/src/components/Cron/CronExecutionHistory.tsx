import { useState, useEffect } from "react";
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
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";

  // Derive execution records from cron tasks with lastRun data
  const records: ExecutionRecord[] = tasks
    .filter((t) => t.lastRun)
    .map((t) => ({
      id: `${t.id}-${t.lastRun}`,
      taskId: t.id,
      taskName: t.name,
      startTime: new Date(t.lastRun!).toLocaleString("zh-CN"),
      endTime: t.lastDurationMs
        ? new Date(t.lastRun! + t.lastDurationMs).toLocaleString("zh-CN")
        : undefined,
      duration: Math.round((t.lastDurationMs ?? 0) / 1000),
      status: (
        t.lastStatus === "ok"
          ? "success"
          : t.lastStatus === "error"
            ? "failed"
            : t.status === "running"
              ? "running"
              : "success"
      ) as "success" | "failed" | "running",
      output: t.lastStatus === "ok" ? "完成" : "",
      error: t.lastError,
    }))
    .sort((a, b) => {
      const ta = a.startTime;
      const tb = b.startTime;
      return tb.localeCompare(ta);
    });

  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        return "成功";
      case "failed":
        return "失败";
      case "running":
        return "运行中";
      default:
        return status;
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return "—";
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">
          执行历史
          {records.length > 0 && (
            <span className="ml-1 text-xs text-gray-400">({records.length})</span>
          )}
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
              {f === "all" ? "全部" : f === "success" ? "成功" : "失败"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filteredRecords.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">暂无执行记录</p>
        ) : (
          filteredRecords.map((record) => (
            <div
              key={record.id}
              className={`rounded-lg border ${isDark ? "border-gray-700 bg-gray-700/30" : "border-gray-200 bg-gray-50"}`}
            >
              <button
                onClick={() =>
                  setExpandedId(expandedId === record.id ? null : record.id)
                }
                className="w-full p-3 text-left"
              >
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
                    <span
                      className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {record.startTime}
                    </span>
                    <span
                      className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {formatDuration(record.duration)}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === record.id ? "rotate-180" : ""}`}
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
                  </div>
                </div>
              </button>

              {expandedId === record.id && (
                <div
                  className={`px-3 pb-3 border-t ${isDark ? "border-gray-700" : "border-gray-200"} pt-3`}
                >
                  {record.output && (
                    <div className="mb-2">
                      <span
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        输出:
                      </span>
                      <pre
                        className={`mt-1 text-xs p-2 rounded ${isDark ? "bg-gray-800 text-gray-300" : "bg-white text-gray-700"}`}
                      >
                        {record.output}
                      </pre>
                    </div>
                  )}
                  {record.error && (
                    <div>
                      <span
                        className={`text-xs ${isDark ? "text-red-400" : "text-red-600"}`}
                      >
                        错误:
                      </span>
                      <pre
                        className={`mt-1 text-xs p-2 rounded ${isDark ? "bg-red-900/20 text-red-300" : "bg-red-50 text-red-700"}`}
                      >
                        {record.error}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default CronExecutionHistory;
