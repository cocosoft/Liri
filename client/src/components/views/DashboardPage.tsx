import { useEffect, useState, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { statsService, type DashboardStats } from '../../services/statsService';
import { monitorService, type MetricsData } from '../../services/monitorService';
import type { Alert, SystemHealth } from '../../types';
import { SkeletonCard } from '../common/Skeleton';
import { SPECIES_MAP } from '../Buddy/buddySprites';
import { sseService } from '../../services/sseService';
import { useConfigStore } from '../../stores/configStore';
import MetricsChart from '../common/MetricsChart';

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
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === 'dark';
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showMonitor, setShowMonitor] = useState(false);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [timeRange, setTimeRange] = useState(3600000);
  const [filterLevel, setFilterLevel] = useState<string>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statsData = await statsService.getDashboardStats();
      setStats(statsData);
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

  useEffect(() => {
    if (!showMonitor) return;
    const fetchMonitorData = async () => {
      try {
        const [metricsData, alertsData, healthData] = await Promise.all([
          monitorService.getMetrics(timeRange),
          monitorService.getAlerts(),
          monitorService.getSystemHealth(),
        ]);
        setMetrics(metricsData);
        setAlerts(alertsData);
        setSystemHealth(healthData);
      } catch {
        // 静默失败
      }
    };
    fetchMonitorData();
    const interval = setInterval(fetchMonitorData, 30000);
    return () => clearInterval(interval);
  }, [showMonitor, timeRange]);

  const filteredAlerts = filterLevel === 'all'
    ? alerts.filter((a) => !a.acknowledged)
    : alerts.filter((a) => a.level === filterLevel && !a.acknowledged);

  const handleAcknowledge = async (id: string) => {
    try {
      await monitorService.acknowledgeAlert(id);
      setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
    } catch {
      // 静默失败
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">仪表盘</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">系统概览</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowMonitor((v) => !v)}
              className={`px-3 py-1.5 text-sm border rounded ${
                showMonitor
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
              }`}
            >
              {showMonitor ? '收起监控' : '展开监控'}
            </button>
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

            {stats.buddy && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <span>🦆</span> 伙伴
                </h3>
                <div className="max-w-sm">
                  <BuddyCard buddy={stats.buddy} />
                </div>
              </div>
            )}

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
                <span>🚀</span> 快捷入口
              </h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => navigate('/chat')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">💬 聊天</button>
                <button onClick={() => navigate('/knowledge')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">📚 知识库</button>
                <button onClick={() => navigate('/cost')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">💰 成本</button>
                <button onClick={() => navigate('/cron')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">🎯 任务</button>
                <button onClick={() => navigate('/settings')} className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors">⚙️ 设置</button>
              </div>
            </div>

            {showMonitor && (
              <div className="space-y-6">
                <div className="flex items-center justify-end">
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(Number(e.target.value))}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${
                      isDark ? 'bg-gray-800 border-gray-600 text-gray-300' : 'bg-white border-gray-300 text-gray-700'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    <option value={300000}>最近5分钟</option>
                    <option value={1800000}>最近30分钟</option>
                    <option value={3600000}>最近1小时</option>
                    <option value={86400000}>最近24小时</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricsChart
                    title="请求量趋势"
                    data={metrics?.requests ?? []}
                    valueFormatter={(v) => `${v.toFixed(0)}`}
                    color="#3B82F6"
                    isDark={isDark}
                  />
                  <MetricsChart
                    title="响应时间 (ms)"
                    data={metrics?.responseTime ?? []}
                    valueFormatter={(v) => `${v.toFixed(0)}ms`}
                    color="#10B981"
                    isDark={isDark}
                  />
                </div>

                <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        🔴 告警列表
                      </h2>
                      <select
                        value={filterLevel}
                        onChange={(e) => setFilterLevel(e.target.value)}
                        className={`px-3 py-1.5 text-sm rounded-lg border ${
                          isDark ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-gray-300 text-gray-700'
                        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      >
                        <option value="all">全部未确认</option>
                        <option value="critical">严重</option>
                        <option value="error">错误</option>
                        <option value="warn">警告</option>
                        <option value="info">信息</option>
                      </select>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredAlerts.length === 0 ? (
                      <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        暂无未确认的告警
                      </div>
                    ) : (
                      filteredAlerts.map((alert) => (
                        <div key={alert.id} className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              alert.level === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                              alert.level === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' :
                              alert.level === 'warn' ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400' :
                              'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                            }`}>
                              {alert.level.toUpperCase()}
                            </span>
                            <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                              {alert.message}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {new Date(alert.timestamp).toLocaleString('zh-CN')}
                            </span>
                            <button
                              onClick={() => handleAcknowledge(alert.id)}
                              className={`px-3 py-1 text-sm rounded-lg border ${
                                isDark ? 'border-gray-600 text-gray-400 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              确认
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      🏥 系统健康报告
                    </h2>
                  </div>
                  <div className="p-4">
                    {systemHealth ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {systemHealth.components.map((component) => (
                          <div
                            key={component.name}
                            className={`p-3 rounded-lg border ${
                              component.status === 'ok'
                                ? isDark ? 'bg-green-900/20 border-green-800' : 'bg-green-50 border-green-200'
                                : component.status === 'warning'
                                ? isDark ? 'bg-yellow-900/20 border-yellow-800' : 'bg-yellow-50 border-yellow-200'
                                : isDark ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-2 h-2 rounded-full ${
                                component.status === 'ok' ? 'bg-green-500' :
                                component.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                              }`} />
                              <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                {component.name}
                              </span>
                            </div>
                            {component.message && (
                              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                                {component.message}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        加载中...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
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
