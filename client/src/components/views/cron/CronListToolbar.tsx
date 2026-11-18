/**
 * 任务列表工具栏（CronPage 拆分批 1，2026-11-18）
 *
 * 全选 / 搜索 / 状态筛选 / 排序 / 计数 / 刷新 —— 全部状态由父组件持有。
 */
import { useTranslation } from "react-i18next";

export type CronStatusFilter = "all" | "running" | "idle" | "error";
export type CronSortBy = "lastRun" | "name" | "nextRun";

interface Props {
  isAllSelected: boolean;
  allDisabled: boolean;
  onToggleSelectAll: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: CronStatusFilter;
  onStatusFilterChange: (value: CronStatusFilter) => void;
  sortBy: CronSortBy;
  onSortByChange: (value: CronSortBy) => void;
  sortOrder: "asc" | "desc";
  onToggleSortOrder: () => void;
  filteredCount: number;
  isLoading: boolean;
  onRefresh: () => void;
}

export default function CronListToolbar({
  isAllSelected,
  allDisabled,
  onToggleSelectAll,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onToggleSortOrder,
  filteredCount,
  isLoading,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
      <div className="flex items-center gap-3 w-full sm:w-auto">
        <input
          type="checkbox"
          checked={isAllSelected}
          onChange={onToggleSelectAll}
          disabled={allDisabled}
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"
              />
            </svg>
            <input
              type="text"
              placeholder={t("cron.searchPlaceholder", "Search tasks...")}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full sm:w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) =>
            onStatusFilterChange(e.target.value as CronStatusFilter)
          }
          className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
        >
          <option value="all">{t("cron.allStatus", "All Status")}</option>
          <option value="running">{t("cron.running", "Running")}</option>
          <option value="idle">{t("cron.idle", "Idle")}</option>
          <option value="error">{t("cron.error", "Error")}</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as CronSortBy)}
          className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
        >
          <option value="lastRun">{t("cron.sortLastExec", "Last Run")}</option>
          <option value="name">{t("cron.sortName", "Name")}</option>
          <option value="nextRun">{t("cron.sortNextExec", "Next Run")}</option>
        </select>
        <button
          onClick={onToggleSortOrder}
          className="px-2 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          title={sortOrder === "asc" ? t("cron.sortAsc") : t("cron.sortDesc")}
        >
          {sortOrder === "asc" ? "↑" : "↓"}
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {t("cron.totalTasksLabel", "{{count}} tasks total").replace(
            "{{count}}",
            String(filteredCount),
          )}
        </span>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
        >
          {t("cron.refresh", "Refresh")}
        </button>
      </div>
    </div>
  );
}
