import { memo } from "react";

export type EmptyReason = "pending" | "no-match" | "cleared";

interface TraceEmptyProps {
  reason: EmptyReason;
  isDark?: boolean;
  lastDataTime?: string;
  onResetFilter?: () => void;
}

export const TraceEmpty = memo(function TraceEmpty({
  reason,
  isDark,
  lastDataTime,
  onResetFilter,
}: TraceEmptyProps) {
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";

  const content = () => {
    switch (reason) {
      case "pending":
        return <p className={textSecondary}>等待追踪数据...</p>;
      case "no-match":
        return (
          <div className="space-y-2">
            <p className={textSecondary}>无匹配结果</p>
            {onResetFilter && (
              <button
                onClick={onResetFilter}
                className={`px-3 py-1 text-sm rounded-lg border ${
                  isDark
                    ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                重置过滤器
              </button>
            )}
          </div>
        );
      case "cleared":
        return (
          <p className={textSecondary}>
            数据已清空
            {lastDataTime ? `，上次数据: ${lastDataTime}` : ""}
          </p>
        );
    }
  };

  return (
    <div
      className={`rounded-lg border p-6 text-center ${
        isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-lg mb-2">🔍</div>
      {content()}
    </div>
  );
});
