// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ProviderRankTable — 供应商排名表（供应商名 + 请求数 + Tokens + 成本 + 成功率 + 延迟）
 * Props: { stats: ProviderRankEntry[], currency?, maxRows? }
 */
import { formatCost, formatTokens } from "../../utils/format";

export interface ProviderRankEntry {
  providerId: string;
  providerName: string;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
  successRate?: number;
  avgLatencyMs?: number;
}

export interface ProviderRankTableProps {
  stats: ProviderRankEntry[];
  currency?: string;
  maxRows?: number;
}

export function ProviderRankTable({
  stats,
  currency = "$",
  maxRows = 10,
}: ProviderRankTableProps) {
  const sorted = [...stats]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, maxRows);

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
                {p.successRate != null && p.successRate < 100 && (
                  <span className="text-xs text-gray-400">
                    {p.successRate.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTokens(p.requestCount)} 次
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTokens(p.totalTokens)}
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300 w-20 text-right">
                  {formatCost(p.totalCost, currency)}
                </span>
                {p.avgLatencyMs != null && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-14 text-right">
                    {p.avgLatencyMs.toFixed(0)}ms
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
