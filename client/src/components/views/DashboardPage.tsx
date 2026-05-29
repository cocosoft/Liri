import { useEffect, useState, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { statsService, type DashboardStats } from '../../services/statsService';
import { monitorService, type MonitorSummary } from '../../services/monitorService';
import { SkeletonCard } from '../common/Skeleton';
import { SPECIES_MAP } from '../Buddy/buddySprites';
import { sseService } from '../../services/sseService';

interface ResourceBarProps {
  label: string;
  percent: number;
  color: string;
  icon: string;
}

const ResourceBar = memo(function ResourceBar({ label, percent, color, icon }: ResourceBarProps) {
  const getColor = () => {
    if (percent > 80) return 'bg-red-500';
    if (percent > 60) return 'bg-yellow-500';
    return color;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        </div>
        <span className="text-sm font-bold text-gray-900 dark:text-white">{percent.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getColor()}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
});

interface StatCardProps {
  label: string;
  value: number | string;
  icon: string;
  trend?: 'up' | 'down' | 'stable';
}

const StatCard = memo(function StatCard({ label, value, icon, trend }: StatCardProps) {
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const trendColor = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-400';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {value}
          </p>
          {trend && (
            <span className={`text-xs mt-0.5 inline-flex items-center gap-0.5 ${trendColor}`}>
              {trendIcon} 较昨日
            </span>
          )}
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
});

const BackendCard = memo(function BackendCard({ stats }: { stats: DashboardStats }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Backend 服务</h4>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
          stats.backend.running
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
        }`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
            stats.backend.running ? 'bg-green-500' : 'bg-gray-400'
          }`} />
          {stats.backend.running ? '运行中' : '已停止'}
        </span>
      </div>
      {stats.backend.running && (
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
            <span className="block text-gray-400">端口</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{stats.backend.port}</span>
          </div>
          {stats.backend.pid && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
              <span className="block text-gray-400">PID</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{stats.backend.pid}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const BuddyCard = memo(function BuddyCard({ buddy }: { buddy: NonNullable<DashboardStats['buddy']> }) {
  const speciesInfo = SPECIES_MAP[buddy.species as keyof typeof SPECIES_MAP];
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">伙伴</h4>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl">{speciesInfo?.emoji || '🦆'}</span>
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{buddy.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{buddy.species} · {buddy.rarity}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
          <span className="block text-gray-400">等级</span>
          <span className="font-bold text-gray-900 dark:text-white">{buddy.level}</span>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
          <span className="block text-gray-400">经验值</span>
          <span className="font-bold text-gray-900 dark:text-white">{buddy.xp}</span>
        </div>
      </div>
    </div>
  );
});

function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, monitorSummary] = await Promise.all([
        statsService.getDashboardStats(),
        monitorService.getSummary().catch(() => null),
      ]);
      setStats(statsData);
      setSummary(monitorSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载仪表盘数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    sseService.connect();
    const handler = () => fetchData();
    sseService.on('heartbeat', handler);
    return () => {
      sseService.off('heartbeat', handler);
    };
  }, [fetchData]);

  const getUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}天 ${h}小时`;
    if (h > 0) return `${h}小时 ${m}分钟`;
    return `${m}分钟`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">仪表盘</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">系统概览与状态监控</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {loading ? '刷新中...' : '刷新'}
            </button>
            <button
              onClick={() => navigate('/chat')}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              开始聊天
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 系统资源（带进度条） */}
        {summary && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <span>📊</span> 系统资源
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ResourceBar
                label="CPU 使用率"
                percent={summary.cpuPercent}
                color="bg-blue-500"
                icon="🖥️"
              />
              <ResourceBar
                label="内存使用率"
                percent={summary.memoryPercent}
                color="bg-purple-500"
                icon="🧠"
              />
            </div>
          </div>
        )}

        {/* 统计卡片 */}
        {stats && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <span>📈</span> 数据概览
              </h3>
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
            </div>

            {/* 服务状态 + 伙伴 */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <span>🔌</span> 服务状态
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BackendCard stats={stats} />
                {stats.buddy && <BuddyCard buddy={stats.buddy} />}
              </div>
            </div>

            {/* 运行信息 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <span>ℹ️</span> 运行信息
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="block text-gray-400">运行时间</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {summary ? getUptime(summary.uptime) : '--'}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-400">请求总数</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {summary ? summary.requestCount.toLocaleString() : '--'}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-400">错误数</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {summary ? summary.errorCount : '--'}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-400">平均响应时间</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {summary ? `${summary.avgResponseTime.toFixed(0)}ms` : '--'}
                  </span>
                </div>
              </div>
            </div>

            {/* 快捷入口 */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
                <span>🚀</span> 快捷入口
              </h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => navigate('/chat')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">💬 聊天</button>
                <button onClick={() => navigate('/knowledge')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">📚 知识库</button>
                <button onClick={() => navigate('/cost')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">💰 成本</button>
                <button onClick={() => navigate('/cron')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">🎯 任务</button>
                <button onClick={() => navigate('/monitor')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">📈 监控</button>
                <button onClick={() => navigate('/settings')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">⚙️ 设置</button>
              </div>
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