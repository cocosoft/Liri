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
  label: string;
}> = [
  { value: "full", label: "完整（读写 + 执行）" },
  { value: "standard", label: "标准（读写）" },
  { value: "readonly", label: "只读（仅可读）" },
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
      setError("沙箱状态加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

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
            沙箱安全护栏
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
            加载中...
          </div>
        ) : (
          <>
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
                    权限级别
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_LEVELS.map((level) => (
                      <button
                        key={level.value}
                        onClick={() => changePermissionLevel(level.value)}
                        disabled={!sandboxConfig}
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
                        {level.label}
                      </button>
                    ))}
                  </div>
                  <p className={`text-xs mt-2 ${mutedClass}`}>
                    决定新沙箱工作空间的授权范围：完整 = 读写 + 执行，标准 =
                    读写， 只读 = 仅可读。现有工作空间不受影响。
                  </p>
                </div>
              </div>
            </div>

            {/* 运行时状态 */}
            <div className={`${cardClass} mb-6`}>
              <h3 className={`text-lg font-semibold mb-4 ${valueClass}`}>
                运行时状态
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <div className={`text-xs ${mutedClass}`}>启用状态</div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.enabled ? "已启用" : "未启用"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>违规拦截次数</div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.violationCount ?? "-"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>活跃工作空间</div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.activeWorkspaceCount ?? "-"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>进程总数</div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.processStats.total ?? "-"}
                    {status && status.processStats.total > 0 && (
                      <span className={`text-xs ${mutedClass}`}>
                        {" "}
                        （运行中 {status.processStats.running}）
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>资源限制插件</div>
                  <div className={`text-sm font-medium ${valueClass}`}>
                    {status?.resourceSummary.totalPlugins ?? "-"}
                  </div>
                </div>
                <div>
                  <div className={`text-xs ${mutedClass}`}>活跃执行</div>
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
                  隔离约束
                </h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className={mutedClass}>运行时长上限：</span>
                    <span className={valueClass}>
                      {status.constraints.maxOutputBytes
                        ? `${Math.round(status.constraints.maxOutputBytes / 1024 / 1024)}MB`
                        : "-"}
                    </span>
                  </div>
                  <div>
                    <span className={mutedClass}>允许命令白名单：</span>
                    <span className={valueClass}>
                      {status.constraints.allowedCommands?.length
                        ? status.constraints.allowedCommands.join("、")
                        : "未配置"}
                    </span>
                  </div>
                  <div>
                    <span className={mutedClass}>禁止命令黑名单：</span>
                    <span className={valueClass}>
                      {status.constraints.deniedCommands?.length
                        ? status.constraints.deniedCommands.join("、")
                        : "未配置"}
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
