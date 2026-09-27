import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { SortBy } from "./utils";

interface TraceFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusChange: (s: string) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  timeRangeMs: number;
  onTimeRangeChange: (ms: number) => void;
  viewMode: "tree" | "waterfall";
  onViewModeChange: (m: "tree" | "waterfall") => void;
  errorCount: number;
  onNextError: () => void;
  isDark?: boolean;
  onExport?: () => void;
  onTogglePause?: () => void;
  paused?: boolean;
}

const TIME_RANGES: { labelKey: string; ms: number }[] = [
  { labelKey: "otel.timeRange1m", ms: 60_000 },
  { labelKey: "otel.timeRange5m", ms: 300_000 },
  { labelKey: "otel.timeRange15m", ms: 900_000 },
  { labelKey: "otel.timeRangeAll", ms: 0 },
];

const SORT_OPTIONS: { labelKey: string; value: SortBy }[] = [
  { labelKey: "otel.sortTimeDesc", value: "time-desc" },
  { labelKey: "otel.sortTimeAsc", value: "time-asc" },
  { labelKey: "otel.sortDurationDesc", value: "duration-desc" },
  { labelKey: "otel.sortErrorFirst", value: "error-first" },
  { labelKey: "otel.sortSpanCount", value: "span-count-desc" },
];

const selectClass = (isDark: boolean) =>
  `px-2 py-1.5 text-xs rounded-lg border ${
    isDark
      ? "bg-gray-700 border-gray-600 text-gray-300"
      : "bg-white border-gray-300 text-gray-700"
  } focus:outline-none focus:ring-2 focus:ring-blue-500`;

const btnClass = (isDark: boolean, active: boolean) =>
  `px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
    active
      ? "bg-blue-600 text-white"
      : isDark
        ? "bg-gray-700 text-gray-400 hover:bg-gray-600 border border-gray-600"
        : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
  }`;

export const TraceFilterBar = memo(function TraceFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  sortBy,
  onSortChange,
  timeRangeMs,
  onTimeRangeChange,
  viewMode,
  onViewModeChange,
  errorCount,
  onNextError,
  isDark,
  onExport,
  onTogglePause,
  paused,
}: TraceFilterBarProps) {
  const { t } = useTranslation();
  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSearchChange(e.target.value);
    },
    [onSearchChange],
  );

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 mb-3 space-y-2 ${
        isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Time range */}
        <select
          value={timeRangeMs}
          onChange={(e) => onTimeRangeChange(Number(e.target.value))}
          className={selectClass(!!isDark)}
        >
          {TIME_RANGES.map((tr) => (
            <option key={tr.ms} value={tr.ms}>
              {t(tr.labelKey)}
            </option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder={t("otel.searchSpanPlaceholder")}
          value={searchQuery}
          onChange={handleSearch}
          className={`flex-1 min-w-[120px] px-2 py-1.5 text-xs rounded-lg border ${
            isDark
              ? "bg-gray-700 border-gray-600 text-gray-300 placeholder-gray-500"
              : "bg-white border-gray-300 text-gray-700 placeholder-gray-400"
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className={selectClass(!!isDark)}
        >
          <option value="all">{t("common.all")}</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className={selectClass(!!isDark)}
        >
          {SORT_OPTIONS.map((so) => (
            <option key={so.value} value={so.value}>
              {t(so.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        {/* View mode toggle */}
        <button
          onClick={() => onViewModeChange("tree")}
          className={btnClass(!!isDark, viewMode === "tree")}
        >
          Tree
        </button>
        <button
          onClick={() => onViewModeChange("waterfall")}
          className={btnClass(!!isDark, viewMode === "waterfall")}
        >
          Waterfall
        </button>

        <div className="flex-1" />

        {/* Pause toggle */}
        {onTogglePause && (
          <button
            onClick={onTogglePause}
            title={
              paused ? t("otel.resumeAutoRefresh") : t("otel.pauseRefresh")
            }
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              paused
                ? "bg-yellow-600 text-white hover:bg-yellow-700"
                : isDark
                  ? "bg-gray-700 text-gray-400 hover:bg-gray-600 border border-gray-600"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            {paused ? t("otel.resume") : t("otel.pause")}
          </button>
        )}

        {/* Export */}
        {onExport && (
          <button
            onClick={onExport}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              isDark
                ? "bg-green-800 text-green-200 hover:bg-green-700"
                : "bg-green-100 text-green-700 hover:bg-green-200"
            }`}
          >
            {t("otel.exportJson")}
          </button>
        )}

        {/* Next error */}
        <button
          onClick={onNextError}
          disabled={errorCount === 0}
          title={
            errorCount === 0 ? t("otel.noErrors") : t("otel.nextErrorHint")
          }
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            errorCount === 0
              ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
              : "bg-red-600 text-white hover:bg-red-700"
          }`}
        >
          {t("otel.nextError")}
        </button>
      </div>
    </div>
  );
});
