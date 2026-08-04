import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useConfigStore } from "../../stores/configStore";
import {
  usageService,
  type CostSummary,
  type CostRecord,
  type CostReconcileResult,
} from "../../services/usageService";
import type { UsageSummary } from "../../types";
import { sseService } from "../../services/sseService";
import {
  formatCost,
  formatTokens,
  getCurrencyFromTimezone,
} from "../../utils/format";
import { MetricCard } from "../common/MetricCard";
import { TokenGrid } from "../common/TokenGrid";
import { PieChart } from "../common/PieChart";
import { getOTelTracing } from "../../monitoring/otel/OTelTracing";
import { handleClientError } from "../../utils/handleError";
import type { BalanceRecord } from "../../types";

const PricingPanel = lazy(() => import("../usage/PricingPanel"));

type TabId = "usage" | "cost" | "balance" | "pricing";

const TABS: { id: TabId; label: string; desc: string }[] = [
  { id: "usage", label: "用量总览", desc: "Token 消耗 / 工具调用 / 模型分布" },
  { id: "cost", label: "成本分析", desc: "费用趋势 / 供应商分布 / 消费记录" },
  { id: "balance", label: "余额管理", desc: "供应商余额查询 / 不足告警" },
  { id: "pricing", label: "定价管理", desc: "模型定价配置 / 批量管理" },
];

const RANGE_OPTIONS = [
  { label: "当前", value: "current" },
  { label: "今天", value: "today" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
];

function formatTokensLocal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 导出 CSV */
function exportCSV(summary: CostSummary | null, records: CostRecord[]) {
  if (!summary) return;
  const rows = [["类型", "指标", "值"].join(",")];
  rows.push(["成本", "今日", summary.todayCost.toFixed(4)].join(","));
  rows.push(["成本", "本周", summary.weeklyCost.toFixed(4)].join(","));
  rows.push(["成本", "本月", summary.monthlyCost.toFixed(4)].join(","));
  rows.push(["Token", "总输入", String(summary.totalInputTokens)].join(","));
  rows.push(["Token", "总输出", String(summary.totalOutputTokens)].join(","));
  for (const r of records) {
    rows.push(
      ["记录", r.date, r.model, String(r.totalTokens), r.cost.toFixed(4)].join(
        ",",
      ),
    );
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `usage-export-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

export default function UsageCenterPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const timezone = (config.timezone as string) || "Asia/Shanghai";
  const currency = getCurrencyFromTimezone(timezone);
  const [searchParams, setSearchParams] = useSearchParams();

  const tabFromUrl = (searchParams.get("tab") || "usage") as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : "usage",
  );

  // 用量总览
  const [range, setRange] = useState("current");
  const [usageData, setUsageData] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // 时间范围 → 日期参数
  function getDateRange(r: string): { startDate?: number; endDate?: number } {
    const now = new Date();
    const end = now.getTime();
    switch (r) {
      case "today": {
        const start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        ).getTime();
        return { startDate: start, endDate: end };
      }
      case "7d":
        return { startDate: end - 7 * 86400000, endDate: end };
      case "30d":
        return { startDate: end - 30 * 86400000, endDate: end };
      default:
        return {};
    }
  }

  // 用量总览
  useEffect(() => {
    if (activeTab !== "usage") return;
    setUsageLoading(true);
    const { startDate, endDate } = getDateRange(range);
    const otel = getOTelTracing();
    const span = otel.startSpan("usageCenter.usageSummary", { range });
    usageService
      .summary({ startDate, endDate })
      .then((d) => {
        setUsageData(d);
        span.setAttribute("status", "success");
        otel.endSpan(span);
        setUsageLoading(false);
      })
      .catch((e) => {
        handleClientError(e, {
          module: "components:views:UsageCenterPage",
          action: "fetchUsageSummary",
          meta: { range },
        });
        span.setAttribute("status", "error");
        otel.endSpan(span);
        setUsageLoading(false);
      });
  }, [range, activeTab]);

  // 成本分析
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 余额
  const [balances, setBalances] = useState<BalanceRecord[]>([]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  // ── 成本 & 余额 ──
  const fetchCostData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const summaryData = await usageService.getCostSummary();
      setSummary(summaryData);
    } catch (err) {
      handleClientError(err, {
        module: "components:views:UsageCenterPage",
        action: "fetchCostData",
      });
      setError(err instanceof Error ? err.message : "加载成本数据失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const recordsData = await usageService.getCostRecords(recordsPage, 20);
      setRecords(recordsData.records);
      setRecordsTotal(recordsData.total);
    } catch (e) {
      handleClientError(e, {
        module: "components:views:UsageCenterPage",
        action: "fetchRecords",
        meta: { page: recordsPage },
      });
    }
  }, [recordsPage]);

  const fetchBalances = useCallback(async () => {
    try {
      const b = await usageService.batchCheckBalance();
      setBalances(b);
    } catch (e) {
      handleClientError(e, {
        module: "components:views:UsageCenterPage",
        action: "fetchBalances",
      });
    }
  }, []);

  // 对账：校验用量日志与成本记录一致性
  const [reconcile, setReconcile] = useState<CostReconcileResult | null>(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const runReconcile = useCallback(async () => {
    setReconcileLoading(true);
    setReconcileError(null);
    try {
      const r = await usageService.getCostReconcile();
      setReconcile(r);
    } catch (e) {
      handleClientError(e, {
        module: "components:views:UsageCenterPage",
        action: "runReconcile",
      });
      setReconcileError(e instanceof Error ? e.message : "对账失败");
    } finally {
      setReconcileLoading(false);
    }
  }, []);

  const refreshAll = useCallback(
    async (silent = false) => {
      await fetchCostData(silent);
      fetchBalances();
      fetchRecords();
    },
    [fetchCostData, fetchBalances, fetchRecords],
  );

  useEffect(() => {
    loadConfig();
    refreshAll();
  }, [loadConfig, refreshAll]);

  // SSE heartbeat + 60s 兜底
  useEffect(() => {
    const handler = () => {
      refreshAll(true);
    };
    sseService.on("heartbeat", handler);
    const interval = setInterval(() => refreshAll(true), 60_000);
    return () => {
      sseService.off("heartbeat", handler);
      clearInterval(interval);
    };
  }, [refreshAll]);

  const totalPages = Math.ceil(recordsTotal / 20);
  const maxDailyCost = summary
    ? Math.max(...summary.dailyBreakdown.map((d) => d.cost), 0.001)
    : 1;
  const maxDailyTokens = summary
    ? Math.max(...summary.dailyBreakdown.map((d) => d.tokens), 1)
    : 1;

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => exportCSV(summary, records)}
            className="px-3 py-1.5 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            导出 CSV
          </button>
        </div>

        {/* 实时会话状态栏 */}
        {summary && (
          <div className="flex items-center gap-4 px-3 py-2 mb-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs">
            <span className="text-gray-500">当前会话</span>
            <span className="text-blue-500">
              In: {formatTokens(summary.sessionInputTokens)}
            </span>
            <span className="text-green-500">
              Out: {formatTokens(summary.sessionOutputTokens)}
            </span>
            <span className="text-red-500">
              {formatCost(summary.sessionCost, "$")}
            </span>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span className="text-gray-500">今日</span>
            <span className="text-orange-500">
              {formatCost(summary.todayCost, currency)}
            </span>
            <span className="text-gray-400">
              {formatTokens(summary.todayTokens)} tokens
            </span>
          </div>
        )}

        {/* Tab 导航 */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === tab.id ? "bg-white dark:bg-gray-700 shadow-sm font-medium" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
              title={tab.desc}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: 用量总览 */}
        {activeTab === "usage" && (
          <div className="space-y-4">
            <div className="flex gap-1">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRange(opt.value)}
                  className={`px-2 py-1 text-xs rounded ${range === opt.value ? "bg-blue-500 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {usageLoading ? (
              <p className="text-sm text-gray-400">加载中...</p>
            ) : !usageData ? (
              <p className="text-sm text-gray-400">暂无数据</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">总请求数</p>
                    <p className="text-lg font-semibold">
                      {usageData.totalRequests.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">总成本</p>
                    <p className="text-lg font-semibold">
                      {formatCost(usageData.totalCost, currency)}
                    </p>
                  </div>
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">输入 Token</p>
                    <p className="text-lg font-semibold">
                      {formatTokensLocal(usageData.totalInputTokens)}
                    </p>
                  </div>
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">输出 Token</p>
                    <p className="text-lg font-semibold">
                      {formatTokensLocal(usageData.totalOutputTokens)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">缓存读取 Token</p>
                    <p className="text-lg font-semibold">
                      {formatTokensLocal(usageData.totalCacheReadTokens)}
                    </p>
                  </div>
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">缓存写入 Token</p>
                    <p className="text-lg font-semibold">
                      {formatTokensLocal(usageData.totalCacheCreationTokens)}
                    </p>
                  </div>
                  <div className="p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500">成功率</p>
                    <p className="text-lg font-semibold">
                      {(usageData.successRate * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: 成本分析 */}
        {activeTab === "cost" && (
          <>
            {loading && !summary ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-gray-400">加载中...</div>
              </div>
            ) : error && !summary ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-red-500">加载失败: {error}</div>
              </div>
            ) : summary ? (
              <>
                {/* 成本对账：校验用量日志与成本记录一致性 */}
                <div
                  className={`mb-4 p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-medium">成本对账</h3>
                    <button
                      onClick={runReconcile}
                      disabled={reconcileLoading}
                      className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                    >
                      {reconcileLoading ? "对账中..." : "运行对账"}
                    </button>
                  </div>
                  {reconcileError && (
                    <p className="text-sm text-red-500 mb-2">
                      {reconcileError}
                    </p>
                  )}
                  {reconcile && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                          <p className="text-xs text-gray-500">匹配记录</p>
                          <p className="text-lg font-semibold text-green-600">
                            {reconcile.matched}
                          </p>
                        </div>
                        <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                          <p className="text-xs text-gray-500">仅用量侧</p>
                          <p className="text-lg font-semibold text-orange-500">
                            {reconcile.onlyInUsage}
                          </p>
                        </div>
                        <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                          <p className="text-xs text-gray-500">仅成本侧</p>
                          <p className="text-lg font-semibold text-purple-500">
                            {reconcile.onlyInCost}
                          </p>
                        </div>
                        <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                          <p className="text-xs text-gray-500">匹配率</p>
                          <p className="text-lg font-semibold">
                            {reconcile.matchRate}
                          </p>
                        </div>
                      </div>
                      {reconcile.onlyInUsage > 0 && (
                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                          提示：仅用量侧记录表示用量已记录但成本未落库（历史数据未回填或定价缺失），新记录将随成本链路自动持久化。
                        </p>
                      )}
                      {reconcile.costDiffs.length > 0 && (
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr
                                className={
                                  isDark ? "bg-gray-700" : "bg-gray-50"
                                }
                              >
                                <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  模型
                                </th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                                  用量侧成本
                                </th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                                  成本侧
                                </th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                                  差异
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {reconcile.costDiffs.slice(0, 20).map((d) => (
                                <tr
                                  key={d.requestId}
                                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                >
                                  <td className="px-3 py-1.5 text-sm text-gray-900 dark:text-gray-200">
                                    {d.model}
                                  </td>
                                  <td className="px-3 py-1.5 text-sm text-right text-gray-500">
                                    {d.costUsageLogs.toFixed(4)}
                                  </td>
                                  <td className="px-3 py-1.5 text-sm text-right text-gray-500">
                                    {d.costRecords.toFixed(4)}
                                  </td>
                                  <td className="px-3 py-1.5 text-sm text-right font-medium text-red-500">
                                    {d.diff.toFixed(4)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
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
                    value={formatCost(summary.sessionCost, "$")}
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

                {/* 图表 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 mt-4">
                  <div
                    className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-4`}
                  >
                    <h3
                      className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      供应商成本分布
                    </h3>
                    <PieChart
                      data={summary.topProviders.slice(0, 6).map((p, i) => ({
                        label: p.provider,
                        value: p.cost,
                        color: [
                          "#3B82F6",
                          "#8B5CF6",
                          "#06B6D4",
                          "#F59E0B",
                          "#EF4444",
                          "#10B981",
                        ][i % 6],
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
                          <span className="text-[10px] mb-0.5 text-gray-400">
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
                          <span className="text-[10px] mt-0.5 text-gray-400">
                            {day.date}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 模型明细表 */}
                <div
                  className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} mb-6`}
                >
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-medium">各模型消耗明细</h3>
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
                            <td className="px-4 py-3 text-sm text-right text-gray-500">
                              {formatTokens(provider.inputTokens)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-500">
                              {formatTokens(provider.outputTokens)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-300">
                              {formatTokens(provider.totalTokens)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                              {formatCost(provider.cost, currency)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-500">
                              {provider.percentage}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 消费记录 */}
                <div
                  className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                >
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-lg font-medium">消费记录</h3>
                    <div className="text-sm text-gray-400">
                      共 {recordsTotal} 条
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
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {new Date(record.date).toLocaleDateString(
                                "zh-CN",
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">
                              {record.model}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-500">
                              {formatTokens(record.promptTokens)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-500">
                              {formatTokens(record.completionTokens)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-300">
                              {formatTokens(record.totalTokens)}
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
                      <span className="text-sm text-gray-400">
                        第 {recordsPage} / {totalPages} 页
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setRecordsPage((p) => Math.max(1, p - 1))
                          }
                          disabled={recordsPage <= 1}
                          className="px-3 py-1 text-sm rounded disabled:opacity-50 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border"
                        >
                          上一页
                        </button>
                        <button
                          onClick={() =>
                            setRecordsPage((p) => Math.min(totalPages, p + 1))
                          }
                          disabled={recordsPage >= totalPages}
                          className="px-3 py-1 text-sm rounded disabled:opacity-50 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </>
        )}

        {/* Tab 3: 余额管理 */}
        {activeTab === "balance" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={fetchBalances}
                className="px-3 py-1.5 text-sm text-blue-600 hover:underline"
              >
                刷新
              </button>
            </div>
            {balances.length === 0 ? (
              <p className="text-sm text-gray-400">暂无余额数据</p>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="space-y-2">
                  {balances.map((b) => (
                    <div
                      key={b.providerId}
                      className="flex items-center justify-between text-sm py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {b.providerName}
                        </span>
                        <span className="text-xs text-gray-400">
                          {b.providerType}
                        </span>
                        {b.belowThreshold && (
                          <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                            余额不足
                          </span>
                        )}
                        {!b.supported && (
                          <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded">
                            不支持
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {b.remaining !== null ? (
                          <span
                            className={`font-mono ${b.belowThreshold ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}
                          >
                            {b.remaining.toFixed(2)} {b.unit}
                            {b.total !== null
                              ? ` / ${b.total.toFixed(2)} ${b.unit}`
                              : ""}
                          </span>
                        ) : (
                          <span className="text-gray-400">--</span>
                        )}
                        {b.queriedAt && (
                          <span className="text-xs text-gray-400">
                            {new Date(b.queriedAt * 1000).toLocaleTimeString(
                              "zh-CN",
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: 定价管理 */}
        {activeTab === "pricing" && (
          <Suspense
            fallback={
              <div className="h-64 flex items-center justify-center text-gray-400">
                加载中...
              </div>
            }
          >
            <PricingPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
