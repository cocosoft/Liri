import type { MemorySyncStatus } from "../../services/memoryService";

interface MemorySyncingStatusProps {
  status: MemorySyncStatus;
  isDark: boolean;
  onTriggerSync: () => void;
}

function MemorySyncingStatus({
  status,
  isDark,
  onTriggerSync,
}: MemorySyncingStatusProps) {
  const formatLastSyncTime = (timestamp: number | null) => {
    if (!timestamp) return "从未同步";
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className={`p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          🔄 同步状态
        </h3>
        <button
          onClick={onTriggerSync}
          disabled={status.isSyncing}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            status.isSyncing
              ? "opacity-50 cursor-not-allowed"
              : isDark
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          {status.isSyncing ? "同步中..." : "立即同步"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            同步状态
          </span>
          <div className="flex items-center gap-2">
            {status.isSyncing ? (
              <>
                <div
                  className={`w-2 h-2 rounded-full animate-pulse ${isDark ? "bg-blue-500" : "bg-blue-500"}`}
                />
                <span
                  className={`text-sm ${isDark ? "text-blue-400" : "text-blue-600"}`}
                >
                  同步中
                </span>
              </>
            ) : (
              <>
                <div
                  className={`w-2 h-2 rounded-full ${isDark ? "bg-green-500" : "bg-green-500"}`}
                />
                <span
                  className={`text-sm ${isDark ? "text-green-400" : "text-green-600"}`}
                >
                  已同步
                </span>
              </>
            )}
          </div>
        </div>

        {status.isSyncing && status.syncProgress > 0 && (
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                同步进度
              </span>
              <span className={isDark ? "text-gray-300" : "text-gray-700"}>
                {status.syncProgress}%
              </span>
            </div>
            <div
              className={`h-1.5 rounded-full overflow-hidden ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            >
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${status.syncProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            上次同步
          </span>
          <span className={isDark ? "text-gray-300" : "text-gray-700"}>
            {formatLastSyncTime(status.lastSyncTime)}
          </span>
        </div>

        {status.pendingChanges > 0 && (
          <div className="flex items-center justify-between">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>
              待同步更改
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-yellow-400" : "text-yellow-600"}`}
            >
              {status.pendingChanges} 项
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default MemorySyncingStatus;
