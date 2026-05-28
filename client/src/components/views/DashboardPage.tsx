import { useEffect, useState, useCallback, memo } from 'react';
import { statsService, type DashboardStats } from '../../services/statsService';
import { useAppStore } from '../../stores/appStore';
import { SkeletonCard } from '../common/Skeleton';
import { SPECIES_MAP } from '../Buddy/buddySprites';
import { sseService } from '../../services/sseService';

const BackendCard = memo(function BackendCard({ stats }: { stats: DashboardStats }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Backend 服务</h4>
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            stats.backend.running ? 'bg-green-500' : 'bg-gray-400'
          }`}
        />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {stats.backend.running ? '运行中' : '已停止'}
        </span>
      </div>
      {stats.backend.running && (
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>端口: {stats.backend.port}</p>
          {stats.backend.pid && <p>PID: {stats.backend.pid}</p>}
        </div>
      )}
    </div>
  );
});

const BuddyDashboardCard = memo(function BuddyDashboardCard({ buddy }: { buddy: NonNullable<DashboardStats['buddy']> }) {
  const speciesInfo = SPECIES_MAP[buddy.species as keyof typeof SPECIES_MAP];
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">伙伴</h4>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl">{speciesInfo?.emoji || '🦆'}</span>
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {buddy.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {buddy.species} · {buddy.rarity}
          </p>
        </div>
      </div>
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center justify-between">
          <span>等级</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{buddy.level}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>经验值</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{buddy.xp}</span>
        </div>
      </div>
    </div>
  );
});

const StatCard = memo(function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {value}
          </p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
});

function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setActivePage = useAppStore((s) => s.setActivePage);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await statsService.getDashboardStats();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载仪表盘数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    sseService.connect();
    const handler = () => fetchStats();
    sseService.on('heartbeat', handler);
    return () => {
      sseService.off('heartbeat', handler);
    };
  }, [fetchStats]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              仪表盘
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              系统概览与状态监控
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchStats}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {loading ? '刷新中...' : '刷新'}
            </button>
            <button
              onClick={() => setActivePage('chat')}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              返回聊天
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="模型" value={stats.models} icon="🤖" />
              <StatCard label="工具" value={stats.tools} icon="🔧" />
              <StatCard label="会话" value={stats.sessions} icon="💬" />
              <StatCard label="知识条目" value={stats.knowledge} icon="📚" />
              <StatCard label="定时任务" value={stats.cronTasks} icon="⏰" />
              <StatCard label="消息渠道" value={stats.channels} icon="📡" />
              <StatCard label="Agent 任务" value={stats.agentTasks} icon="⚙️" />
              <StatCard label="伙伴等级" value={stats.buddy?.level ?? '-'} icon="🌟" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BackendCard stats={stats} />
              {stats.buddy && <BuddyDashboardCard buddy={stats.buddy} />}
            </div>
          </div>
        )}

        {loading && !stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SkeletonCard count={8} />
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
