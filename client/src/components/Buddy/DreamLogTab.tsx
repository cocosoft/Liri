import { useEffect, useState } from "react";
import { dreamService } from "../../services/backgroundTaskService";
import { memoryService } from "../../services/memoryService";
import type { DreamLogEntry, DreamLogResponse } from "../../types";
import DreamCycleDetail from "./DreamCycleDetail";

const DREAM_TYPE_LABELS: Record<string, string> = {
  "dream:started": "开始",
  "dream:completed": "完成",
  "dream:failed": "失败",
};

const DREAM_TYPE_COLORS: Record<string, string> = {
  "dream:started": "text-blue-500",
  "dream:completed": "text-green-500",
  "dream:failed": "text-red-500",
};

const DREAM_TYPE_BG: Record<string, string> = {
  "dream:started":
    "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
  "dream:completed":
    "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
  "dream:failed":
    "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
};

interface DreamCycleEntry {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  triggerSource: string;
  status: string;
  sessionsScanned: number;
  sessionsProcessed: number;
  memoriesCreated: number;
  memoriesRefined: number;
  knowledgeFilesUpdated: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;
  insights: string[];
  errors: string[];
}

type TabView = "logs" | "cycles";

function DreamLogTab() {
  const [logData, setLogData] = useState<DreamLogResponse | null>(null);
  const [cycles, setCycles] = useState<DreamCycleEntry[]>([]);
  const [cycleTotal, setCycleTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [tabView, setTabView] = useState<TabView>("cycles");
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
  const [detailCycleId, setDetailCycleId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // 并行加载日志和周期数据
      const [logResult, cycleResult] = await Promise.allSettled([
        dreamService.getDreamLogs(100, 0, filter || undefined),
        memoryService.getDreamCycles({
          pageSize: 50,
          sortOrder: "desc",
          status:
            filter === "dream:started"
              ? undefined
              : filter === "dream:failed"
                ? "failed"
                : filter === "dream:completed"
                  ? undefined
                  : undefined,
        }),
      ]);

      if (logResult.status === "fulfilled") {
        setLogData(logResult.value);
      }
      if (cycleResult.status === "fulfilled") {
        setCycles(cycleResult.value.cycles);
        setCycleTotal(cycleResult.value.total);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (startMs: number, endMs: number) => {
    const sec = Math.round((endMs - startMs) / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    return `${min}m${remainingSec}s`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "dream:started":
        return "🌙";
      case "dream:completed":
        return "✨";
      case "dream:failed":
        return "💤";
      default:
        return "🌙";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "✅";
      case "partial":
        return "⚠️";
      case "failed":
        return "❌";
      default:
        return "🌙";
    }
  };

  const getTriggerLabel = (source: string) => {
    switch (source) {
      case "idle":
        return "空闲触发";
      case "cron":
        return "定时触发";
      case "manual":
        return "手动触发";
      default:
        return source;
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        加载梦境日志...
      </div>
    );
  }

  return (
    <div>
      {/* 视图切换 */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setTabView("cycles")}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            tabView === "cycles"
              ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700"
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          梦境周期 {cycleTotal > 0 && `(${cycleTotal})`}
        </button>
        <button
          onClick={() => setTabView("logs")}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            tabView === "logs"
              ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700"
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          执行日志
        </button>

        {/* 周期统计 */}
        {tabView === "cycles" && (
          <div className="flex items-center gap-3 ml-auto text-xs text-gray-500 dark:text-gray-400">
            <span>
              ✅ {cycles.filter((c) => c.status === "completed").length}
            </span>
            <span>
              ⚠️ {cycles.filter((c) => c.status === "partial").length}
            </span>
            <span>❌ {cycles.filter((c) => c.status === "failed").length}</span>
          </div>
        )}
      </div>

      {/* 旧日志视图 */}
      {tabView === "logs" && (
        <>
          {logData?.stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
                <div className="text-lg">✨</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  完成
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                  {logData.stats.totalCompleted}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
                <div className="text-lg">📚</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  会话
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                  {logData.stats.totalSessions}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
                <div className="text-lg">💡</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  洞察
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                  {logData.stats.totalInsights}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
                <div className="text-lg">💤</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  失败
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                  {logData.stats.totalFailed}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            {["", "dream:completed", "dream:started", "dream:failed"].map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    filter === type
                      ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  {type ? DREAM_TYPE_LABELS[type] : "全部"}
                </button>
              ),
            )}
          </div>

          {!logData?.logs || logData.logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              暂无梦境日志
            </div>
          ) : (
            <div className="space-y-2">
              {logData.logs.map((entry: DreamLogEntry) => (
                <div
                  key={entry.id}
                  className={`p-3 rounded-lg border ${DREAM_TYPE_BG[entry.type] || "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base flex-shrink-0">
                        {getTypeIcon(entry.type)}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={`text-sm font-medium truncate ${
                            entry.type === "dream:failed"
                              ? "text-red-700 dark:text-red-300"
                              : "text-gray-900 dark:text-gray-100"
                          }`}
                        >
                          {entry.summary}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                          <span className={DREAM_TYPE_COLORS[entry.type] || ""}>
                            {DREAM_TYPE_LABELS[entry.type] || entry.type}
                          </span>
                          <span>{entry.sessionsCount} 条会话</span>
                          {entry.insightsGenerated > 0 && (
                            <span>{entry.insightsGenerated} 条洞察</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 梦境周期视图 */}
      {tabView === "cycles" && (
        <>
          {cycles.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              暂无梦境周期记录
            </div>
          ) : (
            <div className="space-y-3">
              {cycles.map((cycle) => (
                <div
                  key={cycle.cycleId}
                  className={`rounded-lg border ${
                    cycle.status === "failed"
                      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                      : cycle.status === "partial"
                        ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                        : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                  }`}
                >
                  {/* 周期头部 */}
                  <div
                    className="p-3 cursor-pointer"
                    onClick={() =>
                      setExpandedCycle(
                        expandedCycle === cycle.cycleId ? null : cycle.cycleId,
                      )
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base flex-shrink-0">
                          {getStatusIcon(cycle.status)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            🌙 {cycle.cycleId}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                            <span>{getTriggerLabel(cycle.triggerSource)}</span>
                            <span>
                              {formatDuration(
                                cycle.startedAt,
                                cycle.completedAt,
                              )}
                            </span>
                            <span>
                              {cycle.sessionsProcessed}/{cycle.sessionsScanned}{" "}
                              会话
                            </span>
                            <span>{cycle.memoriesCreated} 新记忆</span>
                            {cycle.memoriesRefined > 0 && (
                              <span>{cycle.memoriesRefined} 精炼</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
                        {formatTime(cycle.completedAt)}
                      </span>
                    </div>
                  </div>

                  {/* 展开详情 */}
                  {expandedCycle === cycle.cycleId && (
                    <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700">
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            扫描会话
                          </div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {cycle.sessionsScanned}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            处理会话
                          </div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {cycle.sessionsProcessed}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            创建记忆
                          </div>
                          <div className="font-medium text-green-600 dark:text-green-400">
                            {cycle.memoriesCreated}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            精炼记忆
                          </div>
                          <div className="font-medium text-purple-600 dark:text-purple-400">
                            {cycle.memoriesRefined}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            知识文件
                          </div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {cycle.knowledgeFilesUpdated}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            SOUL 纠偏
                          </div>
                          <div
                            className={`font-medium ${cycle.soulUpdated ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}
                          >
                            {cycle.soulUpdated ? "已更新" : "未变更"}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            USER 更新
                          </div>
                          <div
                            className={`font-medium ${cycle.userProfileUpdated ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}
                          >
                            {cycle.userProfileUpdated ? "已更新" : "未变更"}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50">
                          <div className="text-gray-400 dark:text-gray-500">
                            耗时
                          </div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {formatDuration(cycle.startedAt, cycle.completedAt)}
                          </div>
                        </div>
                      </div>

                      {/* 洞察列表 */}
                      {cycle.insights.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                            💡 洞察
                          </div>
                          <ul className="space-y-1">
                            {cycle.insights.map((insight, i) => (
                              <li
                                key={i}
                                className="text-xs text-gray-600 dark:text-gray-400 pl-4 relative before:content-['•'] before:absolute before:left-1"
                              >
                                {insight}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* 错误列表 */}
                      {cycle.errors.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-medium text-red-500 dark:text-red-400 mb-1">
                            ⚠️ 错误
                          </div>
                          <ul className="space-y-1">
                            {cycle.errors.map((err, i) => (
                              <li
                                key={i}
                                className="text-xs text-red-600 dark:text-red-400 pl-4 relative before:content-['•'] before:absolute before:left-1"
                              >
                                {err}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailCycleId(cycle.cycleId);
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                        >
                          查看完整详情
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 梦境周期详情弹窗 */}
      {detailCycleId && (
        <DreamCycleDetail
          cycleId={detailCycleId}
          isDark={document.documentElement.classList.contains("dark")}
          onClose={() => setDetailCycleId(null)}
        />
      )}
    </div>
  );
}

export default DreamLogTab;
