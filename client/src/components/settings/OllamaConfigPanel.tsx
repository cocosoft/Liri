import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  TextConfig,
  ToggleConfig,
} from "./ConfigComponents";
import { useModelAdminStore } from "../../stores/modelAdminStore";
import { useModelStore } from "../../stores/modelStore";
import { modelService } from "../../services/modelService";
import { PROVIDER_TYPE_LABELS, PRESETS } from "../../config/providerPresets";
import { createLogger } from "../../utils/logger";
import { handleClientError } from "../../utils/handleError";

const logger = createLogger("settings:ollama");

interface OllamaConfigPanelProps {
  isDark: boolean;
}

function OllamaConfigPanel({ isDark }: OllamaConfigPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    providers,
    loadProviders,
    toggleProvider,
    updateProvider,
    createProvider,
  } = useModelAdminStore();
  const { models, loadModels } = useModelStore();

  const [ollamaStatus, setOllamaStatus] = useState<{
    running: boolean;
    port?: number;
    model?: string;
  } | null>(null);
  const [configUrl, setConfigUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const ollamaProvider = providers.find((p) => p.providerType === "ollama");
  const ollamaModelsInDb = models.filter((m) => {
    if (!ollamaProvider) return false;
    return m.providerId === ollamaProvider.id;
  });

  const loadStatus = useCallback(async (): Promise<{
    running: boolean;
    port?: number;
    model?: string;
  } | null> => {
    logger.info("开始检测 Ollama 服务状态");
    try {
      const statuses = await modelService.providerStatus();
      logger.debug("providerStatus 返回完整数据", {
        count: statuses.length,
        statuses: statuses.map((s) => ({
          providerType: s.providerType,
          running: s.running,
          detail: s.detail,
        })),
      });
      const ollamaStatusInfo = statuses.find(
        (s) => s.providerType === "ollama",
      );
      if (ollamaStatusInfo) {
        const result = {
          running: ollamaStatusInfo.running,
          port: ollamaStatusInfo.detail?.port,
          model: ollamaStatusInfo.detail?.model,
        };
        logger.info("检测到 Ollama Provider", result);
        setOllamaStatus(result);
        return result;
      } else {
        logger.warn(
          "providerStatus 列表中未找到 ollama 类型，Ollama Provider 可能未在后端注册",
        );
        setOllamaStatus({ running: false });
        return { running: false };
      }
    } catch (e) {
      logger.error("检测 Ollama 状态失败", {
        error: String(e),
        errorName: e instanceof Error ? e.name : undefined,
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      setOllamaStatus({ running: false });
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    logger.info("加载 Ollama 配置面板数据");
    try {
      await Promise.all([loadProviders(), loadModels(), loadStatus()]);
      const { providers: latestProviders } = useModelAdminStore.getState();
      const { models: latestModels } = useModelStore.getState();
      const provider = latestProviders.find((p) => p.providerType === "ollama");
      const url = provider?.baseUrl || "http://localhost:11434/v1";
      setConfigUrl(url);
      const ollamaModelsCount = latestModels.filter(
        (m) => provider && m.providerId === provider.id,
      ).length;
      logger.info("配置加载完成", {
        providerCount: latestProviders.length,
        hasOllamaProvider: !!provider,
        modelCount: latestModels.length,
        ollamaModelCount: ollamaModelsCount,
        configUrl: url,
      });
    } catch (e) {
      logger.error("加载 Ollama 配置失败", {
        error: String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      handleClientError(e, { module: "settings:ollama", action: "load" });
      setError(e instanceof Error ? e.message : t("settings.ollamaLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [loadProviders, loadModels, loadStatus, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDetect = async () => {
    setDetecting(true);
    setError(null);
    logger.info("手动触发 Ollama 检测");
    try {
      const statusResult = await loadStatus();
      await loadModels();
      const { providers: latestProviders } = useModelAdminStore.getState();
      const { models: latestModels } = useModelStore.getState();
      const provider = latestProviders.find((p) => p.providerType === "ollama");
      const ollamaRunning = statusResult?.running ?? false;
      const ollamaModelCount = provider
        ? latestModels.filter((m) => m.providerId === provider.id).length
        : 0;
      logger.info("Ollama 检测完成", {
        ollamaRunning,
        ollamaModelCount,
      });
    } catch (e) {
      logger.error("Ollama 检测失败", {
        error: String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      handleClientError(e, { module: "settings:ollama", action: "detect" });
      setError(
        e instanceof Error ? e.message : t("settings.ollamaDetectFailed"),
      );
    } finally {
      setDetecting(false);
    }
  };

  const handleSyncModels = async () => {
    setSyncing(true);
    setError(null);
    const beforeCount = ollamaModelsInDb.length;
    logger.info("刷新 Ollama 模型列表（从数据库）", { beforeCount });
    try {
      await loadModels();
      const { providers: latestProviders } = useModelAdminStore.getState();
      const { models: latestModels } = useModelStore.getState();
      const provider = latestProviders.find((p) => p.providerType === "ollama");
      const afterCount = provider
        ? latestModels.filter((m) => m.providerId === provider.id).length
        : 0;
      logger.info("模型列表刷新完成", { beforeCount, afterCount });
      setSavedMsg(t("settings.ollamaModelsRefreshed", { count: afterCount }));
    } catch (e) {
      logger.error("模型列表刷新失败", {
        error: String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      handleClientError(e, { module: "settings:ollama", action: "sync" });
      setError(
        e instanceof Error ? e.message : t("settings.ollamaRefreshFailed"),
      );
    } finally {
      setSyncing(false);
      setTimeout(() => setSavedMsg(null), 3000);
    }
  };

  const handleSaveConfig = async () => {
    if (!ollamaProvider) {
      logger.warn("保存配置被阻止：Ollama Provider 不存在");
      setError(t("settings.ollamaNoProvider"));
      return;
    }
    setSaving(true);
    setError(null);
    logger.info("保存 Ollama 监听地址", {
      providerId: ollamaProvider.id,
      oldUrl: ollamaProvider.baseUrl,
      newUrl: configUrl,
    });
    try {
      await updateProvider(ollamaProvider.id, { baseUrl: configUrl });
      logger.info("Ollama 地址保存成功", { configUrl });
      setSavedMsg(t("settings.ollamaAddressSaved", { url: configUrl }));
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      logger.error("保存 Ollama 配置失败", {
        providerId: ollamaProvider.id,
        configUrl,
        error: String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      handleClientError(e, { module: "settings:ollama", action: "save" });
      setError(e instanceof Error ? e.message : t("settings.ollamaSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!ollamaProvider) return;
    logger.info("切换 Ollama Provider 启用状态", {
      providerId: ollamaProvider.id,
      currentActive: ollamaProvider.isActive,
    });
    try {
      await toggleProvider(ollamaProvider.id);
      logger.info("Provider 状态切换完成");
    } catch (e) {
      logger.error("Provider 状态切换失败", {
        providerId: ollamaProvider.id,
        error: String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      handleClientError(e, { module: "settings:ollama", action: "toggle" });
      setError(
        e instanceof Error ? e.message : t("settings.ollamaToggleFailed"),
      );
    }
  };

  const handleNavigateToModels = () => {
    navigate("/models");
  };

  const handleAutoCreateProvider = async () => {
    setCreating(true);
    setError(null);
    logger.info("自动创建 Ollama Provider");
    const ollamaPreset = PRESETS.find((p) => p.providerType === "ollama");
    if (!ollamaPreset) {
      setError(t("settings.ollamaPresetMissing"));
      setCreating(false);
      return;
    }
    try {
      await createProvider(ollamaPreset.settingsConfig);
      logger.info("Ollama Provider 自动创建成功");
      setSavedMsg(t("settings.ollamaProviderCreated"));
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      logger.error("Ollama Provider 自动创建失败", {
        error: String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      handleClientError(e, { module: "settings:ollama", action: "create" });
      setError(
        e instanceof Error ? e.message : t("settings.ollamaAutoCreateFailed"),
      );
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className={`p-6 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
        {t("common.loadingEllipsis")}
      </div>
    );
  }

  const statusLabel = ollamaStatus?.running
    ? t("settings.ollamaRunning")
    : t("settings.ollamaDisconnected");
  const statusClass = ollamaStatus?.running
    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400";

  return (
    <div className="p-6">
      {/* 服务状态 */}
      <ConfigSection
        title={t("settings.ollama")}
        description={t("settings.ollamaDesc")}
        isDark={isDark}
      >
        <ConfigItem label={t("settings.serviceStatus")} isDark={isDark}>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}
            >
              {statusLabel}
            </span>
            {ollamaStatus?.running && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t("settings.ollamaPortLine", {
                  port: ollamaStatus.port || 11434,
                })}
                {ollamaStatus.model
                  ? t("settings.ollamaCurrentModel", {
                      model: ollamaStatus.model,
                    })
                  : ""}
              </span>
            )}
            {!ollamaStatus?.running && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t("settings.ollamaEnsureRunning")}
              </span>
            )}
          </div>
        </ConfigItem>

        <ConfigItem
          label={t("settings.listenAddress")}
          description={t("settings.ollamaAddressDesc")}
          isDark={isDark}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <TextConfig
              isDark={isDark}
              value={configUrl}
              onChange={setConfigUrl}
              placeholder="http://localhost:11434/v1"
              className="min-w-[240px]"
            />
            <button
              onClick={() => setConfigUrl("http://localhost:11434/v1")}
              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {t("settings.ollamaRestoreDefault")}
            </button>
          </div>
        </ConfigItem>

        {error && (
          <ConfigItem label="" isDark={isDark}>
            <span className="text-xs text-red-500">{error}</span>
          </ConfigItem>
        )}
        {savedMsg && (
          <ConfigItem label="" isDark={isDark}>
            <span className="text-xs text-green-600 dark:text-green-400">
              {savedMsg}
            </span>
          </ConfigItem>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => void handleDetect()}
            disabled={detecting}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              detecting
                ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {detecting
              ? t("settings.ollamaDetecting")
              : t("settings.ollamaDetect")}
          </button>
          <button
            onClick={() => void handleSaveConfig()}
            disabled={saving || !ollamaProvider}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              saving || !ollamaProvider
                ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                : "bg-indigo-500 hover:bg-indigo-600 text-white"
            }`}
          >
            {saving
              ? t("settings.ollamaSaving")
              : t("settings.ollamaSaveAddress")}
          </button>
          <button
            onClick={handleNavigateToModels}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            {t("settings.ollamaManageModels")}
          </button>
        </div>
      </ConfigSection>

      {/* Ollama Provider 配置 */}
      <ConfigSection
        title={t("settings.ollamaProviderConfig")}
        description={t("settings.ollamaProviderConfigDesc")}
        isDark={isDark}
      >
        {ollamaProvider ? (
          <>
            <ConfigItem
              label={t("settings.ollamaProviderName")}
              isDark={isDark}
            >
              <span className="text-sm">{ollamaProvider.name}</span>
            </ConfigItem>
            <ConfigItem label={t("settings.ollamaType")} isDark={isDark}>
              <span className="text-sm">
                {PROVIDER_TYPE_LABELS[ollamaProvider.providerType] ||
                  ollamaProvider.providerType}
              </span>
            </ConfigItem>
            <ConfigItem
              label={t("settings.ollamaEnabledState")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={ollamaProvider.isActive}
                onChange={() => void handleToggleActive()}
              />
            </ConfigItem>
            <ConfigItem
              label={t("settings.ollamaSyncedModels")}
              isDark={isDark}
            >
              <span className="text-sm">
                {t("settings.ollamaModelsCount", {
                  count: ollamaModelsInDb.length,
                })}
              </span>
            </ConfigItem>
          </>
        ) : (
          <div
            className={`p-4 text-center rounded-lg border-2 border-dashed ${
              isDark
                ? "border-gray-700 text-gray-500"
                : "border-gray-300 text-gray-400"
            }`}
          >
            <div className="text-sm mb-3">
              {t("settings.ollamaProviderMissing")}
            </div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => void handleAutoCreateProvider()}
                disabled={creating}
                className={`px-4 py-2 text-sm rounded ${
                  creating
                    ? "opacity-50 bg-gray-500 text-white"
                    : "bg-blue-500 text-white hover:bg-blue-600"
                }`}
              >
                {creating
                  ? t("settings.ollamaCreating")
                  : t("settings.ollamaQuickAdd")}
              </button>
              <button
                onClick={handleNavigateToModels}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                {t("settings.ollamaManualAdd")}
              </button>
            </div>
          </div>
        )}
      </ConfigSection>

      {/* 已同步模型（来自模型管理系统） */}
      <ConfigSection
        title={t("settings.ollamaInstalledModels")}
        description={t("settings.ollamaInstalledModelsDesc")}
        isDark={isDark}
      >
        {ollamaModelsInDb.length > 0 ? (
          <div className="space-y-1">
            {ollamaModelsInDb.map((model) => (
              <div
                key={model.id}
                className={`flex items-center justify-between gap-2 py-1.5 px-3 rounded ${
                  isDark ? "hover:bg-gray-800" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {model.modelId || model.id}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {model.enabled ? t("common.enabled") : t("common.disabled")}
                    {model.context_length
                      ? t("settings.ollamaContextLength", {
                          length: model.context_length,
                        })
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className={`text-sm text-center py-4 ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            {ollamaStatus?.running
              ? t("settings.ollamaRunningNotSynced")
              : t("settings.ollamaNotRunning")}
            <br />
            {ollamaStatus?.running && (
              <button
                onClick={() => void handleSyncModels()}
                disabled={syncing}
                className={`mt-2 px-4 py-1.5 text-sm rounded ${
                  syncing
                    ? "opacity-50 bg-gray-500 text-white"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                {syncing
                  ? t("settings.ollamaRefreshing")
                  : t("settings.ollamaRefreshModels")}
              </button>
            )}
            {!ollamaStatus?.running && (
              <>
                {t("settings.ollamaRunInTerminalPrefix")}
                <code className="px-1 rounded bg-gray-100 dark:bg-gray-800 text-xs">
                  ollama serve
                </code>
                {t("settings.ollamaRunInTerminalSuffix")}
              </>
            )}
          </div>
        )}

        {ollamaModelsInDb.length > 0 && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => void handleSyncModels()}
              disabled={syncing}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                syncing
                  ? "opacity-50 bg-gray-500 text-white"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              {syncing
                ? t("settings.ollamaRefreshing")
                : t("settings.ollamaRefreshList")}
            </button>
          </div>
        )}
      </ConfigSection>
    </div>
  );
}

export default OllamaConfigPanel;
