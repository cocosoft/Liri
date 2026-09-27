import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import StateMachinePanel from "../common/StateMachinePanel";
import {
  backgroundStatusService,
  type BackgroundStatus,
} from "../../services/backgroundTaskService";

/** 后台任务运行状况面板 — 展示"功能承诺 vs 实际执行" */
function BackgroundStatusPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<BackgroundStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const status = await backgroundStatusService.getStatus();
      setData(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const formatTime = (ts: number | null) => {
    if (!ts) return t("backgroundStatus.never");
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("backgroundStatus.title")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("backgroundStatus.desc")}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 text-xs rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
          >
            {t("common.refresh")}
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            {t("common.loading")}
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm mb-4">
            {t("backgroundStatus.loadFailed", { error })}
            <button
              onClick={() => void load()}
              className="ml-2 underline hover:no-underline"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {data && data.alerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {data.alerts.map((alert) => (
              <div
                key={`${alert.task}-${alert.streak}`}
                className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm"
              >
                <div className="flex items-center gap-2 font-medium">
                  <span>⚠️</span>
                  <span>
                    {t("backgroundStatus.alertLine", {
                      task: alert.task,
                      n: alert.streak,
                      phase:
                        alert.phase === "fail"
                          ? t("backgroundStatus.phaseFail")
                          : t("backgroundStatus.phaseSkipped"),
                    })}
                  </span>
                </div>
                <div className="mt-1 text-xs opacity-80">
                  {t("backgroundStatus.alertReason", {
                    status: alert.status,
                    time: formatTime(alert.lastAt),
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* Dream 记忆整理 */}
            <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t("backgroundStatus.dreamSection")}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.completedCount")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.dream.stats.totalCompleted}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.sessionsOrganized")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.dream.stats.totalSessions}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.insightsGenerated")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.dream.stats.totalInsights}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.lastRun")}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {formatTime(data.dream.stats.lastDreamAt)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t("backgroundStatus.recentLogs", {
                  n: data.dream.recentLogs.length,
                })}
              </div>
              {data.dream.recentLogs.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                  {t("backgroundStatus.noLogs")}
                </div>
              ) : (
                <div className="space-y-1">
                  {data.dream.recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs"
                    >
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {log.summary}
                      </span>
                      <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Buddy 成长 */}
            <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t("backgroundStatus.buddySection")}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.dreamsCompleted")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.totalCompleted}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.totalSessions")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.totalSessions}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.tasksCompleted")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.taskCompletionCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("backgroundStatus.totalExp")}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.totalTaskExp}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.buddyGrowth.unlockedAchievements.length === 0 ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {t("backgroundStatus.noAchievements")}
                  </span>
                ) : (
                  data.buddyGrowth.unlockedAchievements.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-1 text-xs rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                    >
                      🏆 {a}
                    </span>
                  ))
                )}
              </div>
            </section>

            {/* 应用状态（§十 阶段 D，复用 StateMachinePanel） */}
            <section>
              <StateMachinePanel />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default BackgroundStatusPage;
