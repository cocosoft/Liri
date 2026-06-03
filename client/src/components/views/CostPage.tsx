import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { costService, type CostSummary, type CostRecord } from '../../services/costService';

const UsageStatsPanel = lazy(() => import('../usage/UsageStatsPanel'));
const PricingPanel = lazy(() => import('../usage/PricingPanel'));

function formatCost(value: number | undefined | null): string {
  if (value == null) return '$0.00';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatTokens(value: number | undefined | null): string {
  if (value == null) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

function CostPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [activeTab, setActiveTab] = useState<'cost' | 'usage' | 'pricing'>('cost');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, recordsData] = await Promise.all([
        costService.getCostSummary(),
        costService.getCostRecords(recordsPage, 20),
      ]);
      setSummary(summaryData);
      setRecords(recordsData.records);
      setRecordsTotal(recordsData.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [recordsPage]);

  useEffect(() => {
    loadConfig();
    fetchData();
  }, [loadConfig, fetchData]);

  const handlePageChange = (page: number) => {
    setRecordsPage(page);
  };

  if (loading && !summary) {
    return (
      <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="max-w-6xl mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>加载中...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="max-w-6xl mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-red-500">加载失败: {error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const maxDailyCost = Math.max(...summary.dailyBreakdown.map((d) => d.cost), 0.001);
  const maxDailyTokens = Math.max(...summary.dailyBreakdown.map((d) => d.tokens), 1);
  const totalPages = Math.ceil(recordsTotal / 20);
  const pieColors = ['#3B82F6', '#8B5CF6', '#06B6D4', '#F59E0B', '#EF4444', '#10B981', '#EC4899', '#6366F1'];

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto p-6">
        {/* 页面标题 + Tab 切换 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              成本与 Token 监控
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              实时追踪 AI 服务消费情况和 Token 消耗
            </p>
          </div>
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <button onClick={() => setActiveTab('cost')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === 'cost' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
              成本监控
            </button>
            <button onClick={() => setActiveTab('usage')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === 'usage' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
              使用量统计
            </button>
            <button onClick={() => setActiveTab('pricing')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === 'pricing' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
              定价管理
            </button>
          </div>
        </div>

        {activeTab === 'usage' ? (
          <Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">加载中...</div>}>
            <UsageStatsPanel />
          </Suspense>
        ) : activeTab === 'pricing' ? (
          <Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">加载中...</div>}>
            <PricingPanel />
          </Suspense>
        ) : (
          <>
          <div className="flex gap-2 mb-4">
            {(['daily', 'weekly', 'monthly'] as const).map((period) => (
              <button key={period} onClick={() => setSelectedPeriod(period)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedPeriod === period
                    ? 'bg-blue-600 text-white'
                    : isDark ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}>
                {period === 'daily' ? '今日' : period === 'weekly' ? '本周' : '本月'}
              </button>
            ))}
          </div>

          {/* 成本统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>今日成本</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatCost(summary.todayCost)}</p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{formatTokens(summary.todayTokens)} tokens</p>
            </div>
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>本周成本</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatCost(summary.weeklyCost)}</p>
            </div>
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>本月成本</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatCost(summary.monthlyCost)}</p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{formatTokens(summary.monthlyTokens)} tokens</p>
            </div>
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>当前会话</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatCost(summary.sessionCost)}</p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{formatTokens(summary.sessionTokens)} tokens</p>
            </div>
          </div>

          {/* Token 明细 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>累计输入 Tokens</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatTokens(summary.totalInputTokens)}</p>
            </div>
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>累计输出 Tokens</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatTokens(summary.totalOutputTokens)}</p>
            </div>
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>缓存读取 Tokens</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{formatTokens(summary.totalCacheReadTokens)}</p>
            </div>
            <div className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>总请求数</p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{summary.totalRequests}</p>
            </div>
          </div>

          {/* 图表 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
              <h3 className={`text-lg font-medium mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>模型成本分布</h3>
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  <svg viewBox="0 0 200 200" className="w-44 h-44">
                    {(() => {
                      let cumulativeAngle = 0;
                      return summary.topProviders.slice(0, 6).map((provider, index) => {
                        const startAngle = cumulativeAngle;
                        const angle = (provider.percentage / 100) * 360;
                        cumulativeAngle += angle;
                        if (angle <= 0) return null;
                        const startRad = ((startAngle - 90) * Math.PI) / 180;
                        const endRad = ((startAngle + angle - 90) * Math.PI) / 180;
                        const x1 = 100 + 80 * Math.cos(startRad);
                        const y1 = 100 + 80 * Math.sin(startRad);
                        const x2 = 100 + 80 * Math.cos(endRad);
                        const y2 = 100 + 80 * Math.sin(endRad);
                        const largeArcFlag = angle > 180 ? 1 : 0;
                        return (
                          <path key={provider.provider}
                            d={`M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
                            fill={pieColors[index % pieColors.length]} className="transition-opacity hover:opacity-75" />
                        );
                      });
                    })()}
                    <circle cx="100" cy="100" r="50" fill={isDark ? '#1F2937' : '#FFFFFF'} />
                    <text x="100" y="95" textAnchor="middle" className="fill-gray-400 text-xs">月成本</text>
                    <text x="100" y="112" textAnchor="middle" className="fill-gray-300 text-sm font-bold">{formatCost(summary.monthlyCost)}</text>
                  </svg>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {summary.topProviders.slice(0, 6).map((provider, index) => (
                    <div key={provider.provider} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: pieColors[index % pieColors.length] }} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{provider.provider}</div>
                        <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{formatTokens(provider.totalTokens)} tokens · {formatCost(provider.cost)}</div>
                      </div>
                      <div className={`text-xs font-medium flex-shrink-0 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{provider.percentage}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
              <h3 className={`text-lg font-medium mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>每日成本与 Token 趋势</h3>
              <div className="h-52 flex items-end justify-between gap-1.5 px-2">
                {summary.dailyBreakdown.map((day) => (
                  <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full">
                    <span className={`text-[10px] mb-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatCost(day.cost)}</span>
                    <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '120px' }}>
                      <div className="w-1/2 bg-blue-500 rounded-t" style={{ height: `${Math.max((day.cost / maxDailyCost) * 100, 2)}%`, opacity: 0.8 }} />
                      <div className="w-1/2 bg-emerald-500 rounded-t" style={{ height: `${Math.max((day.tokens / maxDailyTokens) * 100, 2)}%`, opacity: 0.6 }} />
                    </div>
                    <span className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{day.date}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 模型消费明细 */}
          <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} mb-6`}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>各模型消耗明细</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={isDark ? 'bg-gray-700' : 'bg-gray-50'}>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">模型</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">输入</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">输出</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">总 Tokens</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">缓存</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">请求</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">成本</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">占比</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {summary.topProviders.map((provider) => (
                    <tr key={provider.provider} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">{provider.provider}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{formatTokens(provider.inputTokens)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{formatTokens(provider.outputTokens)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-300">{formatTokens(provider.totalTokens)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{provider.cacheReadTokens > 0 ? formatTokens(provider.cacheReadTokens) : '-'}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{provider.requests}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">{formatCost(provider.cost)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{provider.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 消费记录表 */}
          <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>消费记录</h3>
              <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>共 {recordsTotal} 条记录</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={isDark ? 'bg-gray-700' : 'bg-gray-50'}>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">时间</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">模型</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">输入</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">输出</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">总 Tokens</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">缓存</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">成本</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {records.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{new Date(record.date).toLocaleDateString('zh-CN')}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">{record.model}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{formatTokens(record.promptTokens)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{formatTokens(record.completionTokens)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-300">{formatTokens(record.totalTokens)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{record.cacheReadTokens > 0 ? formatTokens(record.cacheReadTokens) : '-'}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">{formatCost(record.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>第 {recordsPage} / {totalPages} 页</div>
                <div className="flex gap-2">
                  <button onClick={() => handlePageChange(recordsPage - 1)} disabled={recordsPage <= 1}
                    className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600">上一页</button>
                  <button onClick={() => handlePageChange(recordsPage + 1)} disabled={recordsPage >= totalPages}
                    className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600">下一页</button>
                </div>
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CostPage;
