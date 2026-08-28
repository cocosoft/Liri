import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ConfigSection, ToggleConfig } from "./ConfigComponents";
import { useModelAdminStore } from "../../stores/modelAdminStore";
import { useModelStore } from "../../stores/modelStore";
import { modelService } from "../../services/modelService";
import { configService } from "../../services/configService";
import { PROVIDER_TYPE_LABELS } from "../../config/providerPresets";
import { handleClientError } from "../../utils/handleError";

interface AIConfigProps {
  isDark: boolean;
  collapsible?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  deepseek: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  openai:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  anthropic:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  google: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ollama:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  llamacpp: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  siliconflow: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  zhipu:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
};

function AIConfigPanel({ isDark, collapsible }: AIConfigProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { providers, loadProviders, toggleProvider } = useModelAdminStore();
  const { models, loadModels } = useModelStore();
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>(
    {},
  );
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** D3 自愈开关：未知模型自动登记并放行 */
  const [autoRegisterUnknown, setAutoRegisterUnknown] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const loadConfigFlag = useCallback(async () => {
    try {
      const res = (await configService.get(
        "ai.autoRegisterUnknownModels",
      )) as { value?: boolean } | undefined;
      setAutoRegisterUnknown(!!res?.value);
    } catch {
      // @ignore-catch: 读取失败保持默认
    }
  }, []);

  const handleToggleAutoRegister = async (next: boolean) => {
    const prev = autoRegisterUnknown;
    setAutoRegisterUnknown(next); // 乐观更新
    setConfigSaving(true);
    try {
      await configService.set("ai.autoRegisterUnknownModels", next);
    } catch (e) {
      setAutoRegisterUnknown(prev); // 失败回滚
      handleClientError(e, {
        module: "settings:ai",
        action: "set_auto_register_unknown",
      });
      setError(e instanceof Error ? e.message : "保存模型策略失败");
    } finally {
      setConfigSaving(false);
    }
  };

  const loadStatus = useCallback(async () => {
    try {
      const statuses = await modelService.providerStatus();
      const map: Record<string, boolean> = {};
      for (const s of statuses) {
        map[s.providerType] = s.running;
      }
      setProviderStatus(map);
    } catch {
      // @ignore-catch: 状态探测失败不阻断
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([
        loadProviders(),
        loadModels(),
        loadStatus(),
        loadConfigFlag(),
      ]);
    } catch (e) {
      handleClientError(e, { module: "settings:ai", action: "load" });
      setError(e instanceof Error ? e.message : "加载 AI 配置失败");
    }
  }, [loadProviders, loadModels, loadStatus, loadConfigFlag]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleProvider = async (id: string) => {
    try {
      await toggleProvider(id);
    } catch (e) {
      handleClientError(e, {
        module: "settings:ai",
        action: "toggle_provider",
      });
      setError(e instanceof Error ? e.message : "切换 Provider 状态失败");
    }
  };

  const handleDetectLocal = async () => {
    setDetecting(true);
    try {
      await loadStatus();
    } finally {
      setDetecting(false);
    }
  };

  const handleNavigateToModels = () => {
    navigate("/models");
  };

  const activeProviders = providers.filter((p) => p.isActive);
  const localProviders = providers.filter(
    (p) => p.providerType === "ollama" || p.providerType === "llamacpp",
  );
  const cloudProviders = providers.filter(
    (p) => p.providerType !== "ollama" && p.providerType !== "llamacpp",
  );

  const renderProviderCard = (provider: (typeof providers)[number]) => {
    const typeLabel =
      PROVIDER_TYPE_LABELS[provider.providerType] || provider.providerType;
    const colorClass =
      TYPE_COLORS[provider.providerType] || "bg-gray-100 text-gray-700";
    const isLocal =
      provider.providerType === "ollama" ||
      provider.providerType === "llamacpp";
    const localRunning = isLocal
      ? providerStatus[provider.providerType]
      : undefined;

    return (
      <div
        key={provider.id}
        className={`p-3 rounded-lg border ${
          isDark ? "border-gray-700 bg-gray-800/50" : "border-gray-200 bg-white"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
              >
                {typeLabel}
              </span>
              <span className="font-medium text-sm truncate">
                {provider.name}
              </span>
              {isLocal && (
                <span
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    localRunning
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  }`}
                >
                  {localRunning ? "● 运行中" : "○ 未连接"}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
              {provider.baseUrl}
              {provider.requiresAuth && provider.hasKey
                ? " · API Key 已配置"
                : provider.requiresAuth
                  ? " · 未配置 API Key"
                  : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ToggleConfig
              isDark={isDark}
              checked={provider.isActive}
              onChange={() => void handleToggleProvider(provider.id)}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <ConfigSection
      title={t("settings.aiConfig")}
      description={`已配置 ${providers.length} 个 Provider · ${activeProviders.length} 个启用 · ${models.length} 个模型`}
      isDark={isDark}
      collapsible={collapsible}
    >
      <div className="space-y-4">
        {error && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 快速操作栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleNavigateToModels}
            className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            模型管理 →
          </button>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            🔄 刷新
          </button>
          {localProviders.length > 0 && (
            <button
              onClick={() => void handleDetectLocal()}
              disabled={detecting}
              className="px-3 py-1.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50"
            >
              {detecting ? "检测中…" : "🔍 检测本地服务"}
            </button>
          )}
        </div>

        {/* 模型策略：D3 自愈开关（ai.autoRegisterUnknownModels） */}
        <div
          className={`p-3 rounded-lg border ${
            isDark ? "border-gray-700 bg-gray-800/50" : "border-gray-200 bg-white"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">未知模型自动登记</div>
              <div
                className={`text-xs mt-0.5 ${
                  isDark ? "text-gray-400" : "text-gray-500"
                }`}
              >
                使用未登记的模型时，自动登记为自定义模型并放行本次请求（自愈模式）。
                关闭则拒绝调用并提示到模型管理登记。
              </div>
            </div>
            <ToggleConfig
              isDark={isDark}
              checked={autoRegisterUnknown}
              onChange={(v) => void handleToggleAutoRegister(v)}
              disabled={configSaving}
            />
          </div>
        </div>

        {/* 本地推理 Provider */}
        {localProviders.length > 0 && (
          <div>
            <h4
              className={`text-xs font-medium mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              本地推理
            </h4>
            <div className="space-y-2">
              {localProviders.map(renderProviderCard)}
            </div>
          </div>
        )}

        {/* 云端 Provider */}
        {cloudProviders.length > 0 && (
          <div>
            <h4
              className={`text-xs font-medium mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              云端服务
            </h4>
            <div className="space-y-2">
              {cloudProviders.map(renderProviderCard)}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {providers.length === 0 && (
          <div
            className={`p-6 text-center rounded-lg border-2 border-dashed ${
              isDark
                ? "border-gray-700 text-gray-500"
                : "border-gray-300 text-gray-400"
            }`}
          >
            <div className="text-sm mb-3">尚未配置任何 AI Provider</div>
            <button
              onClick={handleNavigateToModels}
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              前往模型管理添加 →
            </button>
          </div>
        )}
      </div>
    </ConfigSection>
  );
}

export default AIConfigPanel;
