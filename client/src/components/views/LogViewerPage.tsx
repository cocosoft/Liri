import { useEffect, useState, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import { monitorService } from "../../services/monitorService";
import SearchInput from "../common/SearchInput";
import LogViewer from "../common/LogViewer";
import type { LogEntry } from "../../types";

function LogViewerPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchLogs = useCallback(
    async (resetOffset = false) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = {
          level:
            levelFilter !== "all"
              ? (levelFilter as LogEntry["level"])
              : undefined,
          search: searchQuery || undefined,
          limit,
          offset: resetOffset ? 0 : offset,
        };

        const result = await monitorService.getLogs(params);

        if (resetOffset) {
          setLogs(result.logs);
          setOffset(limit);
        } else {
          setLogs((prev) => [...prev, ...result.logs]);
          setOffset((prev) => prev + limit);
        }
        setTotal(result.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取日志失败");
      } finally {
        setIsLoading(false);
      }
    },
    [levelFilter, searchQuery, offset],
  );

  useEffect(() => {
    fetchLogs(true);
  }, [levelFilter, searchQuery]);

  const handleSearch = () => {
    fetchLogs(true);
  };

  const handleLoadMore = () => {
    fetchLogs(false);
  };

  return (
    <div
      className={`flex-1 overflow-hidden flex flex-col ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-7xl mx-auto w-full p-6">
        <div className="mb-6">
          <h1
            className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            日志浏览器
          </h1>
          <p
            className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            浏览系统日志记录，共 {total} 条
          </p>
        </div>

        <div
          className={`rounded-lg border p-4 mb-6 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder="搜索日志内容..."
                isDark={isDark}
              />
            </div>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className={`px-3 py-2 text-sm rounded-lg border ${
                isDark
                  ? "bg-gray-700 border-gray-600 text-gray-300"
                  : "bg-white border-gray-300 text-gray-700"
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value="all">全部级别</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
            <button
              onClick={() => fetchLogs(true)}
              disabled={isLoading}
              className={`px-4 py-2 text-sm rounded-lg font-medium ${
                isDark
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              } disabled:opacity-50`}
            >
              {isLoading ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>

        {error && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
          >
            {error}
          </div>
        )}

        <LogViewer
          logs={logs}
          isDark={isDark}
          onLoadMore={handleLoadMore}
          hasMore={logs.length < total}
        />
      </div>
    </div>
  );
}

export default LogViewerPage;
