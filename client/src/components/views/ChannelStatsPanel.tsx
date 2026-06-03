/**
 * ChannelStatsPanel — 渠道统计面板
 * 对标 OpenClaw HermesChannelsPage Hero 区域
 * 展示 4 个指标卡片：总数 / 已连接 / 已启用 / 已禁用
 */

interface ChannelStats {
  total: number;
  connected: number;
  enabled: number;
  disabled: number;
}

interface ChannelStatsPanelProps {
  stats: ChannelStats;
}

function StatCard({
  icon,
  label,
  value,
  colorClass,
}: {
  icon: string;
  label: string;
  value: number;
  colorClass: string;
}) {
  return (
    <div className="flex flex-col p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <span className="text-lg">{icon}</span>
      </div>
      <span className={`text-2xl font-bold ${colorClass}`}>
        {value}
      </span>
    </div>
  );
}

function ChannelStatsPanel({ stats }: ChannelStatsPanelProps) {
  return (
    <div className="mb-4 p-5 rounded-xl bg-gradient-to-br from-blue-50 to-green-50 dark:from-blue-950/40 dark:to-green-950/40 border border-blue-100 dark:border-blue-900/30">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            消息渠道
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            管理多平台消息通道
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon="📡"
          label="总数"
          value={stats.total}
          colorClass="text-gray-700 dark:text-gray-300"
        />
        <StatCard
          icon="✅"
          label="已连接"
          value={stats.connected}
          colorClass="text-green-600 dark:text-green-400"
        />
        <StatCard
          icon="🔌"
          label="已启用"
          value={stats.enabled}
          colorClass="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          icon="⚠️"
          label="已禁用"
          value={stats.disabled}
          colorClass="text-amber-600 dark:text-amber-400"
        />
      </div>
    </div>
  );
}

export default ChannelStatsPanel;
