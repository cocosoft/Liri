import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LogEntry } from "../../types";

interface LogViewerProps {
  logs: LogEntry[];
  isDark?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

interface LogDetailModalProps {
  log: LogEntry;
  isDark: boolean;
  onClose: () => void;
}

function LogDetailModal({ log, isDark, onClose }: LogDetailModalProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col ${isDark ? "border border-gray-700" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`p-4 border-b flex items-center justify-between ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <h3
            className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {t("settings.logViewerDetailTitle")}
          </h3>
          <button
            onClick={onClose}
            className={`p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            ×
          </button>
        </div>
        <div
          className={`p-4 overflow-auto flex-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          <div className="space-y-4">
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("settings.logViewerFieldLevel")}
              </label>
              <span
                className={`px-2 py-1 rounded text-sm ${
                  log.level === "error"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
                    : log.level === "warn"
                      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400"
                      : log.level === "info"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                }`}
              >
                {log.level.toUpperCase()}
              </span>
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("settings.logViewerFieldTime")}
              </label>
              <p className="text-sm">{formatTime(log.timestamp)}</p>
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("settings.logViewerFieldSource")}
              </label>
              <p className="text-sm">{log.source || "-"}</p>
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("settings.logViewerFieldModule")}
              </label>
              <p className="text-sm">{log.module || "-"}</p>
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("settings.logViewerFieldMessage")}
              </label>
              <p className="text-sm whitespace-pre-wrap">{log.message}</p>
            </div>
            {log.details && (
              <div>
                <label
                  className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("settings.logViewerFieldDetails")}
                </label>
                <pre
                  className={`p-3 rounded text-sm overflow-auto max-h-64 ${isDark ? "bg-gray-900 text-gray-300" : "bg-gray-100 text-gray-700"}`}
                >
                  {log.details}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const LEVEL_STYLES = {
  debug: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-500 dark:text-gray-400",
    label: "DEBUG",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-600 dark:text-blue-400",
    label: "INFO",
  },
  warn: {
    bg: "bg-yellow-50 dark:bg-yellow-900/20",
    text: "text-yellow-600 dark:text-yellow-400",
    label: "WARN",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-600 dark:text-red-400",
    label: "ERROR",
  },
};

function LogViewer({
  logs,
  isDark = false,
  onLoadMore,
  hasMore = false,
}: LogViewerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <>
      <div
        className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <div
          className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-100"}`}
        >
          {logs.length === 0 ? (
            <div
              className={`p-8 text-center ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              {t("settings.logViewerNoLogs")}
            </div>
          ) : (
            logs.map((log) => {
              const style = LEVEL_STYLES[log.level];
              return (
                <div
                  key={log.id}
                  className={`p-3 flex items-start gap-3 hover:${isDark ? "bg-gray-700" : "bg-gray-50"} cursor-pointer transition-colors`}
                  onClick={() => setSelectedLog(log)}
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${style.bg} ${style.text}`}
                  >
                    {style.label}
                  </span>
                  <span
                    className={`text-xs font-mono ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {formatTime(log.timestamp)}
                  </span>
                  {log.source && (
                    <span
                      className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                    >
                      [{log.source}]
                    </span>
                  )}
                  <span
                    className={`flex-1 text-sm ${isDark ? "text-gray-300" : "text-gray-700"} truncate`}
                  >
                    {log.message}
                  </span>
                  <span
                    className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {t("settings.logViewerViewDetail")}
                  </span>
                </div>
              );
            })
          )}
        </div>
        {hasMore && onLoadMore && (
          <div
            className={`p-3 border-t ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <button
              onClick={onLoadMore}
              className={`w-full py-2 text-sm rounded-lg border ${isDark ? "border-gray-600 text-gray-400 hover:bg-gray-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
              {t("settings.logViewerLoadMore")}
            </button>
          </div>
        )}
      </div>
      {selectedLog && (
        <LogDetailModal
          log={selectedLog}
          isDark={isDark}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </>
  );
}

export default LogViewer;
