import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useModelStore } from "../../stores/modelStore";
import { useModelAdminStore } from "../../stores/modelAdminStore";
import { useConfigStore } from "../../stores/configStore";
import { SkeletonPulse } from "../common/Skeleton";
import TaskAssignment from "../modelAdmin/TaskAssignment";
import ModelMetaEditor from "../modelAdmin/ModelMetaEditor";
import ProviderPresetPanel from "../modelAdmin/ProviderPresetPanel";
import ProviderEditorModal from "../modelAdmin/ProviderEditorModal";
import AddModelModal from "../modelAdmin/AddModelModal";
import FetchedModelList from "../modelAdmin/FetchedModelList";
import { PROVIDER_TYPE_LABELS } from "../../config/providerPresets";
import { usageService } from "../../services/usageService";
import { modelSwitchService } from "../../services/modelSwitchService";
import { modelService } from "../../services/modelService";
import { toastError, toastInfo } from "../../stores/toastStore";
import type {
  ProviderInfo,
  ProviderFormData,
  FetchedModel,
  ModelInfo,
  BillingMode,
  TimeBasedPrice,
} from "../../types";

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
};

const DEFAULT_COLOR =
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";

function formatDate(ts: number, locale = "zh-CN"): string {
  return new Date(ts * 1000).toLocaleDateString(locale);
}

/** 每百万 token 单价展示（≥1 保留 2 位，<1 保留 3 位） */
function formatUnitPrice(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "--";
  return v >= 1 ? v.toFixed(2) : v.toFixed(3);
}

const BILLING_LABELS: Record<string, string> = {
  token: "按Token",
  per_request: "按次",
  token_and_per_request: "Token+按次",
};

function ProviderPage() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "en" ? "en-US" : "zh-CN";
  const {
    models,
    isLoading: modelsLoading,
    loadModels,
    toggleModel,
    deleteModel,
    updateModel,
  } = useModelStore();
  const store = useModelAdminStore();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [activeTab, setActiveTab] = useState<"providers" | "models" | "tasks">(
    () =>
      (new URLSearchParams(window.location.search).get("tab") as
        "providers" | "models" | "tasks") || "providers",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorProvider, setEditorProvider] = useState<ProviderInfo | null>(
    null,
  );
  const [showEditor, setShowEditor] = useState(false);
  const [editMetaId, setEditMetaId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editCaps, setEditCaps] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[] | null>(
    null,
  );
  const [fetchingModelsId, setFetchingModelsId] = useState<string | null>(null);
  const [checkingBalanceId, setCheckingBalanceId] = useState<string | null>(
    null,
  );
  const [modelSearchText, setModelSearchText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;
  const [totalModels, setTotalModels] = useState(0);
  const [fetchingProviderId, setFetchingProviderId] = useState<string | null>(
    null,
  );
  const [showAddModel, setShowAddModel] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncingPricing, setSyncingPricing] = useState(false);
  const [initialFormData, setInitialFormData] = useState<
    Partial<ProviderFormData> | undefined
  >(undefined);

  useEffect(() => {
    loadModels();
    store.loadProviders();
  }, []);

  const filteredProviders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return store.providers;
    return store.providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.providerType.toLowerCase().includes(q) ||
        p.baseUrl.toLowerCase().includes(q) ||
        (p.notes || "").toLowerCase().includes(q),
    );
  }, [store.providers, searchQuery]);

  const openEditor = useCallback((provider?: ProviderInfo) => {
    setEditorProvider(provider ?? null);
    setEditingId(provider?.id ?? null);
    setShowEditor(true);
    setShowPresets(false);
  }, []);

  const handlePresetSelect = useCallback((formData: ProviderFormData) => {
    setInitialFormData(formData);
    setEditorProvider(null);
    setEditingId(null);
    setShowEditor(true);
    setShowPresets(false);
  }, []);

  const handleSave = useCallback(
    async (data: ProviderFormData) => {
      if (editingId) {
        await store.updateProvider(editingId, data);
      } else {
        await store.createProvider(data);
      }
      setShowEditor(false);
      setEditorProvider(null);
      setEditingId(null);
      setInitialFormData(undefined);
    },
    [editingId, store],
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (
        window.confirm(
          t("settings.modelDeleteProviderConfirm").replace("{name}", name),
        )
      ) {
        await store.deleteProvider(id);
      }
    },
    [store],
  );

  const handleStartEditModel = useCallback((model: ModelInfo) => {
    setEditingModelId(model.id);
    // capabilities 不直接在 ModelInfo 中，用 type 兜底
    setEditCaps(
      model.type === "embedding"
        ? "embedding"
        : model.type === "image"
          ? "image_generation"
          : model.type === "video"
            ? "video_generation"
            : model.type === "voice"
              ? "text_to_speech"
              : "",
    );
  }, []);

  const handleSaveEditModel = useCallback(async () => {
    if (!editingModelId) return;
    setSavingModel(true);
    try {
      const caps = editCaps
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await updateModel(editingModelId, {
        capabilities: caps.length > 0 ? caps : undefined,
      });
      setEditingModelId(null);
    } catch {
      // error handled by store
    } finally {
      setSavingModel(false);
    }
  }, [editingModelId, editCaps, updateModel]);

  const handleCancelEditModel = useCallback(() => {
    setEditingModelId(null);
  }, []);

  const handleFetchModels = useCallback(
    async (id: string, options?: { page?: number; search?: string }) => {
      const currentProviderId = options?.search ? fetchingProviderId : id;
      setFetchingModelsId(currentProviderId);
      setFetchedModels(null);
      try {
        const result = await store.fetchModels(id, {
          page: options?.page || currentPage,
          pageSize,
          search: options?.search || modelSearchText,
        });
        if ("models" in result) {
          setFetchedModels(result.models);
          setTotalModels(result.total);
          setCurrentPage(result.page);
          setFetchingProviderId(id);
        }
      } catch {
        // 静默
      } finally {
        setFetchingModelsId(null);
      }
    },
    [store, currentPage, pageSize, modelSearchText, fetchingProviderId],
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      setModelSearchText(text);
      setCurrentPage(1);
      if (fetchingProviderId) {
        handleFetchModels(fetchingProviderId, { search: text, page: 1 });
      }
    },
    [handleFetchModels, fetchingProviderId],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      if (fetchingProviderId) {
        handleFetchModels(fetchingProviderId, { page });
      }
    },
    [handleFetchModels, fetchingProviderId],
  );

  const handleAddModel = useCallback(
    async (form: {
      modelId: string;
      displayName: string;
      providerId: string;
      contextWindow: number;
      maxOutputTokens: number;
      inputCostPerMillion: number;
      outputCostPerMillion: number;
      cacheReadCostPerMillion: number;
      cacheWriteCostPerMillion: number;
      billingMode: BillingMode;
      pricePerRequest: number;
      timeBasedPricing: TimeBasedPrice[];
    }) => {
      try {
        await store.createModel(form);
        setShowAddModel(false);
        loadModels();
      } catch (e) {
        toastError(
          new Error(
            `${t("settings.modelCreateFailed")}: ${e instanceof Error ? e.message : t("settings.modelUnknownError")}`,
          ),
        );
      }
    },
    [store, loadModels],
  );

  const handleSyncOfficialPricing = useCallback(async () => {
    setSyncingPricing(true);
    try {
      const updated = await modelService.syncOfficialPricing();
      await loadModels(); // 刷新展示的价格
      if (updated > 0) {
        toastInfo(`已同步 ${updated} 个模型的官方价格`);
      } else {
        toastInfo("官方价格已是最新（或模型均为自定义定价）");
      }
    } catch (e) {
      toastError(
        new Error(
          `同步官方价格失败: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    } finally {
      setSyncingPricing(false);
    }
  }, [loadModels]);

  const handleBulkImport = useCallback(
    async (modelIds: string[]) => {
      if (!modelIds.length || !fetchingProviderId) return;
      setImporting(true);
      try {
        const { providerService } =
          await import("../../services/providerService");
        await providerService.bulkImportModels(fetchingProviderId, modelIds);
        await loadModels();
        toastInfo(`成功导入 ${modelIds.length} 个模型到模型列表`);
      } catch (e) {
        toastError(
          new Error(
            `${t("settings.modelImportFailed")}: ${e instanceof Error ? e.message : t("settings.modelUnknownError")}`,
          ),
        );
      } finally {
        setImporting(false);
      }
    },
    [fetchingProviderId, loadModels],
  );

  const handleCheckBalance = useCallback(async (provider: ProviderInfo) => {
    setCheckingBalanceId(provider.id);
    try {
      const result = await usageService.checkBalance({
        providerId: provider.id,
      });
      if (result.success) {
        const lines = result.data.map(
          (d) =>
            `${d.planName || ""}: ${d.remaining?.toFixed(2) ?? "--"} ${d.unit || ""}${d.total ? ` / ${d.total.toFixed(2)}` : ""}`,
        );
        toastInfo(`余额 — ${result.provider}\n${lines.join("\n")}`);
      } else {
        toastError(new Error(`余额查询失败: ${result.error}`));
      }
    } catch {
      toastError(new Error(t("settings.modelBalanceFailed")));
    } finally {
      setCheckingBalanceId(null);
    }
  }, []);

  const handleSetDefaultModel = useCallback(async (provider: ProviderInfo) => {
    const modelId = prompt(
      `为 "${provider.name}" 设置默认模型 ID:\n输入模型 ID（留空清除默认）`,
      "",
    );
    if (modelId === null) return;
    try {
      await modelSwitchService.setDefaultModel(provider.id, modelId);
      toastInfo(
        `已${modelId ? `将 "${provider.name}" 默认模型设为 ${modelId}` : `清除 "${provider.name}" 的默认模型`}`,
      );
    } catch (e) {
      toastError(
        new Error(
          `${t("settings.modelSetDefaultFailed")}: ${e instanceof Error ? e.message : t("settings.modelUnknownError")}`,
        ),
      );
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              模型管理
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {store.providers.length} 个 Provider，
              {store.providers.filter((p) => p.isActive).length} 激活
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPresets(true)}
              className="px-3 py-2 text-sm bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-700 dark:text-green-400 rounded-lg transition-colors"
            >
              快速添加
            </button>
            <button
              onClick={() => openEditor()}
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              + 新增 Provider
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {store.error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {store.error}
            <button onClick={store.clearError} className="ml-2 underline">
              关闭
            </button>
          </div>
        )}

        {/* Tab */}
        <div className="flex gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
          {(["providers", "models", "tasks"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === tab ? "bg-white dark:bg-gray-700 shadow-sm font-medium" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"}`}
            >
              {
                {
                  providers: t("settings.modelTabProviders"),
                  models: t("settings.modelTabModelList"),
                  tasks: t("settings.modelTabTasks"),
                }[tab]
              }
            </button>
          ))}
        </div>

        {/* Provider Tab */}
        {activeTab === "providers" && (
          <>
            <div className="mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("settings.modelSearchProvider")}
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {store.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <SkeletonPulse className="h-5 w-32 mb-3" />
                    <SkeletonPulse className="h-3 w-64" />
                  </div>
                ))}
              </div>
            ) : filteredProviders.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 dark:text-gray-500 text-lg mb-2">
                  {searchQuery
                    ? t("settings.modelNoProvider")
                    : t("settings.modelNoProvider")}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {searchQuery
                    ? t("settings.modelTryOtherKeywords")
                    : t("settings.modelNoProviderHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredProviders.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full font-medium ${TYPE_COLORS[p.providerType] || DEFAULT_COLOR}`}
                          >
                            {PROVIDER_TYPE_LABELS[p.providerType] ||
                              p.providerType}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {p.name}
                          </span>
                          {!p.requiresAuth && (
                            <span
                              className="text-[10px] px-1 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded"
                              title={t("settings.modelLocalProvider")}
                            >
                              本地
                            </span>
                          )}
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${p.isActive ? "bg-green-400" : "bg-gray-400"}`}
                            title={
                              p.isActive
                                ? t("settings.modelEnabled")
                                : t("settings.modelDisabled")
                            }
                          />
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                          {p.baseUrl}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          创建: {formatDate(p.createdAt, dateLocale)} | ID:{" "}
                          {p.id.substring(0, 8)}...
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <button
                          onClick={() => handleFetchModels(p.id)}
                          disabled={
                            fetchingModelsId === p.id ||
                            (p.requiresAuth && !p.apiKey)
                          }
                          title={
                            p.requiresAuth && !p.apiKey
                              ? t("settings.modelNeedsApiKey")
                              : t("settings.modelFetchModels")
                          }
                          className="px-2 py-1.5 text-xs bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded transition-colors disabled:opacity-30"
                        >
                          {fetchingModelsId === p.id ? "..." : "模型"}
                        </button>
                        <button
                          onClick={async () => {
                            const result = await store.testConnection(p.id);
                            if (result.success) {
                              toastInfo(`连接成功 (${result.latencyMs}ms)`);
                            } else {
                              toastError(new Error(`失败: ${result.error}`));
                            }
                          }}
                          disabled={p.requiresAuth && !p.apiKey}
                          title={
                            p.requiresAuth && !p.apiKey
                              ? t("settings.modelNeedsApiKey")
                              : t("settings.modelTestLatency")
                          }
                          className="px-2 py-1.5 text-xs bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-400 rounded transition-colors disabled:opacity-30"
                        >
                          测试
                        </button>
                        <button
                          onClick={() => store.toggleProvider(p.id)}
                          className="px-2 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded transition-colors"
                        >
                          {p.isActive
                            ? t("settings.modelDisable")
                            : t("settings.modelEnable")}
                        </button>
                        <button
                          onClick={() => handleSetDefaultModel(p)}
                          title={t("settings.modelSetDefault")}
                          className="px-2 py-1.5 text-xs bg-sky-50 dark:bg-sky-900/20 hover:bg-sky-100 dark:hover:bg-sky-900/40 text-sky-600 dark:text-sky-400 rounded transition-colors"
                        >
                          设默认
                        </button>
                        {p.requiresAuth !== false && (
                          <button
                            onClick={() => handleCheckBalance(p)}
                            disabled={
                              checkingBalanceId === p.id ||
                              (p.requiresAuth && !p.apiKey)
                            }
                            title={
                              p.requiresAuth && !p.apiKey
                                ? t("settings.modelNeedsApiKey")
                                : t("settings.modelCheckBalance")
                            }
                            className="px-2 py-1.5 text-xs bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400 rounded transition-colors disabled:opacity-30"
                          >
                            {checkingBalanceId === p.id
                              ? "..."
                              : t("settings.modelBalanceBtn")}
                          </button>
                        )}
                        <button
                          onClick={() => openEditor(p)}
                          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(p.id, p.name)}
                          className="px-2 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {/* 获取到的模型列表 */}
                    {fetchedModels && fetchingProviderId === p.id && (
                      <FetchedModelList
                        models={fetchedModels}
                        total={totalModels}
                        currentPage={currentPage}
                        pageSize={pageSize}
                        searchText={modelSearchText}
                        onSearchChange={handleSearchChange}
                        onPageChange={handlePageChange}
                        onBulkImport={handleBulkImport}
                        importing={importing}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 任务分工 Tab */}
        {activeTab === "tasks" && (
          <div className="max-w-3xl mx-auto">
            <TaskAssignment />
          </div>
        )}

        {/* 模型列表 Tab */}
        {activeTab === "models" && (
          <>
            <div className="flex justify-end gap-2 mb-4">
              <button
                onClick={handleSyncOfficialPricing}
                disabled={syncingPricing}
                title="按内置官方价格表刷新已注册模型的价格（不覆盖自定义定价）"
                className="px-4 py-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
              >
                {syncingPricing ? "同步中..." : "同步官方价格"}
              </button>
              <button
                onClick={() => setShowAddModel(true)}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                + 添加模型
              </button>
            </div>

            {modelsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <SkeletonPulse className="h-5 w-48 mb-3" />
                    <SkeletonPulse className="h-3 w-32" />
                  </div>
                ))}
              </div>
            ) : models.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 dark:text-gray-500 text-lg mb-2">
                  暂无可用模型
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-sm">
                  请在 Provider 管理页面添加供应商
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full font-medium shrink-0 ${TYPE_COLORS[model.provider] || DEFAULT_COLOR}`}
                          >
                            {model.provider}
                          </span>
                          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {model.name || model.id}
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {model.context_length >= 1000
                              ? `${(model.context_length / 1000).toFixed(0)}K`
                              : model.context_length}{" "}
                            tokens
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {model.type}
                          </span>
                          {model.pricing && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              输入 ${formatUnitPrice(model.pricing.inputPer1M)}{" "}
                              / 输出 $
                              {formatUnitPrice(model.pricing.outputPer1M)} /1M
                            </span>
                          )}
                          {model.pricing?.billingMode &&
                            model.pricing.billingMode !== "token" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400">
                                {BILLING_LABELS[model.pricing.billingMode] ||
                                  model.pricing.billingMode}
                                {model.pricing.pricePerRequest
                                  ? ` $${model.pricing.pricePerRequest}/次`
                                  : ""}
                              </span>
                            )}
                          {model.pricing?.timeBasedPricing?.length ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                              title={`分时价差: ${model.pricing.timeBasedPricing.map((s) => `${s.start}-${s.end}`).join("、")}`}
                            >
                              分时
                            </span>
                          ) : null}
                          {model.pricing?.pricingSource === "manual" && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                              title="价格由用户手动配置，官方价格同步不会覆盖"
                            >
                              自定义
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <button
                          onClick={async () => {
                            try {
                              await toggleModel(model.id);
                            } catch {
                              // error handled by store
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors cursor-pointer ${
                            model.enabled
                              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-900/50"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
                          }`}
                          title={
                            model.enabled
                              ? t("settings.modelClickDisable")
                              : t("settings.modelClickEnable")
                          }
                        >
                          {model.enabled
                            ? t("settings.modelAvailable")
                            : t("settings.modelStatusDisabled")}
                        </button>
                        {model.providerId && (
                          <button
                            onClick={() => setActiveTab("providers")}
                            className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                          >
                            管理 Provider
                          </button>
                        )}
                        <button
                          onClick={() => setEditMetaId(model.id)}
                          className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded shrink-0"
                        >
                          元数据
                        </button>
                        <button
                          onClick={() => handleStartEditModel(model)}
                          className="px-2 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded shrink-0"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                `确定删除模型「${model.name || model.id}」？此操作不可恢复。`,
                              )
                            ) {
                              deleteModel(model.id).catch(() => {});
                            }
                          }}
                          className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded shrink-0"
                          title={t("settings.modelDeleteModel")}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 快速预设面板 */}
      {showPresets && (
        <ProviderPresetPanel
          onSelect={handlePresetSelect}
          onClose={() => setShowPresets(false)}
        />
      )}

      {/* 编辑/新增弹窗 */}
      {showEditor && (
        <ProviderEditorModal
          provider={editorProvider}
          initialFormData={initialFormData}
          isSaving={store.savingId !== null}
          isDark={isDark}
          onSave={handleSave}
          onClose={() => {
            setShowEditor(false);
            setEditorProvider(null);
            setEditingId(null);
            setInitialFormData(undefined);
          }}
        />
      )}

      {/* 模型元数据编辑器 */}
      {editMetaId && (
        <ModelMetaEditor
          modelId={editMetaId}
          modelName={editMetaId}
          onClose={() => setEditMetaId(null)}
          onSaved={() => {
            setEditMetaId(null);
            loadModels();
          }}
        />
      )}

      {/* 模型能力标签编辑器（内联） */}
      {editingModelId &&
        (() => {
          const model = models.find((m) => m.id === editingModelId);
          if (!model) return null;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
              onClick={handleCancelEditModel}
            >
              <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  编辑模型 — {model.modelId || model.name}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      能力标签（逗号分隔）
                    </label>
                    <input
                      type="text"
                      value={editCaps}
                      onChange={(e) => setEditCaps(e.target.value)}
                      placeholder="如: embedding, streaming, reranking"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      可选: streaming, function_calling, vision, thinking,
                      tool_use, embedding, image_generation, video_generation,
                      text_to_speech, speech_recognition, reranking,
                      code_execution 等
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={handleCancelEditModel}
                      className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveEditModel}
                      disabled={savingModel}
                      className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {savingModel ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* 添加模型弹窗 */}
      {showAddModel && (
        <AddModelModal
          providers={store.providers}
          onSave={handleAddModel}
          onClose={() => setShowAddModel(false)}
        />
      )}
    </div>
  );
}

export default ProviderPage;
