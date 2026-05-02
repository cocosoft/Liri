/**
 * 图表组件
 * 支持折线图、柱状图等基础图表
 */

import React, { useMemo } from 'react';

export type ChartType = 'line' | 'bar' | 'pie' | 'area';

export interface ChartDataPoint {
  label: string;
  value: number;
}

export interface ChartProps {
  type: ChartType;
  data: ChartDataPoint[];
  title?: string;
  colors?: string[];
  showLegend?: boolean;
  showLabels?: boolean;
}

export const Chart: React.FC<ChartProps> = ({
  type,
  data,
  title,
  colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
  showLegend = true,
  showLabels = true,
}) => {
  // 计算最大值
  const maxValue = useMemo(() => {
    return Math.max(...data.map(d => d.value), 1);
  }, [data]);

  // 获取颜色
  const getColor = (index: number) => {
    return colors[index % colors.length];
  };

  // 渲染折线图
  const renderLineChart = () => {
    const width = 400;
    const height = 200;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = data.map((d, i) => ({
      x: padding + (i / (data.length - 1)) * chartWidth,
      y: padding + chartHeight - (d.value / maxValue) * chartHeight,
      value: d.value,
      label: d.label,
    }));

    const linePath = points.map((p, i) => 
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ');

    const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding + chartHeight} L ${padding} ${padding + chartHeight} Z`;

    return (
      <svg width={width} height={height} className="mx-auto">
        {/* 网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <line
            key={i}
            x1={padding}
            y1={padding + chartHeight * ratio}
            x2={width - padding}
            y2={padding + chartHeight * ratio}
            stroke="#E5E7EB"
            strokeDasharray="4"
          />
        ))}

        {/* 区域填充 */}
        <path
          d={areaPath}
          fill="url(#areaGradient)"
          opacity="0.3"
        />

        {/* 渐变定义 */}
        <defs>
          <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={getColor(0)} />
            <stop offset="100%" stopColor={getColor(0)} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 折线 */}
        <path
          d={linePath}
          fill="none"
          stroke={getColor(0)}
          strokeWidth="2"
        />

        {/* 数据点 */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="4"
              fill={getColor(0)}
              className="cursor-pointer hover:r-6 transition-all"
            />
            {showLabels && (
              <text
                x={p.x}
                y={p.y - 10}
                textAnchor="middle"
                className="text-xs fill-gray-600"
              >
                {p.value}
              </text>
            )}
          </g>
        ))}

        {/* X轴标签 */}
        {data.map((d, i) => (
          <text
            key={i}
            x={padding + (i / (data.length - 1)) * chartWidth}
            y={height - 10}
            textAnchor="middle"
            className="text-xs fill-gray-500"
          >
            {d.label}
          </text>
        ))}

        {/* Y轴标签 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <text
            key={i}
            x={padding - 10}
            y={padding + chartHeight * ratio + 4}
            textAnchor="end"
            className="text-xs fill-gray-500"
          >
            {Math.round(maxValue * (1 - ratio))}
          </text>
        ))}
      </svg>
    );
  };

  // 渲染柱状图
  const renderBarChart = () => {
    const width = 400;
    const height = 200;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const barWidth = (chartWidth / data.length) * 0.7;
    const barGap = (chartWidth / data.length) * 0.3;

    return (
      <svg width={width} height={height} className="mx-auto">
        {/* 网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <line
            key={i}
            x1={padding}
            y1={padding + chartHeight * ratio}
            x2={width - padding}
            y2={padding + chartHeight * ratio}
            stroke="#E5E7EB"
            strokeDasharray="4"
          />
        ))}

        {/* 柱子 */}
        {data.map((d, i) => {
          const barHeight = (d.value / maxValue) * chartHeight;
          const x = padding + i * (barWidth + barGap) + barGap / 2;
          const y = padding + chartHeight - barHeight;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={getColor(i)}
                rx="4"
                className="cursor-pointer hover:opacity-80 transition-opacity"
              />
              {showLabels && (
                <text
                  x={x + barWidth / 2}
                  y={y - 10}
                  textAnchor="middle"
                  className="text-xs fill-gray-600"
                >
                  {d.value}
                </text>
              )}
            </g>
          );
        })}

        {/* X轴标签 */}
        {data.map((d, i) => (
          <text
            key={i}
            x={padding + i * (barWidth + barGap) + barWidth / 2}
            y={height - 10}
            textAnchor="middle"
            className="text-xs fill-gray-500"
          >
            {d.label}
          </text>
        ))}

        {/* Y轴标签 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <text
            key={i}
            x={padding - 10}
            y={padding + chartHeight * ratio + 4}
            textAnchor="end"
            className="text-xs fill-gray-500"
          >
            {Math.round(maxValue * (1 - ratio))}
          </text>
        ))}
      </svg>
    );
  };

  // 渲染饼图
  const renderPieChart = () => {
    const size = 200;
    const center = size / 2;
    const radius = 70;

    const total = data.reduce((sum, d) => sum + d.value, 0);
    let currentAngle = -Math.PI / 2;

    const slices = data.map((d, i) => {
      const angle = (d.value / total) * 2 * Math.PI;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle = endAngle;

      const x1 = center + radius * Math.cos(startAngle);
      const y1 = center + radius * Math.sin(startAngle);
      const x2 = center + radius * Math.cos(endAngle);
      const y2 = center + radius * Math.sin(endAngle);

      const largeArcFlag = angle > Math.PI ? 1 : 0;

      const pathData = [
        `M ${center} ${center}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        'Z',
      ].join(' ');

      return { pathData, color: getColor(i), value: d.value, label: d.label };
    });

    return (
      <div className="flex items-center gap-8">
        <svg width={size} height={size} className="mx-auto">
          {slices.map((slice, i) => (
            <path
              key={i}
              d={slice.pathData}
              fill={slice.color}
              className="cursor-pointer hover:opacity-80 transition-opacity"
            />
          ))}
          {/* 中心圆 */}
          <circle cx={center} cy={center} r="30" fill="white" />
          <text
            x={center}
            y={center - 5}
            textAnchor="middle"
            className="text-sm font-semibold fill-gray-800"
          >
            Total
          </text>
          <text
            x={center}
            y={center + 12}
            textAnchor="middle"
            className="text-lg font-bold fill-blue-600"
          >
            {total}
          </text>
        </svg>

        {/* 图例 */}
        {showLegend && (
          <div className="space-y-2">
            {slices.map((slice, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-sm text-gray-600">{slice.label}</span>
                <span className="text-sm font-medium text-gray-800">{slice.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 渲染面积图（与折线图类似但有填充）
  const renderAreaChart = () => {
    return renderLineChart();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      {title && (
        <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      )}
      
      {type === 'line' && renderLineChart()}
      {type === 'bar' && renderBarChart()}
      {type === 'pie' && renderPieChart()}
      {type === 'area' && renderAreaChart()}
    </div>
  );
};

/**
 * 创建图表组件
 */
export function createChart(props: ChartProps): React.ReactElement {
  return <Chart {...props} />;
}
