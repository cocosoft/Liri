import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { memoryService } from "../../services/memoryService";

interface DreamCycleDetail {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  triggerSource: string;
  status: string;
  snapshotTime: number;
  sessionsScanned: number;
  sessionsProcessed: number;
  knowledgeFilesProcessed: number;
  memoriesCreated: number;
  memoriesRefined: number;
  knowledgeFilesUpdated: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;
  processedSessionIds: string[];
  processedKnowledgeFiles: string[];
  memoryCount: number;
  insights: string[];
  errors: string[];
  soulConflicts: number;
  userConflicts: number;
}

interface DreamCycleDetailProps {
  cycleId: string;
  isDark: boolean;
  onClose: () => void;
}

function DreamCycleDetail({ cycleId, isDark, onClose }: DreamCycleDetailProps) {
  const { t } = useTranslation();
  const [cycle, setCycle] = useState<DreamCycleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDetail();
  }, [cycleId]);

  const loadDetail = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await memoryService.getDreamCycle(cycleId);
      setCycle(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("buddy.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDuration = (startMs: number, endMs: number, t: TFunction) => {
    const sec = Math.round((endMs - startMs) / 1000);
    if (sec < 60) return t("buddy.durationSeconds", { n: sec });
    const min = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    return t("buddy.durationMinSec", { min, sec: remainingSec });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
            {t("buddy.statusCompleted")}
          </span>
        );
      case "partial":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {t("buddy.statusPartial")}
          </span>
        );
      case "failed":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {t("buddy.statusFailed")}
          </span>
        );
      default:
        return null;
    }
  };

  const getTriggerLabel = (source: string) => {
    switch (source) {
      case "idle":
        return t("buddy.triggerIdle");
      case "cron":
        return t("buddy.triggerCron");
      case "manual":
        return t("buddy.triggerManual");
      default:
        return source;
    }
  };

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        onClick={onClose}
      >
        <div
          className={`w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl shadow-xl p-6 ${isDark ? "bg-gray-800" : "bg-white"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center py-8 text-gray-400">
            {t("common.loading")}
          </div>
        </div>
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        onClick={onClose}
      >
        <div
          className={`w-full max-w-2xl rounded-xl shadow-xl p-6 ${isDark ? "bg-gray-800" : "bg-white"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center py-8 text-red-500">
            {error || t("buddy.recordNotFound")}
          </div>
          <div className="flex justify-center mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl max-h-[85vh] overflow-auto rounded-xl shadow-xl ${isDark ? "bg-gray-800" : "bg-white"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className={`sticky top-0 z-10 flex items-center justify-between p-4 border-b ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("buddy.dreamCycleDetailTitle")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
              {cycle.cycleId}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 基本信息 */}
          <div className="flex items-center gap-3">
            {getStatusBadge(cycle.status)}
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
            >
              {getTriggerLabel(cycle.triggerSource)}
            </span>
          </div>

          {/* 时间信息 */}
          <div
            className={`grid grid-cols-3 gap-3 text-sm p-3 rounded-lg ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
          >
            <div>
              <div className="text-xs text-gray-400 mb-0.5">
                {t("buddy.startTime")}
              </div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {formatTime(cycle.startedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">
                {t("buddy.endTime")}
              </div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {formatTime(cycle.completedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">
                {t("buddy.totalDuration")}
              </div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {formatDuration(cycle.startedAt, cycle.completedAt, t)}
              </div>
            </div>
          </div>

          {/* 处理统计 */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              {t("buddy.processingStats")}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">
                  {t("buddy.scannedSessions")}
                </div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.sessionsScanned}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">{t("buddy.deepProcessed")}</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.sessionsProcessed}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">
                  {t("buddy.createdMemories")}
                </div>
                <div className="font-medium text-green-600 dark:text-green-400">
                  {cycle.memoriesCreated}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">
                  {t("buddy.refinedMemories")}
                </div>
                <div className="font-medium text-purple-600 dark:text-purple-400">
                  {cycle.memoriesRefined}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">{t("buddy.knowledgeFiles")}</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.knowledgeFilesProcessed}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">
                  {t("buddy.knowledgeUpdates")}
                </div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.knowledgeFilesUpdated}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">{t("buddy.memoryTotal")}</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.memoryCount}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">{t("buddy.snapshotTime")}</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {formatTime(cycle.snapshotTime)}
                </div>
              </div>
            </div>
          </div>

          {/* SOUL/USER 纠偏 */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              {t("buddy.personalityCorrection")}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">SOUL.md</div>
                <div
                  className={`font-medium mt-0.5 ${cycle.soulUpdated ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}
                >
                  {cycle.soulUpdated
                    ? t("buddy.updated")
                    : t("buddy.unchanged")}
                </div>
                {cycle.soulConflicts > 0 && (
                  <div className="text-amber-500 mt-0.5">
                    {t("buddy.optimisticLockConflicts", {
                      count: cycle.soulConflicts,
                    })}
                  </div>
                )}
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">USER.md</div>
                <div
                  className={`font-medium mt-0.5 ${cycle.userProfileUpdated ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}
                >
                  {cycle.userProfileUpdated
                    ? t("buddy.updated")
                    : t("buddy.unchanged")}
                </div>
                {cycle.userConflicts > 0 && (
                  <div className="text-amber-500 mt-0.5">
                    {t("buddy.optimisticLockConflicts", {
                      count: cycle.userConflicts,
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 已处理的会话 */}
          {cycle.processedSessionIds.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                {t("buddy.condensedSessions", {
                  count: cycle.processedSessionIds.length,
                })}
              </h3>
              <div
                className={`max-h-32 overflow-auto rounded-lg p-2 ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                {cycle.processedSessionIds.map((id) => (
                  <div
                    key={id}
                    className="text-xs text-gray-500 dark:text-gray-400 py-0.5 font-mono"
                  >
                    {id}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 已处理的知识文件 */}
          {cycle.processedKnowledgeFiles.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                {t("buddy.processedKnowledgeFiles", {
                  count: cycle.processedKnowledgeFiles.length,
                })}
              </h3>
              <div
                className={`max-h-32 overflow-auto rounded-lg p-2 ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                {cycle.processedKnowledgeFiles.map((file) => (
                  <div
                    key={file}
                    className="text-xs text-gray-500 dark:text-gray-400 py-0.5"
                  >
                    {file}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 洞察列表 */}
          {cycle.insights.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                {t("buddy.insightsTitle")}
              </h3>
              <ul className="space-y-1">
                {cycle.insights.map((insight, i) => (
                  <li
                    key={i}
                    className={`text-sm pl-4 relative before:content-['•'] before:absolute before:left-1 ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 错误列表 */}
          {cycle.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-500 dark:text-red-400 mb-2">
                {t("buddy.errorsTitle")}
              </h3>
              <ul className="space-y-1">
                {cycle.errors.map((err, i) => (
                  <li
                    key={i}
                    className="text-sm text-red-600 dark:text-red-400 pl-4 relative before:content-['•'] before:absolute before:left-1"
                  >
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 底部关闭按钮 */}
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${isDark ? "bg-gray-700 hover:bg-gray-600 text-gray-200" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DreamCycleDetail;
