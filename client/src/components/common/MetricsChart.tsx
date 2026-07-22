import { useMemo } from "react";
import type { MetricPoint } from "../../types";

interface MetricsChartProps {
  title: string;
  data: MetricPoint[];
  valueFormatter?: (value: number) => string;
  color?: string;
  isDark?: boolean;
  height?: number;
  showArea?: boolean;
  /** 辅助数据线（双线对比用），例如进程级指标 */
  secondaryData?: MetricPoint[];
  /** 辅助数据线的颜色 */
  secondaryColor?: string;
  /** 辅助数据线的显示名称（图例用） */
  secondaryLabel?: string;
}

/**
 * 通用指标图表组件
 * - 支持单线/双线渲染
 * - 双线模式下显示图例，上方主数据值显示最近值
 * - 使用 SVG 绘制平滑曲线 + 渐变面积
 */
function MetricsChart({
  title,
  data,
  valueFormatter = (v) => v.toFixed(1),
  color = "#3B82F6",
  isDark = false,
  height = 120,
  showArea = true,
  secondaryData,
  secondaryColor = "#8B5CF6",
  secondaryLabel,
}: MetricsChartProps) {
  /**
   * 将 MetricPoint[] 数据计算为 SVG 路径字符串
   * 返回主数据路径、面积路径、最值及点列表
   */
  const calcPaths = (data: MetricPoint[]) => {
    if (!data || data.length === 0) {
      return { path: "", areaPath: "", points: [] };
    }

    const values = data.map((d) => d.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    const padding = 4;
    const chartWidth = 100;
    const chartHeight = 100;

    const pts = data.map((point, index) => {
      const x =
        padding + (index / (data.length - 1 || 1)) * (chartWidth - padding * 2);
      const y =
        padding +
        (1 - (point.value - min) / range) * (chartHeight - padding * 2);
      return { x, y, value: point.value, timestamp: point.timestamp };
    });

    const pathD = pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");

    const areaD =
      pts.length > 0
        ? `${pathD} L ${pts[pts.length - 1].x} ${chartHeight - padding} L ${pts[0].x} ${chartHeight - padding} Z`
        : "";

    return { path: pathD, areaPath: areaD, points: pts };
  };

  const primary = useMemo(() => calcPaths(data), [data]);
  const secondary = useMemo(
    () => calcPaths(secondaryData || []),
    [secondaryData],
  );

  const hasDualLine = secondaryData && secondaryData.length > 0;

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!data || data.length === 0) {
    return (
      <div
        className={`p-4 rounded-xl border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <h3
          className={`text-sm font-medium ${isDark ? "text-gray-400" : "text-gray-500"} mb-4`}
        >
          {title}
        </h3>
        <div
          className={`flex items-center justify-center h-${height} ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      {/* 标题区：左标题 + 右最新值 */}
      <div className="flex items-center justify-between mb-4">
        <h3
          className={`text-sm font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {title}
        </h3>
        <span
          className={`text-lg font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          {valueFormatter(data[data.length - 1]?.value ?? 0)}
        </span>
      </div>

      {/* 图例（双线模式） */}
      {hasDualLine && (
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-0.5 rounded"
              style={{ backgroundColor: color }}
            />
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              系统
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-0.5 rounded"
              style={{ backgroundColor: secondaryColor }}
            />
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {secondaryLabel || "应用"}
            </span>
          </div>
        </div>
      )}

      {/* SVG 图表 */}
      <svg
        viewBox={`0 0 100 ${height / 2}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        {showArea && primary.areaPath && (
          <defs>
            <linearGradient
              id={`gradient-${title}`}
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        {showArea && (
          <path d={primary.areaPath} fill={`url(#gradient-${title})`} />
        )}
        {/* 主数据线 */}
        <path
          d={primary.path}
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 辅助数据线 */}
        {hasDualLine && secondary.path && (
          <path
            d={secondary.path}
            fill="none"
            stroke={secondaryColor}
            strokeWidth="0.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2,1"
          />
        )}
      </svg>
      <div
        className={`flex justify-between mt-2 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
      >
        <span>{formatTime(data[0]?.timestamp ?? 0)}</span>
        <span>{formatTime(data[data.length - 1]?.timestamp ?? 0)}</span>
      </div>
    </div>
  );
}

export default MetricsChart;
