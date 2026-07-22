import { useTranslation } from "react-i18next";

interface RunLogEntry {
  id: string;
  jobId: string;
  ts: number;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs: number;
  durationMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  deliveryStatus?: string;
  deliveryError?: string;
}

interface RunLogDetailModalProps {
  entry: RunLogEntry | null;
  taskName?: string;
  onClose: () => void;
}

function RunLogDetailModal({
  entry,
  taskName,
  onClose,
}: RunLogDetailModalProps) {
  const { t } = useTranslation();

  if (!entry) return null;

  const formatTs = (ms: number) => new Date(ms).toLocaleString();

  const formatDuration = (ms?: number) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  };

  const getStatusStyle = (status?: string) => {
    if (status === "ok")
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    if (status === "failed")
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    return "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            {t("cron.runDetailTitle", "Execution Detail")}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 任务名称 */}
          {taskName && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t("cron.taskName", "Task Name")}
              </label>
              <p className="text-sm text-gray-900 dark:text-gray-100">
                {taskName}
              </p>
            </div>
          )}

          {/* 运行状态 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              {t("cron.statusLabel", "Status")}
            </label>
            <span
              className={`inline-block px-2 py-0.5 text-xs rounded-full ${getStatusStyle(entry.status)}`}
            >
              {entry.status === "ok"
                ? t("cron.statusSuccess", "Success")
                : entry.status === "failed"
                  ? t("cron.statusFailed", "Failed")
                  : entry.status || "—"}
            </span>
          </div>

          {/* 时间与耗时 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t("cron.runAt", "Run At")}
              </label>
              <p className="text-sm text-gray-900 dark:text-gray-100">
                {formatTs(entry.runAtMs)}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t("cron.durationLabel", "Duration")}
              </label>
              <p className="text-sm text-gray-900 dark:text-gray-100">
                {formatDuration(entry.durationMs)}
              </p>
            </div>
          </div>

          {/* 模型/Provider */}
          {entry.model && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t("cron.model", "Model")}
                </label>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {entry.model}
                </p>
              </div>
              {entry.provider && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Provider
                  </label>
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    {entry.provider}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Token */}
          {(entry.inputTokens !== undefined ||
            entry.outputTokens !== undefined) && (
            <div className="grid grid-cols-2 gap-4">
              {entry.inputTokens !== undefined && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    {t("cron.inputTokens", "Input Tokens")}
                  </label>
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    {entry.inputTokens.toLocaleString()}
                  </p>
                </div>
              )}
              {entry.outputTokens !== undefined && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    {t("cron.outputTokens", "Output Tokens")}
                  </label>
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    {entry.outputTokens.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 投递状态 */}
          {entry.deliveryStatus && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t("cron.deliveryStatus", "Delivery")}
              </label>
              <p className="text-sm text-gray-900 dark:text-gray-100">
                {entry.deliveryStatus}
                {entry.deliveryError && (
                  <span className="text-red-500 ml-2">
                    ({entry.deliveryError})
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Session */}
          {entry.sessionId && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Session ID
              </label>
              <code className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono break-all block">
                {entry.sessionId}
              </code>
            </div>
          )}

          {/* 摘要 */}
          {entry.summary && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t("cron.summaryLabel", "Summary")}
              </label>
              <p className="text-sm text-gray-900 dark:text-gray-100">
                {entry.summary}
              </p>
            </div>
          )}

          {/* 错误 */}
          {entry.error && (
            <div>
              <label className="block text-xs font-medium text-red-500 dark:text-red-400 mb-1">
                {t("cron.error", "Error")}
              </label>
              <pre className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 max-h-40 overflow-y-auto">
                {entry.error}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RunLogDetailModal;
