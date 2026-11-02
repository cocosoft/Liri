/**
 * 工作项完整历史（P39-b-2，2026-11-02）
 *
 * 折叠在卡片内按需加载：派工记录 + 执行记录（均为**已存在的事实**，缺数据不补造）。
 * 数据源：`GET /v1/cockpit/:id/history`。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  cockpitService,
  type CockpitHistoryDto,
} from "../../../services/cockpitService";
import { currentLocale } from "../../../utils/format";

function formatTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(currentLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WorkItemHistory({
  workItemId,
}: {
  workItemId: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<CockpitHistoryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    cockpitService
      .getHistory(workItemId)
      .then((history) => {
        if (!cancelled) setData(history);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workItemId]);

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">
      <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {t("backgroundStatus.workItems.historyTitle")}
      </div>

      {loading && (
        <div className="text-xs text-gray-400 dark:text-gray-500">
          {t("common.loading")}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {t("backgroundStatus.workItems.loadFailed", { error })}
        </div>
      )}

      {data &&
        data.assignments.length === 0 &&
        data.executions.length === 0 && (
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {t("backgroundStatus.workItems.noHistory")}
          </div>
        )}

      {data && data.assignments.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t("backgroundStatus.workItems.assignments", {
              n: data.assignments.length,
            })}
          </div>
          <ul className="space-y-1">
            {data.assignments.map((a) => (
              <li
                key={a.assignmentId}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-700/50 text-xs"
              >
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {a.executor || "—"} · {a.state}
                  {a.reportState ? ` · ${a.reportState}` : ""}
                </span>
                <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                  {formatTime(a.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.executions.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t("backgroundStatus.workItems.executions", {
              n: data.executions.length,
            })}
          </div>
          <ul className="space-y-1">
            {data.executions.map((e) => (
              <li
                key={e.executionId}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-700/50 text-xs"
              >
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {e.status}
                </span>
                <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                  {formatTime(e.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
