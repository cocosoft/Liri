import { useEffect, useState } from 'react';
import { useMonitorStore } from '../../stores/monitorStore';
import { useConfigStore } from '../../stores/configStore';
import StatusCard from '../common/StatusCard';
import MetricsChart from '../common/MetricsChart';

function MonitorPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === 'dark';

  const {
    metrics,
    summary,
    alerts,
    systemHealth,
    error,
    fetchMetrics,
    fetchSummary,
    fetchAlerts,
    fetchSystemHealth,
    acknowledgeAlert,
  } = useMonitorStore();

  const [timeRange, setTimeRange] = useState(3600000);
  const [filterLevel, setFilterLevel] = useState<string>('all');

  useEffect(() => {
    fetchMetrics(timeRange);
    fetchSummary();
    fetchAlerts();
    fetchSystemHealth();

    const interval = setInterval(() => {
      fetchMetrics(timeRange);
      fetchSummary();
      fetchAlerts();
      fetchSystemHealth();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchMetrics, fetchSummary, fetchAlerts, fetchSystemHealth, timeRange]);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
  };

  const filteredAlerts = filterLevel === 'all'
    ? alerts.filter((a) => !a.acknowledged)
    : alerts.filter((a) => a.level === filterLevel && !a.acknowledged);

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              系统监控
            </h1>
            <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              实时监控系统运行状态
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(Number(e.target.value))}
              className={`px-3 py-2 text-sm rounded-lg border ${
                isDark ? 'bg-gray-800 border-gray-600 text-gray-300' : 'bg-white border-gray-300 text-gray-700'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value={300000}>最近5分钟</option>
              <option value={1800000}>最近30分钟</option>
              <option value={3600000}>最近1小时</option>
              <option value={86400000}>最近24小时</option>
            </select>
          </div>
        </div>

        {error && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${isDark ? 'bg-red-900/30 text-red-400 border border-red-800' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatusCard
            title="运行时间"
            value={summary ? formatUptime(summary.uptime) : '--'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            isDark={isDark}
          />
          <StatusCard
            title="CPU 使用率"
            value={summary ? `${summary.cpuPercent.toFixed(1)}%` : '--'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
            status={summary && summary.cpuPercent > 80 ? 'warning' : 'normal'}
            isDark={isDark}
          />
          <StatusCard
            title="内存使用率"
            value={summary ? `${summary.memoryPercent.toFixed(1)}%` : '--'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>}
            status={summary && summary.memoryPercent > 70 ? 'warning' : 'normal'}
            isDark={isDark}
          />
          <StatusCard
            title="请求量"
            value={summary?.requestCount ?? '--'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
            isDark={isDark}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
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

        <div className={`rounded-lg border mb-6 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
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
                      onClick={() => acknowledgeAlert(alert.id)}
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
    </div>
  );
}

export default MonitorPage;