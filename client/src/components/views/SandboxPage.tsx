import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import {
  sandboxService,
  type SandboxConfig,
  type SandboxStatus,
  type SandboxPermissionLevel,
} from "../../services/sandboxService";
import { handleClientError } from "../../utils/handleError";

/** 权限级别选项（与后端 PERMISSION_SANDBOX_DEFAULT 一致） */
const PERMISSION_LEVELS: Array<{
  value: SandboxPermissionLevel;
  labelKey: string;
}> = [
  { value: "full", labelKey: "sandbox.permissionFull" },
  { value: "standard", labelKey: "sandbox.permissionStandard" },
  { value: "readonly", labelKey: "sandbox.permissionReadonly" },
];

function SandboxPage() {
  const { t } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";

  const [sandboxConfig, setSandboxConfig] = useState<SandboxConfig | null>(
    null,
  );
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, st] = await Promise.all([
        sandboxService.getConfig(),
        sandboxService.getStatus(),
      ]);
      setSandboxConfig(cfg);
      setStatus(st);
    } catch (e) {
      handleClientError(e, { module: "views:SandboxPage", action: "load" });
      setError(t("sandbox.statusLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
    load();
  }, [loadConfig, load]);

  const toggleEnabled = async () => {
    if (!sandboxConfig) return;
    try {
      const next = await sandboxService.updateConfig({
        enabled: !sandboxConfig.enabled,
      });
      setSandboxConfig(next);
      setStatus((prev) => (prev ? { ...prev, enabled: next.enabled } : prev));
    } catch (e) {
      handleClientError(e, { module: "views:SandboxPage", action: "toggle" });
    }
  };

  const changePermissionLevel = async (level: SandboxPermissionLevel) => {
    if (!sandboxConfig) return;
    try {
      const next = await sandboxService.updateConfig({
        permissionLevel: level,
      });
      setSandboxConfig(next);
      setStatus((prev) =>
        prev ? { ...prev, permissionLevel: next.permissionLevel } : prev,
      );
    } catch (e) {
      handleClientError(e, {
        module: "views:SandboxPage",
        action: "changePermissionLevel",
      });
    }
  };

  const cardClass = isDark
    ? "rounded-lg border border-gray-700 bg-gray-800 p-6"
    : "rounded-lg border border-gray-200 bg-white p-6";

  /**
   * P1-1（2026-10-27）：无隔离证据时（`runtimeIsolation === 'none'`，如 Windows 桌面）
   * 权限级别只进 `PERMISSION_RANK`，豁免链在 S1 已先拒 ⇒ 级别对实际行为零影响。
   * 因此**诚实降级**：控件禁用 + 说明，不虚构"配了就有用"。
   */
  const levelInactive = sandboxConfig?.runtimeIsolation === "none";

  /**
   * A5-①（2026-11-05）：把「当前到底受不受内核级约束」摊开给用户看。
   * 全部取自后端 `/v1/sandbox/status` 的 `posture`（语言中立编码 + 布尔事实），
   * 不在前端自行推断，避免与真实判定漂移。
   */
  const posture = status?.posture ?? null;
  const postureLines = posture
    ? [
        posture.mode === "none"
          ? t("sandbox.postureModeNone")
          : t("sandbox.postureModeEnforced"),
        posture.landlock.failClosed
          ? t("sandbox.postureFailClosed")
          : t("sandbox.postureFailOpen"),
        posture.landlock.bashEnabled
          ? t("sandbox.postureBashIn")
          : posture.bashSandboxReason === "platform-unsupported"
            ? t("sandbox.postureBashUnsupported")
            : t("sandbox.postureBashOut"),
        posture.bashInterpreterGuard
          ? t("sandbox.postureGuardOn")
          : t("sandbox.postureGuardOff"),
        // P2-c（2026-11-07）：权限档与沙箱解耦 —— 两者作用面不同，避免混为一谈
        t("sandbox.posturePermissionDecoupled"),
      ]
    : [];

  const labelClass = isDark ? "text-gray-300" : "text-gray-700";
  const valueClass = isDark ? "text-gray-100" : "text-gray-900";
  const mutedClass = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className={`text-xl font-semibold ${valueClass}`}>
            {t("sandbox.pageTitle")}
          </h2>
          <button
            onClick={toggleEnabled}
            disabled={!sandboxConfig}
            className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
              sandboxConfig?.enabled
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            {sandboxConfig?.enabled
              ? t("sandbox.disableSandbox")
              : t("sandbox.enableSandbox")}
          </button>
        </div>

        {error && (
          <div
            className={`mb-6 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-300" : "bg-red-50 text-red-700"}`}
          >
            {error}
          </div>
        )}

        {loading && !sandboxConfig ? (
          <div className={`${cardClass} text-center ${mutedClass}`}>
            {t("common.loading")}
          </div>
        ) : (
          <>
            {/* A5-①：当前安全姿态（如实告知受不受内核级约束） */}
            {posture && (
              <div className={`${cardClass} mb-6`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`text-lg font-semibold ${valueClass}`}>
                    {t("sandbox.postureTitle")}
                  </h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      posture.openRiskCodes.length > 0
                        ? isDark
                          ? "bg-amber-900/40 text-amber-300"
                          : "bg-amber-50 text-amber-700"
                        : isDark
                          ? "bg-green-900/40 text-green-300"
                          : "bg-green-50 text-green-700"
                    }`}
                  >
                    {posture.openRiskCodes.length > 0
                      ? t("sandbox.postureRiskCount", {
                          count: posture.openRiskCodes.length,
                        })
                      : t("sandbox.postureHealthy")}
                  </span>
                </div>
                <ul className={`space-y-1 text-sm ${labelClass}`}>
                  {postureLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 安全配置 */}
            <div className={`${cardClass} mb-6`}>
              <h3 className={`text-lg font-semibold mb-4 ${valueClass}`}>
                {t("sandbox.securityConfig")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label
                    className={`block text-sm font-medium mb-2 ${labelClass}`}
                  >
                    {t("sandbox.permissionLevel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_LEVELS.map((level) => (
                      <button
                        key={level.value}
                        onClick={() => changePermissionLevel(level.value)}
                        disabled={!sandboxConfig || levelInactive}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-50 ${
                          sandboxConfig?.permissionLevel === level.value
                            ? isDark
                              ? "bg-blue-900/40 border-blue-600 text-blue-300"
                              : "bg-blue-50 border-blue-500 text-blue-700"
                            : isDark
                              ? "border-gray-600 text-gray-300 hover:border-gray-500"
                              : "border-gray-300 text-gray-700 hover:border-gray-400"
                        }`}
                      >
                        {t(level.labelKey)}
                      </button>
                    ))}
                  </div>
                  <p className={`text-xs mt-2 ${mutedClass}`}>
                    {t("sandbox.permissionHint")}
                  </p>
                  {levelInactive && (
                    <p
                      className={`text-xs mt-1 ${isDark ? "text-amber-400" : "text-amber-600"}`}
                    >
                      {t("sandbox.permissionLevelInactive")}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 运行时状态 */}
            <div className={`${cardClass} mb-6`}>
              <h3 className={`text-lg font-semibold mb-4 ${valueClass}`}>
                {t("sandbox.runtimeStatus")}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <div className={`text-xs ${mutedClass}`}>
                    {t("sandbox.enabledStatus")}
                  </div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.enabled
                      ? t("common.enabled")
                      : t("sandbox.notEnabled")}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>
                    {t("sandbox.violationCount")}
                  </div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.violationCount ?? "-"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>
                    {t("sandbox.activeWorkspaces")}
                  </div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.activeWorkspaceCount ?? "-"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>
                    {t("sandbox.processTotal")}
                  </div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.processStats.total ?? "-"}
                    {status && status.processStats.total > 0 && (
                      <span className={`text-xs ${mutedClass}`}>
                        {" "}
                        {t("sandbox.runningCount", {
                          count: status.processStats.running,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>
                    {t("sandbox.resourceLimitPlugins")}
                  </div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.resourceSummary.totalPlugins ?? "-"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>
                    {t("sandbox.activeExecutions")}
                  </div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.resourceSummary.totalActive ?? "-"}
                  </div>
                </div>
              </div>
            </div>

            {/* 约束明细 */}
            {status && (
              <div className={`${cardClass}`}>
                <h3 className={`text-lg font-semibold mb-4 ${valueClass}`}>
                  {t("sandbox.constraints")}
                </h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className={mutedClass}>
                      {t("sandbox.maxDuration")}
                    </span>
                    <span className={valueClass}>
                      {status.constraints.maxOutputBytes
                        ? `${Math.round(status.constraints.maxOutputBytes / 1024 / 1024)}MB`
                        : "-"}
                    </span>
                  </div>
                  <div>
                    <span className={mutedClass}>
                      {t("sandbox.allowedCommandsLabel")}
                    </span>
                    <span className={valueClass}>
                      {status.constraints.allowedCommands?.length
                        ? status.constraints.allowedCommands.join("、")
                        : t("sandbox.notConfigured")}
                    </span>
                  </div>
                  <div>
                    <span className={mutedClass}>
                      {t("sandbox.deniedCommandsLabel")}
                    </span>
                    <span className={valueClass}>
                      {status.constraints.deniedCommands?.length
                        ? status.constraints.deniedCommands.join("、")
                        : t("sandbox.notConfigured")}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SandboxPage;
