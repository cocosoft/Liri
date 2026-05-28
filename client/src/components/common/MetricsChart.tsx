import { useMemo } from 'react';
import type { MetricPoint } from '../../types';

interface MetricsChartProps {
  title: string;
  data: MetricPoint[];
  valueFormatter?: (value: number) => string;
  color?: string;
  isDark?: boolean;
  height?: number;
  showArea?: boolean;
}

function MetricsChart({
  title,
  data,
  valueFormatter = (v) => v.toFixed(1),
  color = '#3B82F6',
  isDark = false,
  height = 120,
  showArea = true,
}: MetricsChartProps) {
  const { path, areaPath } = useMemo(() => {
    if (!data || data.length === 0) {
      return { path: '', areaPath: '', maxValue: 0, minValue: 0, points: [] };
    }

    const values = data.map((d) => d.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    const padding = 4;
    const chartWidth = 100;
    const chartHeight = 100;

    const pts = data.map((point, index) => {
      const x = padding + (index / (data.length - 1 || 1)) * (chartWidth - padding * 2);
      const y = padding + (1 - (point.value - min) / range) * (chartHeight - padding * 2);
      return { x, y, value: point.value, timestamp: point.timestamp };
    });

    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    const areaD = pts.length > 0
      ? `${pathD} L ${pts[pts.length - 1].x} ${chartHeight - padding} L ${pts[0].x} ${chartHeight - padding} Z`
      : '';

    return {
      path: pathD,
      areaPath: areaD,
      maxValue: max,
      minValue: min,
      points: pts,
    };
  }, [data]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  if (!data || data.length === 0) {
    return (
      <div className={`p-4 rounded-xl border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <h3 className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'} mb-4`}>
          {title}
        </h3>
        <div className={`flex items-center justify-center h-${height} ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {title}
        </h3>
        <span className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
          {valueFormatter(data[data.length - 1]?.value ?? 0)}
        </span>
      </div>
      <svg
        viewBox={`0 0 100 ${height / 2}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        {showArea && areaPath && (
          <defs>
            <linearGradient id={`gradient-${title}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        {showArea && (
          <path
            d={areaPath}
            fill={`url(#gradient-${title})`}
          />
        )}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className={`flex justify-between mt-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        <span>{formatTime(data[0]?.timestamp ?? 0)}</span>
        <span>{formatTime(data[data.length - 1]?.timestamp ?? 0)}</span>
      </div>
    </div>
  );
}

export default MetricsChart;