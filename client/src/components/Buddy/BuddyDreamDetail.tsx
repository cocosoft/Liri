import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBuddyStore } from "../../stores/buddyStore";
import { dreamService } from "../../services/backgroundTaskService";
import type { DreamLogEntry } from "../../types";
import { currentLocale } from "../../utils/format";
import { handleClientError } from "@/utils/handleError";

const DREAM_TYPE_LABELS: Record<string, string> = {
  "dream:started": "buddy.dreamTypeStarted",
  "dream:completed": "buddy.dreamTypeCompleted",
  "dream:failed": "buddy.dreamTypeFailed",
  "dream:skipped": "buddy.dreamTypeSkipped",
};

const DREAM_TYPE_ICONS: Record<string, string> = {
  "dream:started": "🌙",
  "dream:completed": "✨",
  "dream:failed": "💤",
  "dream:skipped": "⏭️",
};

/** 伙伴梦境记录条数（最近 N 条） */
const RECENT_DREAM_LIMIT = 20;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(currentLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 伙伴梦境详情
 *
 * 2026-11-25（P0-3）：此前挂载即 `setDreams([])` —— 页面永远空白。
 * 现改用 `/v1/buddy/dreams`（伙伴梦境日志，梦境事件落盘的真实来源），
 * 移除无数据来源的「心情 / 符号 / 时长」虚构字段。
 */
function BuddyDreamDetail() {
  const { t } = useTranslation();
  const { companion } = useBuddyStore();
  const [dreams, setDreams] = useState<DreamLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDream, setSelectedDream] = useState<DreamLogEntry | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    dreamService
      .getDreamLogs(RECENT_DREAM_LIMIT)
      .then((res) => {
        if (!cancelled) setDreams(res.logs);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        handleClientError(e, {
          module: "components:BuddyDreamDetail",
          action: "getDreamLogs",
        });
        setDreams([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!companion) {
    return (
      <div className="p-4 text-center text-gray-400">
        {t("buddy.noBuddyData")}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-center text-gray-400 dark:text-gray-500">
        {t("buddy.loadingDreamLog")}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-4">{t("buddy.dreamRecords")}</h3>

      {selectedDream ? (
        <div>
          <button
            onClick={() => setSelectedDream(null)}
            className="mb-4 px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            {t("buddy.backToList")}
          </button>

          <div className="rounded-lg p-4 mb-4 bg-purple-100 dark:bg-purple-900/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-3xl">
                {DREAM_TYPE_ICONS[selectedDream.type] ?? "💭"}
              </span>
              <span className="text-sm text-gray-500">
                {formatTime(selectedDream.timestamp)}
              </span>
            </div>
            <h4 className="text-xl font-medium mb-2">
              {t(
                DREAM_TYPE_LABELS[selectedDream.type] ??
                  "buddy.dreamTypeStarted",
              )}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              {selectedDream.summary}
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>
                {t("buddy.statSessions")}: {selectedDream.sessionsCount}
              </span>
              <span>
                {t("buddy.statInsights")}: {selectedDream.insightsGenerated}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {dreams.length === 0 ? (
            <p className="text-center text-gray-400 py-8">
              {t("buddy.noDreamRecords")}
            </p>
          ) : (
            dreams.map((dream) => (
              <button
                key={dream.id}
                onClick={() => setSelectedDream(dream)}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">
                    {t(
                      DREAM_TYPE_LABELS[dream.type] ?? "buddy.dreamTypeStarted",
                    )}
                  </span>
                  <span className="text-xl">
                    {DREAM_TYPE_ICONS[dream.type] ?? "💭"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {dream.summary}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  <span>{formatTime(dream.timestamp)}</span>
                  <span>
                    {t("buddy.statSessions")}: {dream.sessionsCount}
                  </span>
                  <span>
                    {t("buddy.statInsights")}: {dream.insightsGenerated}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <h4 className="text-sm font-medium mb-2">
          {t("buddy.dreamInterpretation")}
        </h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {t("buddy.dreamInterpretationDesc")}
        </p>
      </div>
    </div>
  );
}

export default BuddyDreamDetail;
