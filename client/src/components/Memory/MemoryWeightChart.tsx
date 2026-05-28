import { useMemo } from 'react';
import type { MemoryWeight, MemoryType } from '../../services/memoryService';

interface MemoryWeightChartProps {
  weights: MemoryWeight[];
  isDark: boolean;
}

const TYPE_COLORS: Record<MemoryType, string> = {
  user_preference: '#3B82F6',
  project_context: '#10B981',
  conversation: '#8B5CF6',
  knowledge: '#F59E0B',
  system: '#6B7280',
};

const TYPE_LABELS: Record<MemoryType, string> = {
  user_preference: '用户偏好',
  project_context: '项目上下文',
  conversation: '对话记录',
  knowledge: '知识库',
  system: '系统',
};

function MemoryWeightChart({ weights, isDark }: MemoryWeightChartProps) {
  const maxWeight = useMemo(() => {
    return Math.max(...weights.map((w) => w.totalWeight), 1);
  }, [weights]);

  const totalWeight = useMemo(() => {
    return weights.reduce((sum, w) => sum + w.totalWeight, 0);
  }, [weights]);

  const totalCount = useMemo(() => {
    return weights.reduce((sum, w) => sum + w.count, 0);
  }, [weights]);

  if (weights.length === 0) {
    return (
      <div className={`p-4 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <h3 className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          📊 记忆权重分布
        </h3>
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>暂无数据</p>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        📊 记忆权重分布
      </h3>

      <div className="space-y-3">
        {weights.map((weight) => {
          const percentage = ((weight.totalWeight / maxWeight) * 100).toFixed(1);
          const totalPercentage = totalWeight > 0 ? ((weight.totalWeight / totalWeight) * 100).toFixed(1) : '0';

          return (
            <div key={weight.type}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>
                  {TYPE_LABELS[weight.type]}
                </span>
                <div className="flex items-center gap-3">
                  <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                    {weight.count} 条
                  </span>
                  <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                    {totalPercentage}%
                  </span>
                </div>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: TYPE_COLORS[weight.type],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className={`mt-4 pt-3 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between text-sm">
          <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>总记忆数</span>
          <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>{totalCount}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1">
          <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>总权重值</span>
          <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>{totalWeight}</span>
        </div>
      </div>
    </div>
  );
}

export default MemoryWeightChart;