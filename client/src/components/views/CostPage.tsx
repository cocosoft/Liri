import { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { costService, mockCostSummary, mockCostRecords, CostRecord, CostSummary } from '../../services/costService';

function CostPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';
  const [summary, setSummary] = useState<CostSummary>(mockCostSummary);
  const [records] = useState<CostRecord[]>(mockCostRecords);
  const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  useEffect(() => {
    loadConfig();
    fetchData();
  }, [loadConfig]);

  const fetchData = async () => {
    try {
      const data = await costService.getCostSummary();
      setSummary(data);
    } catch {
      setSummary(mockCostSummary);
    }
  };

  const maxDailyCost = Math.max(...summary.dailyBreakdown.map((d) => d.cost));

  const formatCurrency = (value: number) => {
    return `$${value.toFixed(2)}`;
  };

  const formatTokens = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(2)}M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  };

  const stats = [
    { label: '今日成本', value: formatCurrency(summary.todayCost), sublabel: `${formatTokens(summary.todayTokens)} tokens` },
    { label: '本周成本', value: formatCurrency(summary.weeklyCost), sublabel: '7天累计' },
    { label: '本月成本', value: formatCurrency(summary.monthlyCost), sublabel: `${formatTokens(summary.monthlyTokens)} tokens` },
    { label: '本年成本', value: formatCurrency(summary.yearlyCost), sublabel: '12个月累计' },
  ];

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              成本监控
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              实时追踪AI服务消费情况
            </p>
          </div>
          <div className="flex gap-2">
            {(['daily', 'weekly', 'monthly'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedPeriod === period
                    ? 'bg-blue-600 text-white'
                    : isDark
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {period === 'daily' ? '今日' : period === 'weekly' ? '本周' : '本月'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {stats.map((stat, index) => (
            <div
              key={index}
              className={`rounded-lg border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
            >
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {stat.label}
              </p>
              <p className={`text-xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                {stat.value}
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {stat.sublabel}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
            <h3 className={`text-lg font-medium mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              成本分布
            </h3>
            <div className="flex items-center justify-center">
              <svg viewBox="0 0 200 200" className="w-48 h-48">
                {(() => {
                  let cumulativeAngle = 0;
                  const colors = ['#3B82F6', '#8B5CF6', '#06B6D4', '#F59E0B'];
                  return summary.topProviders.map((provider, index) => {
                    const startAngle = cumulativeAngle;
                    const angle = (provider.percentage / 100) * 360;
                    cumulativeAngle += angle;
                    const startRad = ((startAngle - 90) * Math.PI) / 180;
                    const endRad = ((startAngle + angle - 90) * Math.PI) / 180;
                    const x1 = 100 + 80 * Math.cos(startRad);
                    const y1 = 100 + 80 * Math.sin(startRad);
                    const x2 = 100 + 80 * Math.cos(endRad);
                    const y2 = 100 + 80 * Math.sin(endRad);
                    const largeArcFlag = angle > 180 ? 1 : 0;
                    return (
                      <path
                        key={provider.provider}
                        d={`M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
                        fill={colors[index % colors.length]}
                        className="transition-opacity hover:opacity-75"
                      />
                    );
                  });
                })()}
                <circle cx="100" cy="100" r="50" fill={isDark ? '#1F2937' : '#FFFFFF'} />
                <text x="100" y="95" textAnchor="middle" className="fill-gray-400 text-xs">
                  总计
                </text>
                <text x="100" y="110" textAnchor="middle" className="fill-gray-300 text-sm font-bold">
                  {formatCurrency(summary.monthlyCost)}
                </text>
              </svg>
            </div>
            <div className="mt-4 space-y-2">
              {summary.topProviders.map((provider, index) => (
                <div key={provider.provider} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: ['#3B82F6', '#8B5CF6', '#06B6D4', '#F59E0B'][index] }}
                  />
                  <span className={`flex-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {provider.provider}
                  </span>
                  <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatCurrency(provider.cost)}
                  </span>
                  <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {provider.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
            <h3 className={`text-lg font-medium mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              每日成本趋势
            </h3>
            <div className="h-48 flex items-end justify-between gap-2 px-2">
              {summary.dailyBreakdown.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-400"
                    style={{ height: `${(day.cost / maxDailyCost) * 100}%`, minHeight: '4px' }}
                  />
                  <span className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {day.date}
                  </span>
                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    ${day.cost.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              消费记录
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={isDark ? 'bg-gray-700' : 'bg-gray-50'}>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    时间
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    提供商
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    模型
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    Prompt
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    Completion
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    总计
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    成本
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-300">
                      {record.date}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        record.provider === 'OpenAI'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : record.provider === 'Anthropic'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {record.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-300">
                      {record.model}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {formatTokens(record.promptTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">
                      {formatTokens(record.completionTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-gray-300">
                      {formatTokens(record.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                      ${record.cost.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CostPage;