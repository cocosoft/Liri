// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MetricCard — 统计卡片（场景 A：带 sublabel + loading 态，用于 CostPage / UsageDashboard）
 * Props: { label, value, sublabel?, loading? }
 */
export interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  loading?: boolean;
}

export function MetricCard({ label, value, sublabel, loading }: MetricCardProps) {
  return (
    <div className="rounded-lg border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      {loading ? (
        <div className="mt-1 h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      ) : (
        <p className="text-xl font-bold mt-1 text-gray-900 dark:text-gray-100">{value}</p>
      )}
      {sublabel && (
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">{sublabel}</p>
      )}
    </div>
  );
}
