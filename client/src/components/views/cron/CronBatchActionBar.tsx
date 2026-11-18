/**
 * 批量操作条（CronPage 拆分批 1，2026-11-18）
 *
 * 仅在有选中项时由父组件渲染；三个动作与计数全部经 props 传入。
 */
import { useTranslation } from "react-i18next";

interface Props {
  count: number;
  saving: boolean;
  onClear: () => void;
  onExecute: () => void;
  onDelete: () => void;
}

export default function CronBatchActionBar({
  count,
  saving,
  onClear,
  onExecute,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-sm text-blue-700 dark:text-blue-300">
          {t("cron.batchSelected", "{{count}} tasks selected").replace(
            "{{count}}",
            String(count),
          )}
        </span>
        <button
          onClick={onClear}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t("cron.clearSelection", "Clear")}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onExecute}
          disabled={saving || count === 0}
          className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("cron.forceRun", "Force")}
        >
          {t("cron.forceRun", "强制执行")}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
        >
          {t("cron.batchDelete", "Batch Delete")}
        </button>
      </div>
    </div>
  );
}
