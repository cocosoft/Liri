import { memo } from "react";

interface DisconnectBannerProps {
  lastUpdateTime: string;
  isDark?: boolean;
  onRetry?: () => void;
}

export const DisconnectBanner = memo(function DisconnectBanner({
  lastUpdateTime,
  isDark,
  onRetry,
}: DisconnectBannerProps) {
  return (
    <div
      className={`mb-3 p-3 rounded-lg text-sm flex items-center justify-between ${
        isDark
          ? "bg-yellow-900/30 text-yellow-300 border border-yellow-800"
          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
      }`}
    >
      <span>数据源已断开，最后更新：{lastUpdateTime}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className={`px-3 py-1 rounded text-xs font-medium ${
            isDark
              ? "bg-yellow-800 hover:bg-yellow-700 text-yellow-200"
              : "bg-yellow-200 hover:bg-yellow-300 text-yellow-800"
          }`}
        >
          重试
        </button>
      )}
    </div>
  );
});
