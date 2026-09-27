import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MemorySystemStats } from "../../services/memoryService";

interface MemorySyncingStatusProps {
  stats: MemorySystemStats | null;
  isDark: boolean;
  isCleaning: boolean;
  isConsolidating: boolean;
  isDreaming: boolean;
  onCleanup: () => void;
  onConsolidate: () => void;
  onDream: () => void;
  dreamBusyMessage?: string | null;
}

function formatAge(timestamp: number | null, t: TFunction): string {
  if (!timestamp) return t("memory.ageNever");
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return t("memory.ageMinutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("memory.ageHoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  return t("memory.ageDaysAgo", { n: days });
}

function MemorySyncingStatus({
  stats,
  isDark,
  isCleaning,
  isConsolidating,
  isDreaming,
  onCleanup,
  onConsolidate,
  onDream,
  dreamBusyMessage,
}: MemorySyncingStatusProps) {
  const { t } = useTranslation();
  if (!stats) {
    return (
      <div
        className={`p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
          {t("common.loading")}
        </p>
      </div>
    );
  }

  const vectorPercent =
    stats.totalMemories > 0
      ? Math.round((stats.withVectors / stats.totalMemories) * 100)
      : 0;

  return (
    <div
      className={`p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      <h3
        className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
      >
        {t("memory.systemStatus")}
      </h3>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.total")}
          </span>
          <span className={isDark ? "text-gray-200" : "text-gray-800"}>
            {stats.totalMemories}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.vectorCoverage")}
          </span>
          <span className={isDark ? "text-gray-200" : "text-gray-800"}>
            {vectorPercent}% ({stats.withVectors}/{stats.totalMemories})
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.recent7Days")}
          </span>
          <span className={isDark ? "text-gray-200" : "text-gray-800"}>
            {stats.recentCount}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.expiringSoon")}
          </span>
          <span
            className={
              stats.aging.expiringCount > 0
                ? "text-yellow-400 font-medium"
                : isDark
                  ? "text-gray-200"
                  : "text-gray-800"
            }
          >
            {stats.aging.expiringCount}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.oldestMemory")}
          </span>
          <span className={isDark ? "text-gray-200" : "text-gray-800"}>
            {t("memory.daysAgo", { n: stats.aging.oldestMemoryAge })}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.lastCleanup")}
          </span>
          <span className={isDark ? "text-gray-200" : "text-gray-800"}>
            {formatAge(stats.aging.lastCleanupAt, t)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className={isDark ? "text-gray-400" : "text-gray-600"}>
            {t("memory.indexCache")}
          </span>
          <span className={isDark ? "text-gray-200" : "text-gray-800"}>
            {stats.index.indexedCount}/{stats.index.vectorCacheSize}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        <button
          onClick={onCleanup}
          disabled={isCleaning}
          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-w-[80px] ${
            isCleaning
              ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
              : isDark
                ? "bg-orange-700 hover:bg-orange-600 text-white"
                : "bg-orange-500 hover:bg-orange-600 text-white"
          }`}
        >
          {isCleaning ? t("memory.cleaningNow") : t("memory.cleanupExpired")}
        </button>
        <button
          onClick={onConsolidate}
          disabled={isConsolidating}
          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-w-[80px] ${
            isConsolidating
              ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
              : isDark
                ? "bg-purple-700 hover:bg-purple-600 text-white"
                : "bg-purple-500 hover:bg-purple-600 text-white"
          }`}
        >
          {isConsolidating
            ? t("memory.consolidatingNow")
            : t("memory.mergeDuplicates")}
        </button>
        <button
          onClick={onDream}
          disabled={isDreaming}
          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-w-[80px] ${
            isDreaming
              ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
              : isDark
                ? "bg-indigo-700 hover:bg-indigo-600 text-white"
                : "bg-indigo-500 hover:bg-indigo-600 text-white"
          }`}
        >
          {isDreaming ? t("memory.dreamingNow") : t("memory.memoryRefinement")}
        </button>
      </div>

      {dreamBusyMessage && (
        <div className="mt-2 px-3 py-2 rounded-lg text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
          {dreamBusyMessage}
        </div>
      )}
    </div>
  );
}

export default MemorySyncingStatus;
