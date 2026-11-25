import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { memoryService } from "../../services/memoryService";
import type {
  TeamConflicts,
  TeamConflictResolution,
  TeamMemoryStatus,
} from "../../services/memoryService";
import { handleClientError } from "../../utils/handleError";
import { formatRelativeTime } from "../../utils/format";

interface TeamMemoryPanelProps {
  isDark: boolean;
}

const STATUS_LABEL_KEYS = {
  synced: "memory.teamStatusSynced",
  syncing: "memory.teamStatusSyncing",
  conflict: "memory.teamStatusConflict",
  error: "memory.teamStatusError",
  not_synced: "memory.teamStatusNotSynced",
} as const;

/** 网络版同步状态（后端 `SyncStatus`）⇒ 展示用 i18n 键 */
const NETWORK_STATUS_LABEL_KEYS: Record<string, string> = {
  idle: "memory.teamStatusIdle",
  syncing: "memory.teamStatusSyncing",
  success: "memory.teamStatusSynced",
  conflict: "memory.teamStatusConflict",
  error: "memory.teamStatusError",
  not_configured: "memory.teamStatusNotSynced",
};

/**
 * 团队记忆审阅面板（共享目录版 Phase 3 设置页入口）。
 *
 * 只做「看状态 + 人工取舍」：冲突候选由同步流程落盘（`conflicts.json`），
 * 本面板**不自动改写**任何一侧；取舍后由后端重新落盘候选列表。
 */
function TeamMemoryPanel({ isDark }: TeamMemoryPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TeamMemoryStatus | null>(null);
  const [conflicts, setConflicts] = useState<TeamConflicts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nextStatus, nextConflicts] = await Promise.all([
        memoryService.getTeamMemoryStatus(),
        memoryService.getTeamConflicts(),
      ]);
      setStatus(nextStatus);
      setConflicts(nextConflicts);
      setErrorMessage(null);
    } catch (e) {
      handleClientError(e, { module: "memory:team", action: "load" });
      setErrorMessage(t("common.error"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolve = async (
    id: string,
    resolution: TeamConflictResolution,
  ) => {
    setResolvingId(id);
    setErrorMessage(null);
    try {
      await memoryService.resolveTeamConflict(id, resolution);
      await load();
    } catch (e) {
      handleClientError(e, { module: "memory:team", action: "resolve" });
      setErrorMessage(t("memory.teamResolveFailed"));
    } finally {
      setResolvingId(null);
    }
  };

  const candidates = conflicts?.candidates ?? [];
  const lastRecord = status?.records[0];

  return (
    <div
      className={`p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          {t("memory.teamTitle")}
        </h3>
        <button
          onClick={() => void load()}
          disabled={isLoading}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            isLoading
              ? "opacity-50 cursor-not-allowed"
              : isDark
                ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
        >
          {isLoading ? t("memory.teamLoading") : t("memory.teamRefresh")}
        </button>
      </div>

      {!status ? (
        <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
          {t("memory.teamLoading")}
        </p>
      ) : !status.configured ? (
        <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
          {t("memory.teamNotConfigured")}
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>
              {t("memory.teamSharedDir")}
            </span>
            <span
              className={`truncate text-xs ${isDark ? "text-gray-200" : "text-gray-800"}`}
              title={status.sharedDir}
            >
              {status.sharedDir}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>
              {t("memory.teamLastSync")}
            </span>
            <span className={isDark ? "text-gray-200" : "text-gray-800"}>
              {status.lastSyncAt
                ? formatRelativeTime(new Date(status.lastSyncAt).toISOString())
                : t("memory.teamNeverSynced")}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>
              {t("memory.teamConflicts")}
            </span>
            <span
              className={
                candidates.length > 0
                  ? "text-yellow-500 font-medium"
                  : isDark
                    ? "text-gray-200"
                    : "text-gray-800"
              }
            >
              {STATUS_LABEL_KEYS[status.status]
                ? t(STATUS_LABEL_KEYS[status.status])
                : status.status}
              {candidates.length > 0 ? ` · ${candidates.length}` : ""}
            </span>
          </div>

          {lastRecord?.error && (
            <p className="text-xs text-red-500">{lastRecord.error}</p>
          )}

          {status.network && (
            <div className="pt-2 border-t border-dashed border-gray-500/30 space-y-1">
              <div className="flex items-center justify-between">
                <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                  {t("memory.teamNetworkTitle")}
                </span>
                <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                  {status.network.configured
                    ? NETWORK_STATUS_LABEL_KEYS[status.network.status]
                      ? t(NETWORK_STATUS_LABEL_KEYS[status.network.status])
                      : status.network.status
                    : t("memory.teamStatusNotSynced")}
                </span>
              </div>
              {status.network.configured ? (
                <>
                  <div className="flex items-center justify-between">
                    <span
                      className={isDark ? "text-gray-400" : "text-gray-600"}
                    >
                      {t("memory.teamNetworkTeamId")}
                    </span>
                    <span
                      className={`text-xs ${isDark ? "text-gray-200" : "text-gray-800"}`}
                    >
                      {status.network.teamId}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className={isDark ? "text-gray-400" : "text-gray-600"}
                    >
                      {t("memory.teamLastSync")}
                    </span>
                    <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                      {status.network.lastSyncAt
                        ? formatRelativeTime(
                            new Date(status.network.lastSyncAt).toISOString(),
                          )
                        : t("memory.teamNeverSynced")}
                    </span>
                  </div>
                  {status.network.lastError && (
                    <p className="text-xs text-red-500">
                      {t("memory.teamNetworkLastError")}:{" "}
                      {status.network.lastError}
                    </p>
                  )}
                </>
              ) : (
                <p
                  className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  {t("memory.teamNetworkNotConfigured")}
                </p>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-dashed border-gray-500/30 space-y-2">
            {candidates.length === 0 ? (
              <p
                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                {t("memory.teamNoConflicts")}
              </p>
            ) : (
              candidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className={`p-2 rounded border ${
                    isDark
                      ? "bg-gray-900/40 border-gray-700"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <div
                    className={`text-xs font-medium truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
                    title={candidate.id}
                  >
                    {candidate.id}
                  </div>
                  <div
                    className={`text-[11px] mb-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {candidate.directions.join(" / ")}
                  </div>
                  {candidate.source === "network" ? (
                    <p
                      className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {t("memory.teamNetworkConflictHint")}
                    </p>
                  ) : (
                    <div className="flex gap-2">
                    <button
                      onClick={() =>
                        void handleResolve(candidate.id, "keep_local")
                      }
                      disabled={resolvingId === candidate.id}
                      className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                        resolvingId === candidate.id
                          ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                          : isDark
                            ? "bg-blue-700 hover:bg-blue-600 text-white"
                            : "bg-blue-500 hover:bg-blue-600 text-white"
                      }`}
                    >
                      {t("memory.teamKeepLocal")}
                    </button>
                    <button
                      onClick={() =>
                        void handleResolve(candidate.id, "keep_shared")
                      }
                      disabled={resolvingId === candidate.id}
                      className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                        resolvingId === candidate.id
                          ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                          : isDark
                            ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                            : "bg-emerald-500 hover:bg-emerald-600 text-white"
                      }`}
                    >
                      {t("memory.teamKeepShared")}
                    </button>
                    </div>
                  )}
                </div>
              ))
            )}
            {errorMessage && (
              <p className="text-xs text-red-500">{errorMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TeamMemoryPanel;
