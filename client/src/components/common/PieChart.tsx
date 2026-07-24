// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PieChart — 纯 SVG 饼图（从 CostPage.tsx L357-407 的内联 IIFE 提取）
 * 零依赖。后续如需交互再评估图表库。
 * Props: { data, centerLabel?, centerValue?, size?, maxSlices? }
 */
export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

export interface PieChartProps {
  data: PieSlice[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
  maxSlices?: number;
}

export function PieChart({
  data,
  centerLabel,
  centerValue,
  size = 200,
  maxSlices = 6,
}: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const slices = data.slice(0, maxSlices);
  const radius = size * 0.4;
  const cx = size / 2;
  const cy = size / 2;

  let cumulativeAngle = 0;

  return (
    <div className="flex items-start gap-6">
      <div className="flex-shrink-0">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-44 h-44">
          {slices.map((slice) => {
            const angle = (slice.value / total) * 360;
            const startAngle = cumulativeAngle;
            cumulativeAngle += angle;
            if (angle <= 0) return null;
            const startRad = ((startAngle - 90) * Math.PI) / 180;
            const endRad = ((startAngle + angle - 90) * Math.PI) / 180;
            const x1 = cx + radius * Math.cos(startRad);
            const y1 = cy + radius * Math.sin(startRad);
            const x2 = cx + radius * Math.cos(endRad);
            const y2 = cy + radius * Math.sin(endRad);
            const largeArcFlag = angle > 180 ? 1 : 0;
            return (
              <path
                key={slice.label}
                d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
                fill={slice.color}
                className="transition-opacity hover:opacity-75"
              />
            );
          })}
          <circle
            cx={cx}
            cy={cy}
            r={size * 0.25}
            fill="var(--tw-bg, #FFFFFF)"
            className="fill-white dark:fill-gray-800"
          />
          {centerLabel && (
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              className="fill-gray-400 text-xs"
            >
              {centerLabel}
            </text>
          )}
          {centerValue && (
            <text
              x={cx}
              y={cy + 8}
              textAnchor="middle"
              className="fill-gray-300 text-sm font-bold"
            >
              {centerValue}
            </text>
          )}
        </svg>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {slices.map((slice) => {
          const pct = ((slice.value / total) * 100).toFixed(0);
          return (
            <div key={slice.label} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: slice.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate text-gray-700 dark:text-gray-300">
                  {slice.label}
                </div>
              </div>
              <div className="text-xs font-medium flex-shrink-0 text-gray-700 dark:text-gray-300">
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
