import { useEffect, useState, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import { statsService, type DashboardStats } from "../../services/statsService";
import {
  monitorService,
  type MetricsData,
  type AnalyticsDashboardData,
  type MonitorSummary,
} from "../../services/monitorService";
import { usageService, type CostSummary } from "../../services/usageService";
import { getTraceStats, type TraceStats } from "../../services/traceService";
import {
  infrastructureHealthService,
  type InfrastructureStatus,
} from "../../services/infrastructureHealthService";
import { SystemHealthStatus } from "../common/SystemHealthStatus";
import { ClientErrorStats } from "../common/ClientErrorStats";
import { OTELSpanViewer } from "../common/OTELSpanViewer";
import { OTELTraceViewer } from "../common/OTELTraceViewer";
import type { Alert, SystemHealth } from "../../types";
import { SkeletonCard } from "../common/Skeleton";
import { SPECIES_MAP } from "../Buddy/buddySprites";
import { sseService } from "../../services/sseService";

const ENABLE_TRACE_REDESIGN = true;
import { useConfigStore } from "../../stores/configStore";
import MetricsChart from "../common/MetricsChart";
import {
  formatCost,
  formatTokens,
  getCurrencyFromTimezone,
} from "../../utils/format";
import { DashboardStatCard } from "../common/DashboardStatCard";

const BuddyCard = memo(function BuddyCard({
  buddy,
}: {
  buddy: NonNullable<DashboardStats["buddy"]>;
}) {
  const speciesInfo = SPECIES_MAP[buddy.species as keyof typeof SPECIES_MAP];
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
        伙伴
      </h4>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl">{speciesInfo?.emoji || "🦆"}</span>
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {buddy.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {buddy.species} · {buddy.rarity}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
          <span className="block text-gray-400">等级</span>
          <span className="font-bold text-gray-900 dark:text-white">
            {buddy.level}
          </span>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
          <span className="block text-gray-400">经验值</span>
          <span className="font-bold text-gray-900 dark:text-white">
            {buddy.xp}
          </span>
        </div>
      </div>
    </div>
  );
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分钟`;
}

function DashboardPage() {
  const config = useConfigStore((s) => s.config);
  const timezone = (config.timezone as string) || "Asia/Shanghai";
  const currency = getCurrencyFromTimezone(timezone);
  const isDark = config.theme === "dark";
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showMonitor, setShowMonitor] = useState(true);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsDashboardData | null>(
    null,
  );
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [traceStats, setTraceStats] = useState<TraceStats | null>(null);
  const [infrastructure, setInfrastructure] =
    useState<InfrastructureStatus | null>(null);
  const [timeRange, setTimeRange] = useState(3600000);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [showAlerts, setShowAlerts] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statsData = await statsService.getDashboardStats();
      setStats(statsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载仪表盘数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    sseService.connect();
    const handler = () => fetchData();
    sseService.on("heartbeat", handler);
    return () => {
      sseService.off("heartbeat", handler);
    };
  }, [fetchData]);

  useEffect(() => {
    if (!showMonitor) return;
    const fetchMonitorData = async () => {
      const results = await Promise.allSettled([
        monitorService.getMetrics(timeRange),
        monitorService.getAlerts(),
        monitorService.getSystemHealth(),
        monitorService.getAnalyticsDashboard(),
        monitorService.getSummary(),
        infrastructureHealthService.getStatus(),
        usageService.getCostSummary(),
      ]);
      // 逐项解包，单接口失败不影响其他数据显示
      if (results[0].status === "fulfilled") setMetrics(results[0].value);
      if (results[1].status === "fulfilled") setAlerts(results[1].value);
      if (results[2].status === "fulfilled") setSystemHealth(results[2].value);
      if (results[3].status === "fulfilled") setAnalytics(results[3].value);
      if (results[4].status === "fulfilled") setSummary(results[4].value);
      if (results[5].status === "fulfilled")
        setInfrastructure(results[5].value);
      if (results[6].status === "fulfilled") setCostSummary(results[6].value);

      // Trace 真实 API 调用统计（必选项，不依赖配置）
      try {
        const traceData = await getTraceStats();
        if (traceData.data?.stats) {
          setTraceStats(traceData.data.stats);
        }
      } catch {
        // Trace 数据获取失败不阻塞其他数据显示
      }
    };
    fetchMonitorData();
    const interval = setInterval(fetchMonitorData, 10000);
    return () => clearInterval(interval);
  }, [showMonitor, timeRange]);

  const filteredAlerts =
    filterLevel === "all"
      ? alerts.filter((a) => !a.acknowledged)
      : alerts.filter((a) => a.level === filterLevel && !a.acknowledged);

  const handleAcknowledge = async (id: string) => {
    try {
      await monitorService.acknowledgeAlert(id);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
      );
    } catch {
      // 静默失败
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              仪表盘
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              系统概览
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowMonitor((v) => !v)}
              className={`px-3 py-1.5 text-sm border rounded ${
                showMonitor
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
              }`}
            >
              {showMonitor ? "收起监控" : "展开监控"}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
            <button
              onClick={() => navigate("/chat")}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              开始聊天
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {stats && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <span>📈</span> 数据概览
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DashboardStatCard
                  label="模型"
                  value={stats.models}
                  icon="🤖"
                />
                <DashboardStatCard label="工具" value={stats.tools} icon="🔧" />
                <DashboardStatCard
                  label="会话"
                  value={stats.sessions}
                  icon="💬"
                />
                <DashboardStatCard
                  label="知识条目"
                  value={stats.knowledge}
                  icon="📚"
                />
                <DashboardStatCard
                  label="定时任务"
                  value={stats.cronTasks}
                  icon="⏰"
                />
                <DashboardStatCard
                  label="消息渠道"
                  value={stats.channels}
                  icon="📡"
                />
                <DashboardStatCard
                  label="Agent 任务"
                  value={stats.agentTasks}
                  icon="⚙️"
                />
                <DashboardStatCard
                  label="伙伴等级"
                  value={stats.buddy?.level ?? "-"}
                  icon="🌟"
                />
              </div>
            </div>

            {stats.buddy && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <span>🦆</span> 伙伴
                </h3>
                <div className="max-w-sm">
                  <BuddyCard buddy={stats.buddy} />
                </div>
              </div>
            )}

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
                <span>🚀</span> 快捷入口
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => navigate("/chat")}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors"
                >
                  💬 聊天
                </button>
                <button
                  onClick={() => navigate("/knowledge")}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors"
                >
                  📚 知识库
                </button>
                <button
                  onClick={() => navigate("/cost")}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors"
                >
                  💰 成本
                </button>
                <button
                  onClick={() => navigate("/cron")}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors"
                >
                  🎯 任务
                </button>
                <button
                  onClick={() => navigate("/settings")}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors"
                >
                  ⚙️ 设置
                </button>
              </div>
            </div>

            {/* 用量概览（精简 3 卡片） */}
            {costSummary && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  用量概览
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <DashboardStatCard
                    label="今日成本"
                    value={formatCost(costSummary.todayCost, currency)}
                    icon="💵"
                    trendDirection={costSummary.todayCost > 0 ? "up" : "stable"}
                  />
                  <DashboardStatCard
                    label="本月 Token"
                    value={formatTokens(costSummary.monthlyTokens)}
                    icon="🪙"
                    trendDirection={
                      costSummary.monthlyTokens > 0 ? "up" : "stable"
                    }
                  />
                  <DashboardStatCard
                    label="活跃模型"
                    value={String(costSummary.topProviders.length)}
                    icon="🧩"
                    trendDirection="stable"
                  />
                </div>
                <div className="mt-3 text-right">
                  <button
                    onClick={() => navigate("/usage?tab=cost")}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    查看完整用量分析 →
                  </button>
                </div>
              </div>
            )}

            {/* Trace 实时 API 调用统计（真实数据，Trace 必选项） */}
            {traceStats && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <span>📊</span> AI API 调用统计
                  <span className="text-[10px] text-green-500 font-normal ml-1">
                    (Trace 实时)
                  </span>
                </h3>
                <div className="grid grid-cols-4 gap-4">
                  <DashboardStatCard
                    label="API 调用"
                    value={String(traceStats.totalCalls)}
                    icon="📞"
                  />
                  <DashboardStatCard
                    label="输入 Token"
                    value={formatTokens(traceStats.totalInputTokens)}
                    icon="📥"
                  />
                  <DashboardStatCard
                    label="输出 Token"
                    value={formatTokens(traceStats.totalOutputTokens)}
                    icon="📤"
                  />
                  <DashboardStatCard
                    label="平均延迟"
                    value={`${traceStats.latencyP50}ms`}
                    icon="⏱️"
                  />
                </div>
                {traceStats.totalErrors > 0 && (
                  <div className="mt-2 text-xs text-red-500 dark:text-red-400">
                    ⚠️ {traceStats.totalErrors} 次错误 (
                    {(
                      (traceStats.totalErrors /
                        Math.max(traceStats.totalCalls, 1)) *
                      100
                    ).toFixed(1)}
                    %)
                  </div>
                )}
              </div>
            )}

            {showMonitor && (
              <div className="space-y-6">
                {/* 基础设施健康状态（聚合） */}
                {infrastructure && (
                  <SystemHealthStatus status={infrastructure} isDark={isDark} />
                )}

                {/* 前端客户端错误统计 */}
                <ClientErrorStats />

                {/* P3-2.11: OTEL Span 摘要卡片（compact 模式） */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">🔍</span>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      OTEL 追踪摘要
                    </h3>
                  </div>
                  {ENABLE_TRACE_REDESIGN ? (
                    <OTELTraceViewer compact />
                  ) : (
                    <OTELSpanViewer compact />
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                      <span>🖥️</span> 系统资源
                    </h3>
                  </div>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(Number(e.target.value))}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${
                      isDark
                        ? "bg-gray-800 border-gray-600 text-gray-300"
                        : "bg-white border-gray-300 text-gray-700"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    <option value={300000}>最近5分钟</option>
                    <option value={1800000}>最近30分钟</option>
                    <option value={3600000}>最近1小时</option>
                    <option value={86400000}>最近24小时</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricsChart
                    title="CPU 使用率 (%)"
                    data={metrics?.cpu ?? []}
                    valueFormatter={(v) => `${v.toFixed(1)}%`}
                    color="#3B82F6"
                    isDark={isDark}
                    secondaryData={metrics?.appCpu ?? []}
                    secondaryColor="#8B5CF6"
                    secondaryLabel="应用"
                  />
                  <MetricsChart
                    title="内存使用 (MB)"
                    data={metrics?.memory ?? []}
                    valueFormatter={(v) => `${v.toFixed(0)} MB`}
                    color="#10B981"
                    isDark={isDark}
                    secondaryData={metrics?.appMemory ?? []}
                    secondaryColor="#F59E0B"
                    secondaryLabel="应用"
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div
                    className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      磁盘总量
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {summary ? `${summary.diskTotalGB} GB` : "--"}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      磁盘已用
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {summary ? `${summary.diskUsedGB} GB` : "--"}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      磁盘使用率
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {summary ? `${summary.diskUsagePercent}%` : "--"}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      系统负载
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {summary && summary.loadAverage.length > 0
                        ? summary.loadAverage
                            .map((l) => l.toFixed(2))
                            .join(", ")
                        : "--"}
                    </p>
                  </div>
                </div>

                {summary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div
                      className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                    >
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        运行时间
                      </p>
                      <p
                        className="text-lg font-bold text-gray-900 dark:text-white"
                        title={`${summary.uptime}秒`}
                      >
                        {formatUptime(summary.uptime)}
                      </p>
                    </div>
                    <div
                      className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                    >
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        CPU 使用率
                      </p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">
                        {summary.cpuPercent}%
                      </p>
                    </div>
                    <div
                      className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                    >
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        内存使用
                      </p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">
                        {summary.memoryUsedMB} MB / {summary.memoryTotalMB} MB
                      </p>
                    </div>
                    <div
                      className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                    >
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        内存使用率
                      </p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">
                        {summary.memoryPercent}%
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricsChart
                    title="请求量趋势"
                    data={metrics?.requests ?? []}
                    valueFormatter={(v) => `${v.toFixed(0)}`}
                    color="#3B82F6"
                    isDark={isDark}
                  />
                  <MetricsChart
                    title="响应时间 (ms)"
                    data={metrics?.responseTime ?? []}
                    valueFormatter={(v) => `${v.toFixed(0)}ms`}
                    color="#10B981"
                    isDark={isDark}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricsChart
                    title="错误率趋势 (%)"
                    data={metrics?.errorRate ?? []}
                    valueFormatter={(v) => `${v.toFixed(2)}%`}
                    color="#EF4444"
                    isDark={isDark}
                  />
                </div>

                <div
                  className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                >
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h2
                      className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      📊 分析面板
                    </h2>
                  </div>
                  <div className="p-4">
                    {analytics ? (
                      <>
                        {(costSummary?.totalTokens ?? 0) === 0 &&
                          analytics.tools.totalToolCalls === 0 && (
                            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-700 dark:text-yellow-300">
                              ⏳ 分析数据收集中，请等待指标采集完成后刷新
                            </div>
                          )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div
                            className={`p-4 rounded-lg border ${isDark ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"}`}
                          >
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                              <span>🪙</span> Token 用量
                            </h3>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">
                                  总输入 Tokens
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {(
                                    costSummary?.totalInputTokens ?? 0
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">
                                  总输出 Tokens
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {(
                                    costSummary?.totalOutputTokens ?? 0
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-600 pt-2">
                                <span className="text-gray-500 dark:text-gray-400">
                                  合计 Tokens
                                </span>
                                <span className="font-bold text-blue-600 dark:text-blue-400">
                                  {(
                                    costSummary?.totalTokens ?? 0
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">
                                  LLM 请求次数
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {(
                                    costSummary?.totalRequests ?? 0
                                  ).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            className={`p-4 rounded-lg border ${isDark ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"}`}
                          >
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                              <span>🔧</span> 工具调用 Top 10
                            </h3>
                            {analytics.tools.topTools.length > 0 ? (
                              <div className="space-y-1.5">
                                {analytics.tools.topTools.map((tool, idx) => {
                                  const maxCount =
                                    analytics.tools.topTools[0].count;
                                  const barWidth =
                                    maxCount > 0
                                      ? (tool.count / maxCount) * 100
                                      : 0;
                                  return (
                                    <div
                                      key={tool.name}
                                      className="flex items-center gap-2"
                                    >
                                      <span className="text-xs text-gray-400 w-5 text-right">
                                        {idx + 1}
                                      </span>
                                      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">
                                        {tool.name}
                                      </span>
                                      <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-blue-500 rounded-full transition-all"
                                          style={{ width: `${barWidth}%` }}
                                        />
                                      </div>
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-10 text-right">
                                        {tool.count}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                                暂无工具调用数据
                              </p>
                            )}
                            <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                              <span>
                                总调用:{" "}
                                <strong className="text-gray-900 dark:text-white">
                                  {analytics.tools.totalToolCalls}
                                </strong>
                              </span>
                              <span>
                                工具种类:{" "}
                                <strong className="text-gray-900 dark:text-white">
                                  {analytics.tools.uniqueToolsUsed}
                                </strong>
                              </span>
                            </div>
                          </div>

                          <div
                            className={`p-4 rounded-lg border ${isDark ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"}`}
                          >
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                              <span>❌</span> 错误分析
                            </h3>
                            <div className="flex gap-4 mb-3">
                              <div className="flex-1 text-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  总错误
                                </p>
                                <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                  {analytics.errors.totalErrors}
                                </p>
                              </div>
                              <div className="flex-1 text-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  错误率
                                </p>
                                <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                                  {analytics.errors.errorRate}%
                                </p>
                              </div>
                            </div>
                            {analytics.errors.topErrors.length > 0 ? (
                              <div className="space-y-1">
                                {analytics.errors.topErrors
                                  .slice(0, 5)
                                  .map((err) => (
                                    <div
                                      key={err.type}
                                      className="flex items-center justify-between text-sm"
                                    >
                                      <span className="text-gray-700 dark:text-gray-300 truncate flex-1">
                                        {err.type}
                                      </span>
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 ml-2">
                                        {err.count}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">
                                暂无错误记录
                              </p>
                            )}
                          </div>

                          <div
                            className={`p-4 rounded-lg border ${isDark ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"}`}
                          >
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                              <span>⏱️</span> 延迟百分位
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  平均延迟
                                </p>
                                <p className="text-base font-bold text-blue-600 dark:text-blue-400">
                                  {analytics.performance.averageLatencyMs}ms
                                </p>
                              </div>
                              <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  P50
                                </p>
                                <p className="text-base font-bold text-green-600 dark:text-green-400">
                                  {analytics.performance.p50LatencyMs}ms
                                </p>
                              </div>
                              <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  P95
                                </p>
                                <p className="text-base font-bold text-yellow-600 dark:text-yellow-400">
                                  {analytics.performance.p95LatencyMs}ms
                                </p>
                              </div>
                              <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  P99
                                </p>
                                <p className="text-base font-bold text-red-600 dark:text-red-400">
                                  {analytics.performance.p99LatencyMs}ms
                                </p>
                              </div>
                            </div>
                            <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2">
                              基于 {analytics.performance.totalMetrics} 个样本
                            </p>
                          </div>

                          <div
                            className={`p-4 rounded-lg border ${isDark ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"}`}
                          >
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                              <span>💬</span> 会话统计
                            </h3>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">
                                  总事件数
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {analytics.session.totalEvents.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">
                                  总会话数
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {analytics.session.totalSessions.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-600 pt-2">
                                <span className="text-gray-500 dark:text-gray-400">
                                  活动会话
                                </span>
                                <span className="font-bold text-green-600 dark:text-green-400">
                                  {analytics.session.activeSessions.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            className={`p-4 rounded-lg border ${isDark ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"}`}
                          >
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                              <span>💰</span> 成本概览
                            </h3>
                            <div className="flex items-center justify-center py-4">
                              <div className="text-center">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                  累计成本 (USD)
                                </p>
                                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                                  {formatCost(
                                    costSummary?.yearlyCost ?? 0,
                                    currency,
                                  )}
                                </p>
                              </div>
                            </div>
                            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                              基于成本记录实时统计
                            </p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        className={`text-center py-8 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                      >
                        加载分析数据...
                      </div>
                    )}
                  </div>
                </div>

                {systemHealth && (
                  <div
                    className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                  >
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                      <h2
                        className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                      >
                        🩺 系统健康
                      </h2>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-4">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            systemHealth.status === "healthy"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : systemHealth.status === "degraded"
                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {systemHealth.status === "healthy"
                            ? "健康"
                            : systemHealth.status === "degraded"
                              ? "降级"
                              : "不健康"}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          检测时间:{" "}
                          {new Date(systemHealth.timestamp).toLocaleString(
                            "zh-CN",
                          )}
                        </span>
                      </div>
                      {systemHealth.components.length > 0 && (
                        <div className="space-y-2">
                          {systemHealth.components.map((comp, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-700/30"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    comp.status === "ok"
                                      ? "bg-green-500"
                                      : comp.status === "warning"
                                        ? "bg-yellow-500"
                                        : "bg-red-500"
                                  }`}
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  {comp.name}
                                </span>
                              </div>
                              {comp.message && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {comp.message}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div
                  className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                >
                  <div
                    className="p-4 border-b border-gray-200 dark:border-gray-700 cursor-pointer select-none"
                    onClick={() => setShowAlerts((v) => !v)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`transition-transform ${showAlerts ? "" : "-rotate-90"}`}
                        >
                          ▼
                        </span>
                        <h2
                          className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                        >
                          🔴 告警列表
                        </h2>
                        {filteredAlerts.length > 0 && (
                          <span className="px-1.5 py-0.5 text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
                            {filteredAlerts.length}
                          </span>
                        )}
                      </div>
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={filterLevel}
                          onChange={(e) => setFilterLevel(e.target.value)}
                          className={`px-3 py-1.5 text-sm rounded-lg border ${
                            isDark
                              ? "bg-gray-700 border-gray-600 text-gray-300"
                              : "bg-white border-gray-300 text-gray-700"
                          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        >
                          <option value="all">全部未确认</option>
                          <option value="critical">严重</option>
                          <option value="error">错误</option>
                          <option value="warn">警告</option>
                          <option value="info">信息</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  {showAlerts && (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredAlerts.length === 0 ? (
                        <div
                          className={`p-8 text-center ${isDark ? "text-gray-500" : "text-gray-400"}`}
                        >
                          暂无未确认的告警
                        </div>
                      ) : (
                        filteredAlerts.map((alert) => (
                          <div
                            key={alert.id}
                            className="p-4 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  alert.level === "critical"
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                    : alert.level === "error"
                                      ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                                      : alert.level === "warn"
                                        ? "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400"
                                        : "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                                }`}
                              >
                                {alert.level.toUpperCase()}
                              </span>
                              <span
                                className={
                                  isDark ? "text-gray-300" : "text-gray-700"
                                }
                              >
                                {alert.message}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span
                                className={`text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
                              >
                                {new Date(alert.timestamp).toLocaleString(
                                  "zh-CN",
                                )}
                              </span>
                              <button
                                onClick={() => handleAcknowledge(alert.id)}
                                className={`px-3 py-1 text-sm rounded-lg border ${
                                  isDark
                                    ? "border-gray-600 text-gray-400 hover:bg-gray-700"
                                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                                }`}
                              >
                                确认
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {loading && !stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SkeletonCard count={8} />
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
