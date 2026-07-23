// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * CacheBenefitPanel — 缓存效益面板（从 DashboardPage L664-747 提取）
 * 3 列卡片（缓存读取/创建/命中率）+ 水平比例条
 * Props: { totalCacheReadTokens, totalCacheCreationTokens }
 */

export interface CacheBenefitPanelProps {
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
}

export function CacheBenefitPanel({ totalCacheReadTokens, totalCacheCreationTokens }: CacheBenefitPanelProps) {
  const totalCache = totalCacheReadTokens + totalCacheCreationTokens;
  const hitRate = totalCache > 0
    ? `${((totalCacheReadTokens / totalCache) * 100).toFixed(1)}%`
    : '0%';

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          ⚡ 缓存效益
        </h2>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 rounded-lg border text-center bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">缓存读取</p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {totalCacheReadTokens.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">tokens</p>
          </div>
          <div className="p-3 rounded-lg border text-center bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">缓存创建</p>
            <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
              {totalCacheCreationTokens.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">tokens</p>
          </div>
          <div className="p-3 rounded-lg border text-center bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">缓存命中率</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {hitRate}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">read / total</p>
          </div>
        </div>
        {totalCacheCreationTokens > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-400"
                  style={{
                    width: `${Math.min((totalCacheReadTokens / (totalCacheCreationTokens || 1)) * 100, 100)}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {totalCacheReadTokens.toLocaleString()} / {totalCacheCreationTokens.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 text-right">
              读取 / 创建 比率
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
