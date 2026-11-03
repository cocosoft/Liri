import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { httpLegacy as http } from "../../../services/httpClient";
import { handleClientError } from "../../../utils/handleError";
import { currentLocale } from "../../../utils/format";

/**
 * 自主执行（AlwaysOn）运行态（2026-11-03 P1）
 *
 * 口径：数据全部来自 `GET /v1/autonomy/status`（后端 entry 侧快照）。
 * 回答用户最关心的三个问题：**谁在跑**、**为什么没跑**、**下次何时能跑**。
 */
interface AutonomyProjectStatus {
  projectId: string;
  name: string;
  path: string;
  enabled: boolean;
  registered: boolean;
  running: boolean;
  todayCount: number;
  dailyBudget: number;
  lastRunAt: number | null;
  nextEligibleAt: number | null;
  lastGate: {
    passed: boolean;
    reason?: string;
    detail?: string;
    at: number;
  } | null;
}

interface AutonomyStatusResponse {
  available: boolean;
  enabled: boolean;
  running: boolean;
  projects: AutonomyProjectStatus[];
  generatedAt?: number;
}

/** 门控原因 → i18n 键（未知原因原样显示，避免"看不懂的代码"） */
const GATE_REASON_KEYS: Record<string, string> = {
  disabled: "backgroundStatus.autonomyGateDisabled",
  project_disabled: "backgroundStatus.autonomyGateProjectPaused",
  project_missing: "backgroundStatus.autonomyGateProjectMissing",
  dormant_no_signal: "backgroundStatus.autonomyGateDormant",
  agent_busy: "backgroundStatus.autonomyGateBusy",
  recent_user_msg: "backgroundStatus.autonomyGateUserActive",
  cooldown: "backgroundStatus.autonomyGateCooldown",
  daily_budget: "backgroundStatus.autonomyGateDailyBudget",
  lock_busy: "backgroundStatus.autonomyGateLockBusy",
};

function formatTime(ts: number | null, never: string): string {
  if (!ts) return never;
  return new Date(ts).toLocaleString(currentLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 单个项目的状态徽标（优先级：未启用 > 未注册 > 有门控原因 > 正常等待） */
function statusBadge(
  project: AutonomyProjectStatus,
  t: (key: string) => string
): { text: string; className: string } {
  if (!project.enabled) {
    return {
      text: t("backgroundStatus.autonomyPaused"),
      className:
        "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
    };
  }
  if (!project.registered) {
    return {
      text: t("backgroundStatus.autonomyNotRegistered"),
      className: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
    };
  }
  const reason = project.lastGate?.passed === false ? project.lastGate.reason : undefined;
  if (reason) {
    const key = GATE_REASON_KEYS[reason];
    return {
      text: key ? t(key) : reason,
      className:
        "bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300",
    };
  }
  return {
    text: project.running
      ? t("backgroundStatus.autonomyWaiting")
      : t("backgroundStatus.autonomyStopped"),
    className:
      "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400",
  };
}

export default function AutonomyStatusPanel({
  refreshToken = 0,
}: {
  refreshToken?: number;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<AutonomyStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await http.get<AutonomyStatusResponse>("/v1/autonomy/status");
      setData(res);
    } catch (e) {
      handleClientError(e, {
        module: "views:background:AutonomyStatus",
        action: "load",
      });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("backgroundStatus.autonomyTitle")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t("backgroundStatus.autonomyDesc")}
          </p>
        </div>
        {data && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.available
              ? t("backgroundStatus.autonomySummary", {
                  running: data.projects.filter((p) => p.running).length,
                  total: data.projects.length,
                })
              : t("backgroundStatus.autonomyUnavailable")}
          </span>
        )}
      </div>

      {loading && (
        <div className="py-6 text-center text-sm text-gray-400">
          {t("common.loading")}
        </div>
      )}
      {error && !loading && (
        <div className="py-4 text-sm text-red-500">
          {t("backgroundStatus.loadFailed", { error })}
        </div>
      )}

      {!loading && !error && data && data.projects.length === 0 && (
        <div className="py-4 text-sm text-gray-400">
          {t("backgroundStatus.autonomyEmpty")}
        </div>
      )}

      {!loading && !error && data && data.projects.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {data.projects.map((project) => {
            const badge = statusBadge(project, t);
            return (
              <li key={project.projectId} className="py-2 flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 truncate">
                  {project.name}
                </span>
                <span
                  className={`px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap ${badge.className}`}
                >
                  {badge.text}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {t("backgroundStatus.autonomyToday", {
                    used: project.todayCount,
                    budget: project.dailyBudget,
                  })}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {t("backgroundStatus.autonomyNext", {
                    time: formatTime(
                      project.nextEligibleAt,
                      t("backgroundStatus.never")
                    ),
                  })}
                </span>
                {project.lastGate?.detail && (
                  <span
                    className="hidden md:inline text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[220px]"
                    title={project.lastGate.detail}
                  >
                    {project.lastGate.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
