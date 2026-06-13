import { useEffect, useState, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import { monitorService } from "../../services/monitorService";
import { costService, type CostSummary } from "../../services/costService";
import type { LogEntry, LogSource } from "../../types";
import type { SessionSummary, SessionDetail } from "../../services/monitorService";
import SearchInput from "../common/SearchInput";
import LogViewer from "../common/LogViewer";

type TabType = "logs" | "sessions" | "cost";

function LogViewerPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [activeTab, setActiveTab] = useState<TabType>("logs");

  // 日志相关状态
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<LogSource>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // 会话相关状态
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);

  // 成本相关状态
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [isLoadingCost, setIsLoadingCost] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);

  const fetchLogs = useCallback(
    async (resetOffset = false) => {
      setIsLoadingLogs(true);
      setLogsError(null);

      try {
        const params = {
          level:
            levelFilter !== "all"
              ? (levelFilter as LogEntry["level"])
              : undefined,
          source: sourceFilter !== "all" ? sourceFilter : undefined,
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
        setLogsTotal(result.total);
      } catch (e) {
        setLogsError(e instanceof Error ? e.message : "获取日志失败");
      } finally {
        setIsLoadingLogs(false);
      }
    },
    [levelFilter, sourceFilter, searchQuery, offset],
  );

  const fetchSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setSessionsError(null);

    try {
      const result = await monitorService.getSessions({ limit: 50, offset: 0 });
      setSessions(result.sessions);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "获取会话列表失败");
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const fetchCostSummary = useCallback(async () => {
    setIsLoadingCost(true);
    setCostError(null);

    try {
      const result = await costService.getCostSummary();
      setCostSummary(result);
    } catch (e) {
      setCostError(e instanceof Error ? e.message : "获取成本统计失败");
    } finally {
      setIsLoadingCost(false);
    }
  }, []);

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const result = await monitorService.getSessionDetail(sessionId);
      setSelectedSession(result);
    } catch (e) {
      console.error("获取会话详情失败", e);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs(true);
    } else if (activeTab === "sessions") {
      fetchSessions();
    } else if (activeTab === "cost") {
      fetchCostSummary();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs(true);
    }
  }, [levelFilter, sourceFilter, searchQuery]);

  const handleSearch = () => {
    fetchLogs(true);
  };

  const handleLoadMoreLogs = () => {
    fetchLogs(false);
  };

  const handleViewSessionDetail = (sessionId: string) => {
    fetchSessionDetail(sessionId);
  };

  const handleCloseSessionDetail = () => {
    setSelectedSession(null);
  };

  const handleExportLogs = async (format: 'json' | 'csv') => {
    try {
      const blob = await monitorService.exportLogs({
        format,
        level: levelFilter !== 'all' ? levelFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        search: searchQuery || undefined,
      });

      const filename = `logs-${Date.now()}.${format}`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('导出日志失败', e);
    }
  };

  const formatCost = (cost: number): string => {
    return cost.toFixed(4);
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return (tokens / 1000).toFixed(1) + "K";
    }
    return tokens.toString();
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const tabs = [
    { key: "logs" as TabType, label: "系统日志" },
    { key: "sessions" as TabType, label: "LLM 会话" },
    { key: "cost" as TabType, label: "成本统计" },
  ];

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
            浏览系统日志、LLM 会话记录和成本统计
          </p>
        </div>

        {/* 标签页切换 */}
        <div className="flex gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? isDark
                    ? "bg-blue-600 text-white"
                    : "bg-blue-600 text-white"
                  : isDark
                  ? "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 系统日志标签 */}
        {activeTab === "logs" && (
          <>
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
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value as LogSource)}
                  className={`px-3 py-2 text-sm rounded-lg border ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-gray-300"
                      : "bg-white border-gray-300 text-gray-700"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="all">全部来源</option>
                  <option value="logger">普通日志</option>
                  <option value="structured">结构化日志</option>
                  <option value="otel">OTel 日志</option>
                  <option value="llm">LLM 跟踪</option>
                </select>
                <button
                  onClick={() => fetchLogs(true)}
                  disabled={isLoadingLogs}
                  className={`px-4 py-2 text-sm rounded-lg font-medium ${
                    isDark
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  } disabled:opacity-50`}
                >
                  {isLoadingLogs ? "刷新中..." : "刷新"}
                </button>
                <button
                  onClick={() => handleExportLogs('json')}
                  disabled={isLoadingLogs}
                  className={`px-4 py-2 text-sm rounded-lg font-medium ${
                    isDark
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "bg-green-600 hover:bg-green-700 text-white"
                  } disabled:opacity-50`}
                >
                  导出 JSON
                </button>
                <button
                  onClick={() => handleExportLogs('csv')}
                  disabled={isLoadingLogs}
                  className={`px-4 py-2 text-sm rounded-lg font-medium ${
                    isDark
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "bg-green-600 hover:bg-green-700 text-white"
                  } disabled:opacity-50`}
                >
                  导出 CSV
                </button>
              </div>
            </div>

            {logsError && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
              >
                {logsError}
              </div>
            )}

            <LogViewer
              logs={logs}
              isDark={isDark}
              onLoadMore={handleLoadMoreLogs}
              hasMore={logs.length < logsTotal}
            />
          </>
        )}

        {/* LLM 会话标签 */}
        {activeTab === "sessions" && (
          <>
            {sessionsError && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
              >
                {sessionsError}
              </div>
            )}

            {isLoadingSessions ? (
              <div className="flex justify-center items-center py-12">
                <div className={`w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin ${isDark ? "" : ""}`}></div>
              </div>
            ) : sessions.length === 0 ? (
              <div className={`text-center py-12 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                <p>暂无 LLM 会话记录</p>
              </div>
            ) : (
              <div className={`space-y-3 ${isDark ? "bg-gray-900" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} overflow-hidden`}>
                {sessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className={`p-4 hover:bg-gray-100 cursor-pointer transition-colors ${isDark ? "hover:bg-gray-800" : ""} border-b ${isDark ? "border-gray-800" : "border-gray-100"} last:border-b-0`}
                    onClick={() => handleViewSessionDetail(session.sessionId)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}>
                          {session.title || `会话 ${session.sessionId.substring(0, 8)}`}
                        </h3>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className={`px-2 py-0.5 text-xs rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                            {session.models.join(", ")}
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                            {session.totalRequests} 次调用
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                            {formatTokens(session.totalTokens)} tokens
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded ${isDark ? "bg-green-900/50 text-green-400" : "bg-green-50 text-green-600"}`}>
                            ${formatCost(session.totalCostUsd)}
                          </span>
                        </div>
                      </div>
                      <div className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {formatDate(session.lastCallAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 成本统计标签 */}
        {activeTab === "cost" && (
          <>
            {costError && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
              >
                {costError}
              </div>
            )}

            {isLoadingCost ? (
              <div className="flex justify-center items-center py-12">
                <div className={`w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin ${isDark ? "" : ""}`}></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={`p-6 rounded-lg ${isDark ? "bg-gray-800" : "bg-white"} border ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                  <div className={`text-sm mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>总会话数</div>
                  <div className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}>
                    {costSummary?.totalSessions || 0}
                  </div>
                </div>
                <div className={`p-6 rounded-lg ${isDark ? "bg-gray-800" : "bg-white"} border ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                  <div className={`text-sm mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>总请求数</div>
                  <div className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}>
                    {costSummary?.totalRequests || 0}
                  </div>
                </div>
                <div className={`p-6 rounded-lg ${isDark ? "bg-gray-800" : "bg-white"} border ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                  <div className={`text-sm mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>总输入 Token</div>
                  <div className={`text-2xl font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                    {formatTokens(costSummary?.totalInputTokens || 0)}
                  </div>
                </div>
                <div className={`p-6 rounded-lg ${isDark ? "bg-gray-800" : "bg-white"} border ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                  <div className={`text-sm mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>总输出 Token</div>
                  <div className={`text-2xl font-bold ${isDark ? "text-green-400" : "text-green-600"}`}>
                    {formatTokens(costSummary?.totalOutputTokens || 0)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 会话详情弹窗 */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-4xl max-h-[80vh] overflow-hidden rounded-lg ${isDark ? "bg-gray-800" : "bg-white"}`}>
            <div className={`p-4 border-b flex items-center justify-between ${isDark ? "border-gray-700" : "border-gray-200"}`}>
              <h2 className={`text-lg font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}>
                {selectedSession.title || `会话 ${selectedSession.sessionId.substring(0, 8)}`}
              </h2>
              <button
                onClick={handleCloseSessionDetail}
                className={`p-2 rounded-lg hover:bg-gray-100 ${isDark ? "hover:bg-gray-700" : ""}`}
              >
                <span className={`text-lg ${isDark ? "text-gray-400" : "text-gray-500"}`}>×</span>
              </button>
            </div>

            <div className={`p-4 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>总调用次数</div>
                  <div className={`text-lg font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                    {selectedSession.totalRequests}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>输入 Token</div>
                  <div className={`text-lg font-medium ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                    {formatTokens(selectedSession.totalInputTokens)}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>输出 Token</div>
                  <div className={`text-lg font-medium ${isDark ? "text-green-400" : "text-green-600"}`}>
                    {formatTokens(selectedSession.totalOutputTokens)}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>总成本</div>
                  <div className={`text-lg font-medium ${isDark ? "text-yellow-400" : "text-yellow-600"}`}>
                    ${formatCost(selectedSession.totalCostUsd)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <span className={`px-2 py-1 text-xs rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                  模型: {selectedSession.models.join(", ")}
                </span>
                <span className={`px-2 py-1 text-xs rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                  提供商: {selectedSession.providers.join(", ")}
                </span>
              </div>
            </div>

            <div className="overflow-y-auto max-h-[50vh] p-4">
              <h3 className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                LLM 调用记录 ({selectedSession.calls.length})
              </h3>
              <div className="space-y-3">
                {selectedSession.calls.map((call, index) => (
                  <div
                    key={call.requestId}
                    className={`p-3 rounded-lg ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                            #{index + 1}
                          </span>
                          <span className={`text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                            {call.model}
                          </span>
                          <span className={`px-1.5 py-0.5 text-xs rounded ${isDark ? "bg-gray-600 text-gray-300" : "bg-gray-200 text-gray-600"}`}>
                            {call.provider}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs">
                          <span className={isDark ? "text-gray-400" : "text-gray-500"}>
                            输入: <span className={isDark ? "text-blue-400" : "text-blue-600"}>{call.inputTokens}</span>
                          </span>
                          <span className={isDark ? "text-gray-400" : "text-gray-500"}>
                            输出: <span className={isDark ? "text-green-400" : "text-green-600"}>{call.outputTokens}</span>
                          </span>
                          {call.cacheReadTokens > 0 && (
                            <span className={isDark ? "text-gray-400" : "text-gray-500"}>
                              缓存读取: <span className={isDark ? "text-cyan-400" : "text-cyan-600"}>{call.cacheReadTokens}</span>
                            </span>
                          )}
                          {call.cacheCreateTokens > 0 && (
                            <span className={isDark ? "text-gray-400" : "text-gray-500"}>
                              缓存创建: <span className={isDark ? "text-purple-400" : "text-purple-600"}>{call.cacheCreateTokens}</span>
                            </span>
                          )}
                          <span className={isDark ? "text-gray-400" : "text-gray-500"}>
                            耗时: <span className={isDark ? "text-orange-400" : "text-orange-600"}>{call.durationMs}ms</span>
                          </span>
                          <span className={isDark ? "text-gray-400" : "text-gray-500"}>
                            成本: <span className={isDark ? "text-yellow-400" : "text-yellow-600"}>${formatCost(call.costUsd)}</span>
                          </span>
                        </div>
                      </div>
                      <span className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                        {formatDate(call.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LogViewerPage;
