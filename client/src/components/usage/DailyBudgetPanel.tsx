import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import {
  usageService,
  type DailyBudgetStatus,
} from "../../services/usageService";
import { handleClientError } from "../../utils/handleError";

/** 数字 → 千分位展示 */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** 档位 → i18n 键（normal / report_only / locked） */
function modeKey(mode: DailyBudgetStatus["mode"]): string {
  switch (mode) {
    case "locked":
      return "cost.dailyLimitModeLocked";
    case "report_only":
      return "cost.dailyLimitModeReportOnly";
    default:
      return "cost.dailyLimitModeNormal";
  }
}

function modeTone(mode: DailyBudgetStatus["mode"]): string {
  switch (mode) {
    case "locked":
      return "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
    case "report_only":
      return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
    default:
      return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
  }
}

/**
 * DailyBudgetPanel — 日 Token 限额管理（R16 / D4）
 *
 * 只读状态 + 热更新上限/阈值 + 重置当日用量 + 手动硬锁（D6，二次确认）。
 * 数据来源：`/v1/cost/daily-budget*`（`usageService`）。
 */
export default function DailyBudgetPanel() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [status, setStatus] = useState<DailyBudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 表单（百分比输入，保存时换算为比值）
  const [limitInput, setLimitInput] = useState("");
  const [warnInput, setWarnInput] = useState("");
  const [lockInput, setLockInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const applyStatus = useCallback((s: DailyBudgetStatus) => {
    setStatus(s);
    setLimitInput(String(s.dailyLimit));
    setWarnInput(String(Math.round(s.warningThreshold * 100)));
    setLockInput(String(Math.round(s.lockThreshold * 100)));
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const s = await usageService.getDailyBudget();
        applyStatus(s);
        setError(null);
      } catch (e) {
        handleClientError(e, {
          module: "components:usage:DailyBudgetPanel",
          action: "load",
        });
        setError(e instanceof Error ? e.message : t("common.loadFailed"));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyStatus, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  // 监控视图：30s 兜底刷新（用量随对话增长）
  useEffect(() => {
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleSave = async () => {
    setNotice(null);
    setError(null);
    const limit = Number(limitInput);
    const warn = Number(warnInput);
    const lock = Number(lockInput);
    if (!Number.isInteger(limit) || limit <= 0) {
      setError(t("cost.dailyLimitInvalidLimit"));
      return;
    }
    if (!(warn > 0 && warn <= 100) || !(lock > 0 && lock <= 100)) {
      setError(t("cost.dailyLimitInvalidThreshold"));
      return;
    }
    setSaving(true);
    try {
      const s = await usageService.updateDailyBudget({
        dailyLimit: limit,
        warningThreshold: warn / 100,
        lockThreshold: lock / 100,
      });
      applyStatus(s);
      setNotice(t("cost.dailyLimitSaved"));
    } catch (e) {
      handleClientError(e, {
        module: "components:usage:DailyBudgetPanel",
        action: "update",
      });
      setError(e instanceof Error ? e.message : t("cost.dailyLimitSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(t("cost.dailyLimitResetConfirm"))) return;
    setNotice(null);
    try {
      applyStatus(await usageService.resetDailyBudget());
      setNotice(t("cost.dailyLimitResetDone"));
    } catch (e) {
      handleClientError(e, {
        module: "components:usage:DailyBudgetPanel",
        action: "reset",
      });
      setError(e instanceof Error ? e.message : t("cost.dailyLimitSaveFailed"));
    }
  };

  const handleKillSwitch = async (enabled: boolean) => {
    const confirmKey = enabled
      ? "cost.dailyLimitKillSwitchEnableConfirm"
      : "cost.dailyLimitKillSwitchDisableConfirm";
    if (!window.confirm(t(confirmKey))) return;
    setNotice(null);
    try {
      applyStatus(await usageService.setDailyBudgetKillSwitch(enabled));
      setNotice(t("cost.dailyLimitSaved"));
    } catch (e) {
      handleClientError(e, {
        module: "components:usage:DailyBudgetPanel",
        action: "killSwitch",
      });
      setError(e instanceof Error ? e.message : t("cost.dailyLimitSaveFailed"));
    }
  };

  const panelCls = `rounded-lg border p-4 ${
    isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
  }`;
  const inputCls = `w-full px-3 py-2 text-sm rounded border ${
    isDark
      ? "bg-gray-900 border-gray-600 text-gray-100"
      : "bg-white border-gray-300 text-gray-900"
  }`;

  if (loading && !status) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-400">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400">
          {notice}
        </div>
      )}

      {/* 状态概览 */}
      <div className={panelCls}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">{t("cost.dailyLimitTitle")}</h3>
          <div className="flex items-center gap-2">
            {status && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${modeTone(status.mode)}`}
              >
                {t(modeKey(status.mode))}
              </span>
            )}
            <button
              onClick={() => load()}
              className="text-sm text-blue-600 hover:underline"
            >
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {status && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitUsed")}
                </p>
                <p className="text-lg font-semibold">
                  {formatNumber(status.todayUsed)}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitCap")}
                </p>
                <p className="text-lg font-semibold">
                  {formatNumber(status.dailyLimit)}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitRemaining")}
                </p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {formatNumber(status.remaining)}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitPercent")}
                </p>
                <p className="text-lg font-semibold">
                  {(status.percentUsed * 100).toFixed(1)}%
                </p>
              </div>
            </div>

            {/* 进度条（按告警阈值着色） */}
            <div className="w-full h-2 rounded bg-gray-200 dark:bg-gray-700 mb-3">
              <div
                className={`h-2 rounded ${
                  status.mode === "locked"
                    ? "bg-red-500"
                    : status.mode === "report_only"
                      ? "bg-yellow-500"
                      : "bg-blue-500"
                }`}
                style={{
                  width: `${Math.min(status.percentUsed * 100, 100)}%`,
                }}
              />
            </div>

            <p className="text-xs text-gray-400">
              {t("cost.dailyLimitDateLabel")}: {status.date} ·{" "}
              {t("cost.dailyLimitNote")}
            </p>
          </>
        )}
      </div>

      {/* 配置 */}
      <div className={panelCls}>
        <h3 className="text-lg font-medium mb-4">
          {t("cost.dailyLimitConfigTitle")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitCap")}
            </span>
            <input
              type="number"
              min={1}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitWarningThreshold")}
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={warnInput}
              onChange={(e) => setWarnInput(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitLockThreshold")}
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={lockInput}
              onChange={(e) => setLockInput(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {saving ? t("cost.dailyLimitSaving") : t("cost.dailyLimitSave")}
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t("cost.dailyLimitReset")}
          </button>
          {status && (
            <button
              onClick={() => handleKillSwitch(!status.killSwitch)}
              className={`px-4 py-2 text-sm rounded-lg ml-auto ${
                status.killSwitch
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }`}
            >
              {status.killSwitch
                ? t("cost.dailyLimitKillSwitchDisable")
                : t("cost.dailyLimitKillSwitchEnable")}
            </button>
          )}
        </div>
        {status?.killSwitch && (
          <p className="text-xs text-red-500 mt-2">
            {t("cost.dailyLimitKillSwitchOn")}
          </p>
        )}
      </div>
    </div>
  );
}
