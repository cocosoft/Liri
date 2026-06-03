import { useEffect } from "react";
import { useUsageStatsStore } from "../../stores/usageStatsStore";
import { useConfigStore } from "../../stores/configStore";

function fmtUSD(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function UsageStatsPanel() {
  const store = useUsageStatsStore();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  useEffect(() => {
    store.loadAll(30);
  }, []);

  if (store.isLoading && !store.summary) {
    return (
      <div
        className={`flex items-center justify-center h-64 ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        加载使用量统计...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {store.error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {store.error}
          <button onClick={store.clearError} className="ml-2 underline">
            关闭
          </button>
        </div>
      )}

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          className={`rounded-lg border p-4 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <p
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            总请求数
          </p>
          <p
            className={`text-xl font-bold mt-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {store.summary?.totalRequests.toLocaleString() ?? "--"}
          </p>
        </div>
        <div
          className={`rounded-lg border p-4 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <p
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            总成本（今日）
          </p>
          <p
            className={`text-xl font-bold mt-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {store.summary ? fmtUSD(store.summary.totalCost) : "--"}
          </p>
        </div>
        <div
          className={`rounded-lg border p-4 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <p
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            总 Tokens（今日）
          </p>
          <p
            className={`text-xl font-bold mt-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {store.summary
              ? fmtTokens(
                  store.summary.totalInputTokens +
                    store.summary.totalOutputTokens,
                )
              : "--"}
          </p>
        </div>
        <div
          className={`rounded-lg border p-4 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <p
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            成功率（今日）
          </p>
          <p
            className={`text-xl font-bold mt-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {store.summary ? `${store.summary.successRate}%` : "--"}
          </p>
        </div>
      </div>

      {/* 模型统计表 */}
      {store.modelStats.length > 0 && (
        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3
              className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              模型用量排名（近30天）
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
                    请求数
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    Tokens
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    成本
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    均延迟
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {store.modelStats.map((m) => (
                  <tr
                    key={m.model}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">
                      {m.model}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {m.requestCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {fmtTokens(m.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                      {fmtUSD(m.totalCost)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-400">
                      {m.avgLatencyMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 供应商统计表 */}
      {store.providerStats.length > 0 && (
        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3
              className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              供应商用量排名（近30天）
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={isDark ? "bg-gray-700" : "bg-gray-50"}>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    供应商
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    请求数
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    Tokens
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    成本
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    成功率
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    均延迟
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {store.providerStats.map((p) => (
                  <tr
                    key={p.providerId}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">
                      {p.providerName}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {p.requestCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {fmtTokens(p.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                      {fmtUSD(p.totalCost)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {p.successRate}%
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-400">
                      {p.avgLatencyMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 暂无数据 */}
      {!store.summary?.totalRequests && !store.isLoading && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <p className="text-lg mb-2">暂无使用量数据</p>
          <p className="text-sm">启动一次 AI 对话后，数据将自动记录</p>
        </div>
      )}
    </div>
  );
}

export default UsageStatsPanel;
