/**
 * 命令执行沙箱配置面板（S3，2026-11-17；设置方案 §4 / §11）
 *
 * 用户点名的能力：**沙箱的启停交给用户在设置里配置**。本面板写 `sandbox.landlock.*` 四项：
 * - `enabled`：总开关（关闭 ⇒ 完全走本地执行路径）；
 * - `bashEnabled`：让 bash / powershell / code_run 进平台沙箱（危险开关，默认关）；
 * - `failClosed`：**沙箱初始化失败（exit 125）**时是否拒绝（危险开关，默认关）；
 * - `bashExtraWritablePaths`：额外可写路径（仅 bashEnabled 生效）。
 *
 * 三条纪律（与后端探针同口径，不在前端另写判定）：
 * 1. `effective` / helper 事实全部来自 `GET /v1/diagnostics/sandbox/probe`；
 * 2. helper 明确不可执行（`runnable === false`）时开启 `bashEnabled` 必须先勾选知晓；
 * 3. 两个危险开关与「恢复默认」都要二次确认；保存后强制 `?refresh=1` 重测再回显。
 *
 * 如实边界：Windows 的 `runnable` 恒为 `null`（helper 尚无 `--probe` 契约）⇒ 界面显示
 * 「未验证」，不当成可用或不可用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  sandboxService,
  type SandboxLandlockConfig,
  type SandboxProbe,
} from "../../../services/sandboxService";
import { handleClientError } from "../../../utils/handleError";

interface Props {
  isDark: boolean;
}

/** 需要二次确认的动作 */
type PendingAction = "bashEnabled" | "failClosed" | "restore" | null;

export default function CommandSandboxPanel({ isDark }: Props) {
  const { t } = useTranslation();
  const [probe, setProbe] = useState<SandboxProbe | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  /** helper 明确不可执行时，开启 bashEnabled 的知晓勾选（未勾选 ⇒ 确认按钮禁用） */
  const [ackUnrunnable, setAckUnrunnable] = useState(false);
  const [pathInput, setPathInput] = useState("");
  /** 保存被「应用数据目录保护」拦下时，保留待重试的补丁 + 理由输入 */
  const [forceReason, setForceReason] = useState("");
  const [blockedPatch, setBlockedPatch] =
    useState<Partial<SandboxLandlockConfig> | null>(null);

  /**
   * `t` 的**稳定承接**（2026-11-21，CI 偶发红实证）。
   *
   * `load` 只在**错误**分支用到 `t`；若把 `load` 建在 `t` 上，`useEffect([load])` 会在 `t` 身份
   * 变化时重跑 —— i18n 状态/语言切换乃至测试里的 `t` 工厂都会让每次渲染重发一次探针
   * （实测保存流程内多出 **8 次** 无参探针，并把「保存后强制 `refresh=1` 重测」挤成**非最后一次**
   * 调用 ⇒ `toHaveBeenLastCalledWith(true)` 在慢机器上必现失败）。用 ref 承接后 `load` 身份稳定，
   * 初始探针只跑一次；保存路径仍按需显式 `getCommandSandboxProbe(true)`。
   */
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      setProbe(await sandboxService.getCommandSandboxProbe(refresh));
      setError(null);
    } catch (e) {
      handleClientError(e, {
        module: "views:sandbox:CommandSandboxPanel",
        action: "load",
      });
      setError(tRef.current("sandbox.commandSandboxLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  /**
   * 保存一个补丁并**强制重测**回显。
   *
   * 保存后必须 `refresh=true`：三平台探测器都有模块级缓存（Windows 无失效条件），
   * 不重测会把旧 `effective` 回显给用户。
   */
  const save = async (
    patch: Partial<SandboxLandlockConfig>,
    options: { forceWithReason?: string } = {},
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sandboxService.updateLandlockConfig(patch, options);
      setBlockedPatch(null);
      setForceReason("");
      setPendingAction(null);
      setProbe(await sandboxService.getCommandSandboxProbe(true));
    } catch (e) {
      handleClientError(e, {
        module: "views:sandbox:CommandSandboxPanel",
        action: "save",
      });
      const message = e instanceof Error ? e.message : "";
      // 后端对「应用数据目录子树」的拒绝文案含 forceWithReason ⇒ 给出重试入口
      if (message.includes("forceWithReason")) {
        setBlockedPatch(patch);
      }
      setError(message || t("sandbox.commandSandboxSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const config = probe?.config ?? null;
  const helperUnrunnable = probe?.helper.runnable === false;

  const cardClass = isDark
    ? "rounded-lg border border-gray-700 bg-gray-800 p-6"
    : "rounded-lg border border-gray-200 bg-white p-6";
  const labelClass = isDark ? "text-gray-300" : "text-gray-700";
  const valueClass = isDark ? "text-gray-100" : "text-gray-900";
  const mutedClass = isDark ? "text-gray-400" : "text-gray-500";
  const warnClass = isDark ? "text-amber-400" : "text-amber-600";
  const dangerClass = isDark ? "text-red-400" : "text-red-600";
  const inputClass = isDark
    ? "bg-gray-900 border-gray-600 text-gray-200"
    : "bg-white border-gray-300 text-gray-800";
  const confirmClass = isDark
    ? "rounded border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
    : "rounded border border-amber-400 bg-amber-50 p-3 space-y-2";
  const primaryButton =
    "px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50";
  const dangerButton =
    "px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50";
  const plainButton = `px-2 py-1 text-xs rounded border ${inputClass}`;

  const effectiveLabel = (): string => {
    switch (probe?.effective) {
      case "isolated":
        return t("sandbox.commandSandboxEffectiveIsolated");
      case "refuse":
        return t("sandbox.commandSandboxEffectiveRefuse");
      case "plain":
        return t("sandbox.commandSandboxEffectivePlain");
      case "off":
        return t("sandbox.commandSandboxEffectiveOff");
      default:
        return "-";
    }
  };

  /** 三态布尔渲染：`null` = 本平台无执行探测契约（如实显示「未验证」） */
  const triState = (value: boolean | null | undefined): string => {
    if (value === null || value === undefined) {
      return t("sandbox.commandSandboxUnverified");
    }
    return value
      ? t("sandbox.commandSandboxYes")
      : t("sandbox.commandSandboxNo");
  };

  const renderConfirm = (action: Exclude<PendingAction, null>) => {
    const isRestore = action === "restore";
    const title = isRestore
      ? t("sandbox.commandSandboxConfirmRestoreTitle")
      : action === "bashEnabled"
        ? t("sandbox.commandSandboxConfirmBashTitle")
        : t("sandbox.commandSandboxConfirmFailClosedTitle");
    const body = isRestore
      ? t("sandbox.commandSandboxConfirmRestoreBody")
      : action === "bashEnabled"
        ? t("sandbox.commandSandboxConfirmBashBody")
        : t("sandbox.commandSandboxConfirmFailClosedBody");
    const confirmLabel = isRestore
      ? t("sandbox.commandSandboxConfirmRestore")
      : t("sandbox.commandSandboxConfirmEnable");
    const confirmDisabled =
      busy || (action === "bashEnabled" && helperUnrunnable && !ackUnrunnable);

    return (
      <div className={confirmClass}>
        <p className={`text-xs font-medium ${warnClass}`}>{title}</p>
        <p className={`text-[11px] ${mutedClass}`}>{body}</p>
        {action === "bashEnabled" && helperUnrunnable && (
          <div className="space-y-1">
            <p className={`text-[11px] ${dangerClass}`}>
              {t("sandbox.commandSandboxUnrunnableWarn")}
            </p>
            <label
              className={`flex items-center gap-2 text-[11px] ${labelClass}`}
            >
              <input
                type="checkbox"
                checked={ackUnrunnable}
                onChange={(e) => setAckUnrunnable(e.target.checked)}
              />
              <span>{t("sandbox.commandSandboxUnrunnableAck")}</span>
            </label>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (isRestore) {
                void save({
                  enabled: true,
                  bashEnabled: false,
                  failClosed: false,
                  bashExtraWritablePaths: [],
                });
                return;
              }
              const enablePatch: Partial<SandboxLandlockConfig> =
                action === "bashEnabled"
                  ? { bashEnabled: true }
                  : { failClosed: true };
              void save(enablePatch);
            }}
            disabled={confirmDisabled}
            className={dangerButton}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => setPendingAction(null)}
            className={plainButton}
          >
            {t("sandbox.commandSandboxCancel")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`${cardClass} mb-6`}>
      <h3 className={`text-lg font-semibold mb-1 ${valueClass}`}>
        {t("sandbox.commandSandboxTitle")}
      </h3>
      <p className={`text-xs mb-4 ${mutedClass}`}>
        {t("sandbox.commandSandboxSubtitle")}
      </p>

      {loading && !probe ? (
        <p className={`text-sm ${mutedClass}`}>
          {t("sandbox.commandSandboxLoading")}
        </p>
      ) : (
        <div className="space-y-4">
          {/* 探针结论（全部来自后端，前端不推断） */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <div className={`text-xs ${mutedClass}`}>
                {t("sandbox.commandSandboxEffectiveLabel")}
              </div>
              <div className={`text-sm font-medium ${valueClass}`}>
                {effectiveLabel()}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass}`}>
                {t("sandbox.commandSandboxHelperReason")}
              </div>
              <div className={`text-sm font-medium ${valueClass}`}>
                <code>{probe?.helper.reasonCode ?? "-"}</code>
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass}`}>
                {t("sandbox.commandSandboxHelperRunnable")}
              </div>
              <div className={`text-sm font-medium ${valueClass}`}>
                {triState(probe?.helper.runnable)}
              </div>
            </div>
          </div>

          {helperUnrunnable && (
            <p className={`text-xs ${dangerClass}`}>
              {t("sandbox.commandSandboxUnrunnableWarn")}
            </p>
          )}

          {probe && probe.notes.length > 0 && (
            <ul className={`text-[11px] list-disc pl-4 ${mutedClass}`}>
              {probe.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          {/* 三个开关（两个危险项走二次确认） */}
          <div className="space-y-2">
            <label className={`flex items-center gap-2 text-sm ${labelClass}`}>
              <input
                type="checkbox"
                checked={config?.enabled ?? false}
                disabled={!config || busy || pendingAction !== null}
                onChange={(e) => void save({ enabled: e.target.checked })}
              />
              <span>{t("sandbox.commandSandboxEnabledLabel")}</span>
            </label>
            <label className={`flex items-center gap-2 text-sm ${labelClass}`}>
              <input
                type="checkbox"
                checked={config?.bashEnabled ?? false}
                disabled={!config || busy || pendingAction !== null}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPendingAction("bashEnabled");
                  } else {
                    void save({ bashEnabled: false });
                  }
                }}
              />
              <span>{t("sandbox.commandSandboxBashEnabledLabel")}</span>
            </label>
            <label className={`flex items-center gap-2 text-sm ${labelClass}`}>
              <input
                type="checkbox"
                checked={config?.failClosed ?? false}
                disabled={!config || busy || pendingAction !== null}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPendingAction("failClosed");
                  } else {
                    void save({ failClosed: false });
                  }
                }}
              />
              <span>{t("sandbox.commandSandboxFailClosedLabel")}</span>
            </label>
            <p className={`text-[11px] ${mutedClass}`}>
              {t("sandbox.commandSandboxFailClosedHint")}
            </p>
            <p className={`text-[11px] ${mutedClass}`}>
              {t("sandbox.commandSandboxApplyHint")}
            </p>
          </div>

          {pendingAction && renderConfirm(pendingAction)}

          {/* 额外可写路径（保存即生效，逐条增删） */}
          <div className="space-y-2">
            <div className={`text-sm font-medium ${labelClass}`}>
              {t("sandbox.commandSandboxPathsTitle")}
            </div>
            {(config?.bashExtraWritablePaths ?? []).length === 0 ? (
              <p className={`text-[11px] ${mutedClass}`}>
                {t("sandbox.commandSandboxPathsEmpty")}
              </p>
            ) : (
              <div className="space-y-1">
                {(config?.bashExtraWritablePaths ?? []).map((path) => (
                  <div
                    key={path}
                    className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${
                      isDark ? "bg-gray-900/60" : "bg-gray-50"
                    }`}
                  >
                    <code className="break-all flex-1">{path}</code>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void save({
                          bashExtraWritablePaths: (
                            config?.bashExtraWritablePaths ?? []
                          ).filter((item) => item !== path),
                        })
                      }
                      className={`${dangerClass} disabled:opacity-50`}
                    >
                      {t("sandbox.commandSandboxRemovePath")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder={t("sandbox.commandSandboxPathPlaceholder")}
                className={`flex-1 px-2 py-1 text-xs rounded border ${inputClass}`}
              />
              <button
                type="button"
                disabled={busy || !pathInput.trim() || !config}
                onClick={() => {
                  const next = pathInput.trim();
                  if (!next || !config) return;
                  setPathInput("");
                  void save({
                    bashExtraWritablePaths: [
                      ...config.bashExtraWritablePaths,
                      next,
                    ],
                  });
                }}
                className={primaryButton}
              >
                {t("sandbox.commandSandboxAddPath")}
              </button>
            </div>
          </div>

          {/* 应用数据目录保护：后端要求显式理由时才出现重试入口 */}
          {blockedPatch && (
            <div className={confirmClass}>
              <p className={`text-[11px] ${warnClass}`}>
                {t("sandbox.commandSandboxForceReasonLabel")}
              </p>
              <input
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                placeholder={t("sandbox.commandSandboxForceReasonPlaceholder")}
                className={`w-full px-2 py-1 text-xs rounded border ${inputClass}`}
              />
              <button
                type="button"
                disabled={busy || !forceReason.trim()}
                onClick={() =>
                  void save(blockedPatch, { forceWithReason: forceReason })
                }
                className={dangerButton}
              >
                {t("sandbox.commandSandboxRetryWithReason")}
              </button>
            </div>
          )}

          {error && <p className={`text-xs ${dangerClass}`}>{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy || !config}
              onClick={() => setPendingAction("restore")}
              className={plainButton}
            >
              {t("sandbox.commandSandboxRestoreDefaults")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(true)}
              className={plainButton}
            >
              {t("sandbox.commandSandboxReprobe")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
