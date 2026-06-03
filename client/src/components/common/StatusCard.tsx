interface StatusCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  status?: "normal" | "warning" | "error";
  isDark?: boolean;
}

function StatusCard({
  title,
  value,
  icon,
  trend,
  status = "normal",
  isDark = false,
}: StatusCardProps) {
  const statusColors = {
    normal: isDark ? "text-green-400" : "text-green-600",
    warning: isDark ? "text-yellow-400" : "text-yellow-600",
    error: isDark ? "text-red-400" : "text-red-600",
  };

  const bgColors = {
    normal: isDark ? "bg-green-900/20" : "bg-green-50",
    warning: isDark ? "bg-yellow-900/20" : "bg-yellow-50",
    error: isDark ? "bg-red-900/20" : "bg-red-50",
  };

  const iconBgColors = {
    normal: isDark ? "bg-green-500/20" : "bg-green-100",
    warning: isDark ? "bg-yellow-500/20" : "bg-yellow-100",
    error: isDark ? "bg-red-500/20" : "bg-red-100",
  };

  return (
    <div
      className={`p-4 rounded-xl border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} ${bgColors[status]}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p
            className={`text-sm font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {title}
          </p>
          <p
            className={`text-2xl font-bold mt-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {value}
          </p>
          {trend && (
            <p
              className={`text-xs mt-1 flex items-center gap-1 ${
                trend.isPositive
                  ? isDark
                    ? "text-green-400"
                    : "text-green-600"
                  : isDark
                    ? "text-red-400"
                    : "text-red-600"
              }`}
            >
              <span>{trend.isPositive ? "↑" : "↓"}</span>
              <span>{Math.abs(trend.value)}%</span>
              <span className={isDark ? "text-gray-500" : "text-gray-400"}>
                较上期
              </span>
            </p>
          )}
        </div>
        <div className={`p-2 rounded-lg ${iconBgColors[status]}`}>
          <div className={statusColors[status]}>{icon}</div>
        </div>
      </div>
    </div>
  );
}

export default StatusCard;
