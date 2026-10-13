import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import {
  usageService,
  type DailyBudgetReliefKind,
  type DailyBudgetStatus,
} from "../../services/usageService";
import { configService } from "../../services/configService";
import { sseService } from "../../services/sseService";
import { handleClientError } from "../../utils/handleError";

/** 数字 → 千分位展示 */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 金额（USD）→ 展示。
 *
 * 最少 2 位、最多 4 位小数：小额（如单轮的 `$0.0031`）不被四舍五入成 `$0.00`，
 * 大额仍保持 `$12.50` 的可读性。
 */
function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
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

/** 放行种类 → i18n 键 */
function reliefKindKey(kind: DailyBudgetReliefKind): string {
  switch (kind) {
    case "boost":
      return "cost.dailyLimitReliefKindBoost";
    case "waive-once":
      return "cost.dailyLimitReliefKindWaiveOnce";
    default:
      return "cost.dailyLimitReliefKindUnlockToday";
  }
}

/** 放行到期展示（`null` = 至日界，即 `unlock-today`） */
function reliefExpiryText(
  expiresAt: number | null,
  t: (key: string) => string,
): string {
  if (expiresAt === null) return t("cost.dailyLimitReliefUntilDayEnd");
  return `${t("cost.dailyLimitReliefUntil")} ${new Date(expiresAt).toLocaleTimeString()}`;
}

/** 后端广播事件名（`daily-budget-handlers.ts` 的 `DAILY_BUDGET_SSE_EVENT`）。 */
const DAILY_BUDGET_SSE_EVENT = "cost:dailyBudgetUpdated";

/** 放行默认值（D-h 自主权项）的配置键 */
const RELIEF_PREFS_KEY = "costControl.dailyBudgetReliefPrefs";

/** 提额时长选项（ms → i18n 键） */
const TTL_OPTIONS: Array<{ ms: number; key: string }> = [
  { ms: 15 * 60_000, key: "cost.dailyLimitReliefTtl15m" },
  { ms: 60 * 60_000, key: "cost.dailyLimitReliefTtl1h" },
  { ms: 4 * 60 * 60_000, key: "cost.dailyLimitReliefTtl4h" },
];

const DEFAULT_BOOST_TTL_MS = 60 * 60_000;

/** 放行默认值表单（倍数以字符串持有，避免清空输入时 NaN 回写） */
interface ReliefPrefsForm {
  defaultFactor: string;
  defaultTtlMs: number;
  requireConfirm: boolean;
}

/** D-n：默认 ×2 / 1 小时自动恢复；D-b：默认一次显式确认（防误点） */
const DEFAULT_RELIEF_PREFS: ReliefPrefsForm = {
  defaultFactor: "2",
  defaultTtlMs: DEFAULT_BOOST_TTL_MS,
  requireConfirm: true,
};

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
 * DailyBudgetPanel — 日 Token 限额管理（R16 / D4 / D-h）
 *
 * 只读状态（用量 / 档位 / 有效上限 / 欠账 / 当前放行）+ 热更新上限与阈值 + 重置当日用量 +
 * 手动硬锁（D6，二次确认）+ 急救放行（D-b：临时提额 / 当日解除）+ 放行默认值（D-h）。
 * 数据来源：`/v1/cost/daily-budget*`（`usageService`）+ 配置面（`configService`）；
 * 变更经后端 `cost:dailyBudgetUpdated` 广播即时刷新（30s 轮询仅作兜底）。
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
  // 债四 USD-3（方案 §6.3）：金额上限输入 —— **以字符串持有**：留空是**合法状态**
  // （"不启用"），不可强转数字（`Number("")===0` 会被后端判为非法上限）。
  const [usdLimitInput, setUsdLimitInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 急救放行表单（D-b）：提额方式 / 倍数 / 增量 / 时长
  const [reliefMode, setReliefMode] = useState<"factor" | "amount">("factor");
  const [reliefFactor, setReliefFactor] = useState(
    DEFAULT_RELIEF_PREFS.defaultFactor,
  );
  const [reliefAmount, setReliefAmount] = useState("");
  const [reliefTtlMs, setReliefTtlMs] = useState(
    DEFAULT_RELIEF_PREFS.defaultTtlMs,
  );
  const [reliefBusy, setReliefBusy] = useState(false);

  // 放行默认值（D-h 自主权项）
  const [prefs, setPrefs] = useState<ReliefPrefsForm>(DEFAULT_RELIEF_PREFS);
  const [prefsSaving, setPrefsSaving] = useState(false);

  /**
   * 文案函数经 ref 取用（**不**直接进依赖）：
   * `useTranslation()` 在语言就绪 / 切换时会给出**新的 `t`（及 `i18n`）identity** ⇒
   * 若把 `t` 放进 `load` 的依赖，`useEffect(..., [load])` 会随之重跑 ⇒ 挂载即**重复**请求日限额
   * （实测：`GET /v1/cost/daily-budget` 被调用 2 次；回归用例见 `DailyBudgetPanel.test.tsx`）。
   */
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const applyStatus = useCallback((s: DailyBudgetStatus) => {
    setStatus(s);
    setLimitInput(String(s.dailyLimit));
    setWarnInput(String(Math.round(s.warningThreshold * 100)));
    setLockInput(String(Math.round(s.lockThreshold * 100)));
    // 债四 USD-3：未配置（`null`）⇒ 输入框**留空**而非显示 `0`
    //（`0` 是"上限 0 ⇒ 全额拒发"的误读；`null` 才是"未启用"）。
    setUsdLimitInput(s.limitUsd === null ? "" : String(s.limitUsd));
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
        setError(
          e instanceof Error ? e.message : tRef.current("common.loadFailed"),
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    // 依赖只用**稳定**引用（`applyStatus`）；`t` 经 `tRef` 取用，见其声明处的说明。
    [applyStatus],
  );

  useEffect(() => {
    load();
  }, [load]);

  // 监控视图：30s 兜底刷新（用量随对话增长）
  useEffect(() => {
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // D-h：变更经后端 `cost:dailyBudgetUpdated` 广播 ⇒ 面板**即时**刷新（30s 轮询仅兜底）
  useEffect(() => {
    const onBudgetUpdated = (): void => {
      void load(true);
    };
    sseService.on(DAILY_BUDGET_SSE_EVENT, onBudgetUpdated);
    return () => sseService.off(DAILY_BUDGET_SSE_EVENT, onBudgetUpdated);
  }, [load]);

  // D-h：载入放行默认值（缺省/非法 ⇒ 回落 D-n 与 D-b 的默认）
  useEffect(() => {
    configService
      .get(RELIEF_PREFS_KEY)
      .then((raw) => {
        if (!raw || typeof raw !== "object") return;
        const v = raw as Partial<{
          defaultFactor: unknown;
          defaultTtlMs: unknown;
          requireConfirm: unknown;
        }>;
        const factor = Number(v.defaultFactor);
        const ttl = Number(v.defaultTtlMs);
        const next: ReliefPrefsForm = {
          defaultFactor:
            Number.isFinite(factor) && factor > 1
              ? String(factor)
              : DEFAULT_RELIEF_PREFS.defaultFactor,
          defaultTtlMs: TTL_OPTIONS.some((o) => o.ms === ttl)
            ? ttl
            : DEFAULT_RELIEF_PREFS.defaultTtlMs,
          requireConfirm:
            typeof v.requireConfirm === "boolean"
              ? v.requireConfirm
              : DEFAULT_RELIEF_PREFS.requireConfirm,
        };
        setPrefs(next);
        setReliefFactor(next.defaultFactor);
        setReliefTtlMs(next.defaultTtlMs);
      })
      .catch((e) =>
        handleClientError(e, {
          module: "components:usage:DailyBudgetPanel",
          action: "loadReliefPrefs",
        }),
      );
  }, []);

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
    // 债四 USD-3：**留空 ⇒ `null`（清空 = 解除金额上限）**；填写 ⇒ 正数（允许小数）。
    // 契约见 `DailyBudgetUpdate.dailyLimitUSD`（后端只收正有限数或 `null`）。
    const usdRaw = usdLimitInput.trim();
    let dailyLimitUSD: number | null;
    if (usdRaw === "") {
      dailyLimitUSD = null;
    } else {
      const usd = Number(usdRaw);
      if (!Number.isFinite(usd) || usd <= 0) {
        setError(t("cost.dailyLimitUsdInvalid"));
        return;
      }
      dailyLimitUSD = usd;
    }
    setSaving(true);
    try {
      const s = await usageService.updateDailyBudget({
        dailyLimit: limit,
        warningThreshold: warn / 100,
        lockThreshold: lock / 100,
        dailyLimitUSD,
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

  /**
   * 提交一次放行（D-b）。二次确认由**放行默认值**开关控制（D-h：仅一次显式确认，不弹审批）。
   */
  const submitRelief = async (
    input: Parameters<typeof usageService.setDailyBudgetRelief>[0],
    confirmKey: string,
  ) => {
    if (prefs.requireConfirm && !window.confirm(t(confirmKey))) return;
    setNotice(null);
    setError(null);
    setReliefBusy(true);
    try {
      applyStatus(await usageService.setDailyBudgetRelief(input));
      setNotice(t("cost.dailyLimitReliefDone"));
    } catch (e) {
      handleClientError(e, {
        module: "components:usage:DailyBudgetPanel",
        action: "relief",
      });
      setError(e instanceof Error ? e.message : t("cost.dailyLimitSaveFailed"));
    } finally {
      setReliefBusy(false);
    }
  };

  /**
   * 撤销放行（DELETE /v1/cost/daily-budget/relief，D-b 对称回路）。
   * 与 `submitRelief` 的差异：**不**走二次确认 —— 撤销是"收回"方向（恢复更严的上限），
   * 误点的后果只是回到原上限，无需确认。
   */
  const handleRevokeRelief = async () => {
    setNotice(null);
    setError(null);
    setReliefBusy(true);
    try {
      applyStatus(await usageService.clearDailyBudgetRelief());
      setNotice(t("cost.dailyLimitReliefRevoked"));
    } catch (e) {
      handleClientError(e, {
        module: "components:usage:DailyBudgetPanel",
        action: "revokeRelief",
      });
      setError(e instanceof Error ? e.message : t("cost.dailyLimitSaveFailed"));
    } finally {
      setReliefBusy(false);
    }
  };

  /** 临时提额（D-b）：按倍数或按增量，配时长（到期自动恢复原上限） */
  const handleBoost = async () => {
    if (reliefMode === "factor") {
      const factor = Number(reliefFactor);
      if (!Number.isFinite(factor) || factor <= 1) {
        setNotice(null);
        setError(t("cost.dailyLimitReliefInvalid"));
        return;
      }
      await submitRelief(
        { kind: "boost", factor, ttlMs: reliefTtlMs },
        "cost.dailyLimitReliefBoostConfirm",
      );
      return;
    }
    const amount = Number(reliefAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setNotice(null);
      setError(t("cost.dailyLimitReliefInvalid"));
      return;
    }
    await submitRelief(
      { kind: "boost", amount, ttlMs: reliefTtlMs },
      "cost.dailyLimitReliefBoostConfirm",
    );
  };

  /** 当日解除（D-b / D-m：仍保留原上限 ×5 的软上限） */
  const handleUnlockToday = () =>
    submitRelief(
      { kind: "unlock-today" },
      "cost.dailyLimitReliefUnlockTodayConfirm",
    );

  /** 保存放行默认值（D-h）；`configService.set` 内部已兜底并上报，失败不阻断面板 */
  const handleSavePrefs = async () => {
    const factor = Number(prefs.defaultFactor);
    if (!Number.isFinite(factor) || factor <= 1) {
      setNotice(null);
      setError(t("cost.dailyLimitReliefInvalid"));
      return;
    }
    setNotice(null);
    setError(null);
    setPrefsSaving(true);
    await configService.set(RELIEF_PREFS_KEY, {
      defaultFactor: factor,
      defaultTtlMs: prefs.defaultTtlMs,
      requireConfirm: prefs.requireConfirm,
    });
    setReliefFactor(String(factor));
    setReliefTtlMs(prefs.defaultTtlMs);
    setNotice(t("cost.dailyLimitPrefsSaved"));
    setPrefsSaving(false);
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

            {/* D-b/D-d：有效上限 / 欠账 / 当前放行（D-h 只读展示） */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitEffectiveLimit")}
                </p>
                <p className="text-lg font-semibold">
                  {formatNumber(
                    status.relief?.effectiveLimit ?? status.dailyLimit,
                  )}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitDebt")}
                </p>
                <p
                  className={`text-lg font-semibold ${
                    status.debt > 0
                      ? "text-orange-600 dark:text-orange-400"
                      : ""
                  }`}
                >
                  {formatNumber(status.debt)}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitActiveRelief")}
                </p>
                {status.relief ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {`${t(reliefKindKey(status.relief.kind))} · ${reliefExpiryText(
                        status.relief.expiresAt,
                        t,
                      )}`}
                    </p>
                    {/* D-b 对称回路：收回放行（保留今日用量） */}
                    <button
                      data-testid="daily-budget-revoke-relief"
                      onClick={() => void handleRevokeRelief()}
                      disabled={reliefBusy}
                      className="text-xs text-red-500 hover:underline shrink-0 disabled:opacity-50"
                    >
                      {t("cost.dailyLimitReliefRevoke")}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm font-medium">
                    {t("cost.dailyLimitReliefNone")}
                  </p>
                )}
              </div>
            </div>

            {/* 债四 USD-3（方案 §6.3）：金额口径**只读**展示。
                未配置上限 ⇒ 显式「未启用」而非 `$0.00`（0 是"上限 0"的误读）。 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitUsdUsed")}
                </p>
                <p className="text-lg font-semibold">
                  {formatUsd(status.usedUsd)}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitUsdDebt")}
                </p>
                <p
                  className={`text-lg font-semibold ${
                    status.debtUsd > 0
                      ? "text-orange-600 dark:text-orange-400"
                      : ""
                  }`}
                >
                  {formatUsd(status.debtUsd)}
                </p>
              </div>
              <div className="p-3 rounded bg-gray-50 dark:bg-gray-900">
                <p className="text-xs text-gray-500">
                  {t("cost.dailyLimitUsdCap")}
                </p>
                <p className="text-lg font-semibold">
                  {status.limitUsd === null
                    ? t("cost.dailyLimitUsdDisabled")
                    : formatUsd(status.limitUsd)}
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              {t("cost.dailyLimitDateLabel")}: {status.date} ·{" "}
              {t("cost.dailyLimitNote")}
            </p>
          </>
        )}
      </div>

      {/* 急救放行（D-b）：撞限时当场可继续，不必先改配置 */}
      <div className={panelCls}>
        <h3 className="text-lg font-medium mb-1">
          {t("cost.dailyLimitReliefTitle")}
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          {t("cost.dailyLimitReliefDesc")}
        </p>

        {status?.killSwitch && (
          <p className="text-xs text-red-500 mb-3">
            {t("cost.dailyLimitReliefLockedByKillSwitch")}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitReliefMode")}
            </span>
            <select
              value={reliefMode}
              onChange={(e) =>
                setReliefMode(e.target.value as "factor" | "amount")
              }
              className={inputCls}
            >
              <option value="factor">
                {t("cost.dailyLimitReliefModeFactor")}
              </option>
              <option value="amount">
                {t("cost.dailyLimitReliefModeAmount")}
              </option>
            </select>
          </label>
          {reliefMode === "factor" ? (
            <label className="block">
              <span className="text-xs text-gray-500">
                {t("cost.dailyLimitReliefFactor")}
              </span>
              <input
                type="number"
                min={2}
                step={1}
                value={reliefFactor}
                onChange={(e) => setReliefFactor(e.target.value)}
                className={inputCls}
              />
            </label>
          ) : (
            <label className="block">
              <span className="text-xs text-gray-500">
                {t("cost.dailyLimitReliefAmount")}
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={reliefAmount}
                onChange={(e) => setReliefAmount(e.target.value)}
                className={inputCls}
              />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitReliefTtl")}
            </span>
            <select
              value={reliefTtlMs}
              onChange={(e) => setReliefTtlMs(Number(e.target.value))}
              className={inputCls}
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.ms} value={o.ms}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleBoost}
            disabled={reliefBusy}
            className="px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
          >
            {t("cost.dailyLimitReliefSubmit")}
          </button>
          <button
            onClick={handleUnlockToday}
            disabled={reliefBusy}
            className="px-4 py-2 text-sm rounded-lg border border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50"
          >
            {t("cost.dailyLimitReliefUnlockToday")}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {t("cost.dailyLimitReliefNote")}
        </p>
      </div>

      {/* 放行默认值（D-h）：提额默认倍数/时长 + 是否二次确认 */}
      <div className={panelCls}>
        <h3 className="text-lg font-medium mb-4">
          {t("cost.dailyLimitPrefsTitle")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitPrefsFactor")}
            </span>
            <input
              type="number"
              min={2}
              step={1}
              value={prefs.defaultFactor}
              onChange={(e) =>
                setPrefs({ ...prefs, defaultFactor: e.target.value })
              }
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitPrefsTtl")}
            </span>
            <select
              value={prefs.defaultTtlMs}
              onChange={(e) =>
                setPrefs({ ...prefs, defaultTtlMs: Number(e.target.value) })
              }
              className={inputCls}
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.ms} value={o.ms}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 md:mt-5">
            <input
              type="checkbox"
              checked={prefs.requireConfirm}
              onChange={(e) =>
                setPrefs({ ...prefs, requireConfirm: e.target.checked })
              }
            />
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitPrefsRequireConfirm")}
            </span>
          </label>
        </div>
        <button
          onClick={handleSavePrefs}
          disabled={prefsSaving}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
        >
          {t("cost.dailyLimitPrefsSave")}
        </button>
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
        {/* 债四 USD-3（方案 §6.3）：金额口径上限 —— **留空 = 不启用**。
            Token 口径**保留**为辅助口径（本行不改上面三个控件的语义）。 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <label className="block">
            <span className="text-xs text-gray-500">
              {t("cost.dailyLimitUsd")}
            </span>
            <input
              data-testid="daily-budget-usd-input"
              type="number"
              min={0}
              step="0.01"
              placeholder={t("cost.dailyLimitUsdPlaceholder")}
              value={usdLimitInput}
              onChange={(e) => setUsdLimitInput(e.target.value)}
              className={inputCls}
            />
          </label>
          <p className="md:col-span-2 self-end text-xs text-gray-400">
            {t("cost.dailyLimitUsdHint")}
          </p>
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
