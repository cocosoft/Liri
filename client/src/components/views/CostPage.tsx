import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useConfigStore } from "../../stores/configStore";
import {
  costService,
  type CostSummary,
  type CostRecord,
} from "../../services/costService";
import { formatCost, formatTokens, getCurrencyFromTimezone } from "../../utils/format";
import { MetricCard } from "../common/MetricCard";
import { TokenGrid } from "../common/TokenGrid";
import { PieChart } from "../common/PieChart";
import { sseService } from "../../services/sseService";
import { balanceService } from "../../services/balanceService";
import type { BalanceRecord } from "../../types";

const PricingPanel = lazy(() => import("../usage/PricingPanel"));

function CostPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const timezone = (config.timezone as string) || 'Asia/Shanghai';
  const currency = getCurrencyFromTimezone(timezone);

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [selectedPeriod, setSelectedPeriod] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");
  const [activeTab, setActiveTab] = useState<"cost" | "pricing">(
    "cost",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<BalanceRecord[]>([]);

  // 错误隔离：cost / balance / records 各自独立获取
  const fetchCostData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const summaryData = await costService.getCostSummary();
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载成本数据失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const recordsData = await costService.getCostRecords(recordsPage, 20);
      setRecords(recordsData.records);
      setRecordsTotal(recordsData.total);
    } catch {
      // 记录加载失败不影响主视图
    }
  }, [recordsPage]);

  const fetchBalances = useCallback(async () => {
    try {
      const b = await balanceService.batchCheck();
      setBalances(b);
    } catch {
      // 余额加载失败不阻塞其他数据
    }
  }, []);

  const refreshAll = useCallback(async (silent = false) => {
    // 并行拉取，各自处理错误，不互相阻塞
    await fetchCostData(silent);
    fetchBalances();
    fetchRecords();
  }, [fetchCostData, fetchBalances, fetchRecords]);

  useEffect(() => {
    loadConfig();
    refreshAll();
  }, [loadConfig, refreshAll]);

  // SSE heartbeat 驱动自动刷新 + 60s setInterval 兜底（与 DashboardPage 一致）
  useEffect(() => {
    const handler = () => { refreshAll(true); };
    sseService.on("heartbeat", handler);
    const interval = setInterval(() => refreshAll(true), 60_000);
    return () => {
      sseService.off("heartbeat", handler);
      clearInterval(interval);
    };
  }, [refreshAll]);

  const handlePageChange = (page: number) => {
    setRecordsPage(page);
  };

  if (loading && !summary) {
    return (
      <div
        className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
      >
        <div className="max-w-6xl mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div
              className={`text-lg ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              加载中...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div
        className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
      >
        <div className="max-w-6xl mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-red-500">加载失败: {error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const maxDailyCost = Math.max(
    ...summary.dailyBreakdown.map((d) => d.cost),
    0.001,
  );
  const maxDailyTokens = Math.max(
    ...summary.dailyBreakdown.map((d) => d.tokens),
    1,
  );
  const totalPages = Math.ceil(recordsTotal / 20);

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-6xl mx-auto p-6">
        {/* 页面标题 + Tab 切换 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              成本与 Token 监控
            </h1>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              实时追踪 AI 服务消费情况和 Token 消耗
            </p>
          </div>
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <button
              onClick={() => setActiveTab("cost")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === "cost" ? "bg-white dark:bg-gray-700 shadow-sm font-medium" : "text-gray-600 dark:text-gray-400"}`}
            >
              成本总览
            </button>
            <button
              onClick={() => setActiveTab("pricing")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === "pricing" ? "bg-white dark:bg-gray-700 shadow-sm font-medium" : "text-gray-600 dark:text-gray-400"}`}
            >
              定价管理
            </button>
          </div>
        </div>

        {activeTab === "pricing" ? (
          <Suspense
            fallback={
              <div className="h-64 flex items-center justify-center text-gray-400">
                加载中...
              </div>
            }
          >
            <PricingPanel />
          </Suspense>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              {(["daily", "weekly", "monthly"] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectedPeriod === period
                      ? "bg-blue-600 text-white"
                      : isDark
                        ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                        : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                  }`}
                >
                  {period === "daily"
                    ? "今日"
                    : period === "weekly"
                      ? "本周"
                      : "本月"}
                </button>
              ))}
            </div>

            {/* 成本统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <MetricCard
                label="今日成本"
                value={formatCost(summary.todayCost, currency)}
                sublabel={`${formatTokens(summary.todayTokens)} tokens`}
              />
              <MetricCard
                label="本周成本"
                value={formatCost(summary.weeklyCost, currency)}
              />
              <MetricCard
                label="本月成本"
                value={formatCost(summary.monthlyCost, currency)}
                sublabel={`${formatTokens(summary.monthlyTokens)} tokens`}
              />
              <MetricCard
                label="当前会话"
                value={formatCost(summary.sessionCost, '$')}
                sublabel={`${formatTokens(summary.sessionTokens)} tokens`}
              />
            </div>

            {/* Token 明细 */}
            <TokenGrid
              inputTokens={summary.totalInputTokens}
              outputTokens={summary.totalOutputTokens}
              cacheReadTokens={summary.totalCacheReadTokens}
              totalRequests={summary.totalRequests}
            />

            {/* 余额概览 */}
            {balances.length > 0 && (
              <div className={`rounded-lg border mb-6 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}>
                    余额概览
                  </h3>
                </div>
                <div className="p-4 space-y-2">
                  {balances.map((b) => (
                    <div key={b.providerId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                          {b.providerName}
                        </span>
                        <span className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                          {b.providerType}
                        </span>
                        {b.belowThreshold && (
                          <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                            余额不足
                          </span>
                        )}
                        {!b.supported && (
                          <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded">
                            不支持余额查询
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {b.remaining !== null ? (
                          <span className={`font-mono ${b.belowThreshold ? "text-red-600 dark:text-red-400" : isDark ? "text-gray-300" : "text-gray-700"}`}>
                            {b.remaining.toFixed(2)} {b.unit}
                            {b.total !== null ? ` / ${b.total.toFixed(2)} ${b.unit}` : ""}
                          </span>
                        ) : (
                          <span className={isDark ? "text-gray-500" : "text-gray-400"}>--</span>
                        )}
                        {b.queriedAt && (
                          <span className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                            {new Date(b.queriedAt * 1000).toLocaleTimeString("zh-CN")}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 图表 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div
                className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-4`}
              >
                <h3
                  className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  模型成本分布
                </h3>
                <PieChart
                  data={summary.topProviders.slice(0, 6).map((p, i) => ({
                    label: p.provider,
                    value: p.cost,
                    color: ['#3B82F6', '#8B5CF6', '#06B6D4', '#F59E0B', '#EF4444', '#10B981'][i % 6],
                  }))}
                  centerLabel="月成本"
                  centerValue={formatCost(summary.monthlyCost, currency)}
                />
              </div>
              <div
                className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-4`}
              >
                <h3
                  className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  每日成本与 Token 趋势
                </h3>
                <div className="h-52 flex items-end justify-between gap-1.5 px-2">
                  {summary.dailyBreakdown.map((day) => (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center justify-end h-full"
                    >
                      <span
                        className={`text-[10px] mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {formatCost(day.cost, currency)}
                      </span>
                      <div
                        className="w-full flex gap-0.5 items-end justify-center"
                        style={{ height: "120px" }}
                      >
                        <div
                          className="w-1/2 bg-blue-500 rounded-t"
                          style={{
                            height: `${Math.max((day.cost / maxDailyCost) * 100, 2)}%`,
                            opacity: 0.8,
                          }}
                        />
                        <div
                          className="w-1/2 bg-emerald-500 rounded-t"
                          style={{
                            height: `${Math.max((day.tokens / maxDailyTokens) * 100, 2)}%`,
                            opacity: 0.6,
                          }}
                        />
                      </div>
                      <span
                        className={`text-[10px] mt-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {day.date}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 模型消费明细 */}
            <div
              className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} mb-6`}
            >
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3
                  className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  各模型消耗明细
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className={isDark ? "bg-gray-700" : "bg-gray-50"}>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        模型
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        输入
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        输出
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        总 Tokens
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        缓存
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        请求
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        成本
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        占比
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {summary.topProviders.map((provider) => (
                      <tr
                        key={provider.provider}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">
                          {provider.provider}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {formatTokens(provider.inputTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {formatTokens(provider.outputTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-300">
                          {formatTokens(provider.totalTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {provider.cacheReadTokens > 0
                            ? formatTokens(provider.cacheReadTokens)
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {provider.requests}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                          {formatCost(provider.cost, currency)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {provider.percentage}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 消费记录表 */}
            <div
              className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
            >
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3
                  className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  消费记录
                </h3>
                <div
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  共 {recordsTotal} 条记录
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className={isDark ? "bg-gray-700" : "bg-gray-50"}>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        时间
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        模型
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        输入
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        输出
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        总 Tokens
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        缓存
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        成本
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {records.map((record) => (
                      <tr
                        key={record.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {new Date(record.date).toLocaleDateString("zh-CN")}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">
                          {record.model}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {formatTokens(record.promptTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {formatTokens(record.completionTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-300">
                          {formatTokens(record.totalTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                          {record.cacheReadTokens > 0
                            ? formatTokens(record.cacheReadTokens)
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                          {formatCost(record.cost, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div
                    className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    第 {recordsPage} / {totalPages} 页
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePageChange(recordsPage - 1)}
                      disabled={recordsPage <= 1}
                      className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() => handlePageChange(recordsPage + 1)}
                      disabled={recordsPage >= totalPages}
                      className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CostPage;
