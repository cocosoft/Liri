// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 用量仪表盘组件
 * 展示 API 使用统计概览、余额、模型使用排行、供应商排行
 * 替代原 ModelCompare 鸡肋组件
 */

import { useEffect, useState, useCallback } from "react";
import { usageService } from "../../services/usageService";
import { balanceService } from "../../services/balanceService";
import { handleClientError } from "../../utils/handleError";
import type {
  UsageSummary,
  ModelUsageStats,
  ProviderUsageStats,
  BalanceRecord,
} from "../../types";

/** 格式化金额 */
function fmtCost(cost: number): string {
  return `¥${cost.toFixed(4)}`;
}

/** 格式化数量 */
function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/**
 * 用量仪表盘
 */
export default function UsageDashboard() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [modelStats, setModelStats] = useState<ModelUsageStats[]>([]);
  const [providerStats, setProviderStats] = useState<ProviderUsageStats[]>([]);
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, p, b] = await Promise.all([
        usageService.summary(),
        usageService.modelStats(),
        usageService.providerStats(),
        balanceService.batchCheck(),
      ]);
      setSummary(s);
      setModelStats(m);
      setProviderStats(p);
      setBalances(b);
    } catch (e) {
      handleClientError(e, { module: "components:modelAdmin:UsageDashboard", action: "loadData" });
      // 静默失败，UI 显示空数据
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 概览卡片 */}
      {summary && <SummaryCards summary={summary} />}

      {/* 余额概览 */}
      <BalanceSection balances={balances} onRefresh={loadData} />

      {/* 模型使用排行 + 供应商排行 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ModelRanking stats={modelStats} />
        <ProviderRanking stats={providerStats} />
      </div>
    </div>
  );
}

/** 概览卡片 */
function SummaryCards({ summary }: { summary: UsageSummary }) {
  const cards = [
    { label: "总请求数", value: fmtNum(summary.totalRequests) },
    { label: "总费用", value: fmtCost(summary.totalCost) },
    { label: "输入词元", value: fmtNum(summary.totalInputTokens) },
    { label: "输出词元", value: fmtNum(summary.totalOutputTokens) },
    {
      label: "缓存读取",
      value: fmtNum(summary.totalCacheReadTokens || 0),
    },
    {
      label: "缓存创建",
      value: fmtNum(summary.totalCacheCreationTokens || 0),
    },
    {
      label: "成功率",
      value: `${(summary.successRate * 100).toFixed(1)}%`,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {card.label}
          </div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 余额概览区域 */
function BalanceSection({
  balances,
  onRefresh,
}: {
  balances: BalanceRecord[];
  onRefresh: () => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          余额概览
        </h3>
        <button
          onClick={onRefresh}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          刷新
        </button>
      </div>
      {balances.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无余额数据</p>
      ) : (
        <div className="space-y-2">
          {balances.map((b) => (
            <div
              key={b.providerId}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {b.providerName}
                </span>
                <span className="text-xs text-gray-400">{b.providerType}</span>
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
                    {new Date(b.queriedAt * 1000).toLocaleTimeString("zh-CN")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 模型使用排行 */
function ModelRanking({ stats }: { stats: ModelUsageStats[] }) {
  const sorted = [...stats].sort((a, b) => b.totalCost - a.totalCost);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        模型使用排行
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无数据</p>
      ) : (
        <div className="space-y-2">
          {sorted.slice(0, 10).map((m, i) => (
            <div
              key={m.model}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-xs text-gray-400 w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="text-gray-800 dark:text-gray-200 truncate">
                  {m.model}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500">
                  {fmtNum(m.requestCount)} 次
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300 w-20 text-right">
                  {fmtCost(m.totalCost)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 供应商排行 */
function ProviderRanking({ stats }: { stats: ProviderUsageStats[] }) {
  const sorted = [...stats].sort((a, b) => b.totalCost - a.totalCost);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        供应商使用排行
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无数据</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => (
            <div
              key={p.providerId}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-gray-800 dark:text-gray-200">
                  {p.providerName}
                </span>
                <span className="text-xs text-gray-400">
                  {p.successRate < 1
                    ? `${(p.successRate * 100).toFixed(0)}%`
                    : ""}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500">
                  {fmtNum(p.requestCount)} 次
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300 w-20 text-right">
                  {fmtCost(p.totalCost)}
                </span>
                <span className="text-xs text-gray-400 w-14 text-right">
                  {p.avgLatencyMs.toFixed(0)}ms
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
