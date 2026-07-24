// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ModelRankTable — 模型排名表（圆点色标 + 名称 + 详情 + 费用 + 百分比 布局）
 * Props: { stats: ModelRankEntry[], currency?, maxRows? }
 */
import { formatCost, formatTokens } from "../../utils/format";

export interface ModelRankEntry {
  modelName: string;
  provider?: string;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
  avgLatencyMs?: number;
}

export interface ModelRankTableProps {
  stats: ModelRankEntry[];
  currency?: string;
  maxRows?: number;
}

const PIE_COLORS = [
  "#3B82F6",
  "#8B5CF6",
  "#06B6D4",
  "#F59E0B",
  "#EF4444",
  "#10B981",
  "#EC4899",
  "#6366F1",
];

export function ModelRankTable({
  stats,
  currency = "$",
  maxRows = 10,
}: ModelRankTableProps) {
  const sorted = [...stats]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, maxRows);
  const maxCost = sorted[0]?.totalCost || 1;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        模型使用排行
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无数据</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((m, i) => (
            <div key={m.modelName} className="flex items-center gap-2 text-sm">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-gray-800 dark:text-gray-200 truncate">
                  {m.modelName}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTokens(m.totalTokens)} tokens ·{" "}
                  {m.requestCount.toLocaleString()} 次
                  {m.avgLatencyMs != null ? ` · ${m.avgLatencyMs}ms` : ""}
                </div>
              </div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 flex-shrink-0 w-24 text-right">
                {formatCost(m.totalCost, currency)}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-12 text-right">
                {((m.totalCost / maxCost) * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
