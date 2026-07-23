// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * DashboardStatCard — 概览卡片（场景 B：大数字 + emoji icon + trendDirection，用于 DashboardPage）
 * Props: { label, value, icon?, trendDirection? }
 */
export interface DashboardStatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  trendDirection?: 'up' | 'down' | 'stable';
}

export function DashboardStatCard({ label, value, icon, trendDirection }: DashboardStatCardProps) {
  const trendIcon = trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '→';
  const trendColor =
    trendDirection === 'up'
      ? 'text-green-500'
      : trendDirection === 'down'
        ? 'text-red-500'
        : 'text-gray-400';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {value}
          </p>
          {trendDirection && (
            <span className={`text-xs mt-0.5 inline-flex items-center gap-0.5 ${trendColor}`}>
              {trendIcon} 较昨日
            </span>
          )}
        </div>
        {icon && <span className="text-3xl">{icon}</span>}
      </div>
    </div>
  );
}
