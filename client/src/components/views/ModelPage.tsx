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
import {
  modelService,
  type CapabilityProbeResult,
} from "../../services/modelService";
import { toastError, toastInfo, toastWarning } from "../../stores/toastStore";
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
  token: "settings.modelBillingToken",
  per_request: "settings.modelBillingPerRequest",
  token_and_per_request: "settings.modelBillingTokenAndPerRequest",
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
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>(
    {},
  );
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<string, CapabilityProbeResult>
  >({});

  useEffect(() => {
    loadModels();
    store.loadProviders();
    // N-59 后续：加载"供应商已被删除"的模型（孤儿），供列表上方区块展示与重绑
    store.loadOrphans();
  }, []);

  // 本地服务（Ollama/llama.cpp）运行状态轮询
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const statuses = await modelService.providerStatus();
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        statuses.forEach((s) => {
          map[s.providerType] = s.running;
        });
        setProviderStatus(map);
      } catch {
        // @ignore 状态轮询失败静默保留上次结果
      }
    };
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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
        // D9 乐观并发：携带编辑前读取的 updatedAt 作为版本 token，stale write 会被后端 409 拒绝
        await store.updateProvider(editingId, {
          ...data,
          expectedRevision: editorProvider?.updatedAt,
        });
      } else {
        await store.createProvider(data);
      }
      setShowEditor(false);
      setEditorProvider(null);
      setEditingId(null);
      setInitialFormData(undefined);
    },
    [editingId, editorProvider, store],
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (
        window.confirm(
          t("settings.modelDeleteProviderConfirm").replace("{name}", name),
        )
      ) {
        const disabledModels = await store.deleteProvider(id);
        // N-59：该供应商的强绑定模型已被级联停用，需明确告知 —— 否则用户会以为
        // 模型"凭空消失"（供应商缺失的模型不会出现在模型列表中）。
        if (disabledModels.length > 0) {
          toastWarning(
            t("settings.modelDeleteProviderDisabledModels")
              .replace("{count}", String(disabledModels.length))
              .replace("{models}", disabledModels.join("、")),
          );
        }
      }
    },
    [store, t],
  );

  /** N-59 后续：把孤儿模型重绑到现有供应商（重绑后自动启用，见 store.rebindModel） */
  const handleRebindOrphan = useCallback(
    async (modelId: string, providerId: string, name: string) => {
      const provider = store.providers.find((p) => p.id === providerId);
      await store.rebindModel(modelId, providerId);
      // 重绑后该模型回到**主列表**；主列表是本地 state（非 store 字段），
      // 必须重新拉取才能就地可见（否则要刷新页面才出现 —— 实测缺陷）
      await loadModels();
      toastInfo(
        t("settings.orphanModelsRebindSuccess")
          .replace("{model}", name)
          .replace("{provider}", provider?.name ?? providerId),
      );
    },
    [store, t, loadModels],
  );

  /** N-59 后续：彻底删除孤儿模型 */
  const handleDeleteOrphan = useCallback(
    async (id: string, name: string) => {
      if (
        !window.confirm(
          t("settings.orphanModelsDeleteConfirm").replace("{name}", name),
        )
      ) {
        return;
      }
      try {
        await modelService.remove(id);
        await store.loadOrphans();
        toastInfo(t("settings.orphanModelsDeleted").replace("{model}", name));
      } catch (e) {
        toastError(e);
      }
    },
    [store, t],
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
        // 用户通过 UI 添加的模型 = 自定义模型（is_custom=1，官方价格同步不覆盖）
        await store.createModel({ ...form, isCustom: true });
        setShowAddModel(false);
        loadModels();
        // 添加后自动探测能力（tool_use/vision）并写回 DB；云端模型返回 skipped，不打扰
        if (form.modelId) {
          modelService
            .probeCapabilities(form.modelId, true)
            .then((r) => {
              if (r.method === "static") {
                toastInfo(
                  t("settings.modelAutoProbe", {
                    tool:
                      r.tool_use === true
                        ? "✓"
                        : r.tool_use === false
                          ? "✗"
                          : t("settings.modelProbeUnknown"),
                    vision:
                      r.vision === true
                        ? t("settings.modelProbeVisionYes")
                        : "",
                  }),
                );
              }
            })
            .catch(() => {
              // @ignore 自动探测失败不阻塞添加流程
            });
        }
      } catch (e) {
        toastError(
          new Error(
            `${t("settings.modelCreateFailed")}: ${e instanceof Error ? e.message : t("settings.modelUnknownError")}`,
          ),
        );
      }
    },
    [store, loadModels, t],
  );

  const handleSyncOfficialPricing = useCallback(async () => {
    setSyncingPricing(true);
    try {
      const updated = await modelService.syncOfficialPricing();
      await loadModels(); // 刷新展示的价格
      if (updated > 0) {
        toastInfo(t("settings.modelSyncPricingSuccess", { count: updated }));
      } else {
        toastInfo(t("settings.modelSyncPricingUpToDate"));
      }
    } catch (e) {
      toastError(
        new Error(
          t("settings.modelSyncPricingFailed", {
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      );
    } finally {
      setSyncingPricing(false);
    }
  }, [loadModels, t]);

  const handleBulkImport = useCallback(
    async (modelIds: string[]) => {
      if (!modelIds.length || !fetchingProviderId) return;
      setImporting(true);
      try {
        const { providerService } =
          await import("../../services/providerService");
        await providerService.bulkImportModels(fetchingProviderId, modelIds);
        await loadModels();
        toastInfo(
          t("settings.modelBulkImportSuccess", { count: modelIds.length }),
        );
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
    [fetchingProviderId, loadModels, t],
  );

  const handleCheckBalance = useCallback(
    async (provider: ProviderInfo) => {
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
          toastInfo(
            `${t("settings.modelBalanceTitle", { provider: result.provider })}\n${lines.join("\n")}`,
          );
        } else {
          toastError(
            new Error(
              t("settings.modelBalanceQueryFailed", { error: result.error }),
            ),
          );
        }
      } catch {
        toastError(new Error(t("settings.modelBalanceFailed")));
      } finally {
        setCheckingBalanceId(null);
      }
    },
    [t],
  );

  const handleSetDefaultModel = useCallback(
    async (provider: ProviderInfo) => {
      const modelId = prompt(
        t("settings.modelSetDefaultPrompt", { provider: provider.name }),
        "",
      );
      if (modelId === null) return;
      try {
        await modelSwitchService.setDefaultModel(provider.id, modelId);
        toastInfo(
          modelId
            ? t("settings.modelDefaultSetTo", {
                provider: provider.name,
                modelId,
              })
            : t("settings.modelDefaultCleared", { provider: provider.name }),
        );
      } catch (e) {
        toastError(
          new Error(
            `${t("settings.modelSetDefaultFailed")}: ${e instanceof Error ? e.message : t("settings.modelUnknownError")}`,
          ),
        );
      }
    },
    [t],
  );

  /** 探测模型能力（工具调用/视觉），结果写回 DB capabilities */
  const handleProbeModel = useCallback(
    async (model: ModelInfo) => {
      setProbingId(model.id);
      try {
        const result = await modelService.probeCapabilities(
          model.modelId || model.id,
          true,
        );
        setProbeResults((prev) => ({ ...prev, [model.id]: result }));
        const parts: string[] = [];
        if (result.tool_use === true) parts.push(t("settings.modelCapToolUse"));
        if (result.vision === true) parts.push(t("settings.modelCapVision"));
        if (parts.length > 0) {
          toastInfo(
            t("settings.modelProbeDone", { capabilities: parts.join("、") }),
          );
        } else {
          toastInfo(
            result.method === "skipped"
              ? t("settings.modelProbeSkipped")
              : result.method === "failed"
                ? t("settings.modelProbeFailedHint")
                : t("settings.modelProbeNoCapability"),
          );
        }
      } catch (e) {
        toastError(
          new Error(
            t("settings.modelProbeError", {
              error: e instanceof Error ? e.message : String(e),
            }),
          ),
        );
      } finally {
        setProbingId(null);
      }
    },
    [t],
  );

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("settings.modelPageTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("settings.modelProviderSummary", {
                total: store.providers.length,
                active: store.providers.filter((p) => p.isActive).length,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPresets(true)}
              className="px-3 py-2 text-sm bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-700 dark:text-green-400 rounded-lg transition-colors"
            >
              {t("settings.modelQuickAdd")}
            </button>
            <button
              onClick={() => openEditor()}
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              + {t("settings.modelAddProvider")}
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {store.error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {store.error}
            <button onClick={store.clearError} className="ml-2 underline">
              {t("common.close")}
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
                              {t("settings.modelLocalBadge")}
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
                          {t("settings.modelCreatedAt", {
                            date: formatDate(p.createdAt, dateLocale),
                            id: p.id.substring(0, 8),
                          })}
                          ...
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
                          {fetchingModelsId === p.id
                            ? "..."
                            : t("settings.modelFetchBtn")}
                        </button>
                        <button
                          onClick={async () => {
                            const result = await store.testConnection(p.id);
                            if (result.success) {
                              toastInfo(
                                t("settings.modelConnectionSuccessMs", {
                                  ms: result.latencyMs,
                                }),
                              );
                            } else {
                              toastError(
                                new Error(
                                  t("settings.modelTestFailed", {
                                    error: result.error,
                                  }),
                                ),
                              );
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
                          {t("settings.modelTest")}
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
                          {t("settings.modelSetDefaultShort")}
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
                          {t("common.edit")}
                        </button>
                        <button
                          onClick={() => handleDelete(p.id, p.name)}
                          className="px-2 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded transition-colors"
                        >
                          {t("common.delete")}
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
            {Object.keys(providerStatus).length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-3 px-1">
                {Object.entries(providerStatus).map(([type, running]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        running ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    {type === "ollama" ? "Ollama" : "llama.cpp"}
                    {running
                      ? t("settings.modelStatusRunning")
                      : t("settings.modelStatusNotRunning")}
                  </span>
                ))}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t("settings.modelAutoRefreshEvery20s")}
                </span>
              </div>
            )}
            <div className="flex justify-end gap-2 mb-4">
              <button
                onClick={handleSyncOfficialPricing}
                disabled={syncingPricing}
                title={t("settings.modelSyncPricingTitle")}
                className="px-4 py-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
              >
                {syncingPricing
                  ? t("settings.modelSyncing")
                  : t("settings.modelSyncOfficialPricing")}
              </button>
              <button
                onClick={() => setShowAddModel(true)}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                + {t("settings.modelAddModel")}
              </button>
            </div>

            {/* N-59 后续：供应商已被删除的模型（孤儿）—— 仅在有孤儿时渲染。
                这些模型因无匹配供应商不会出现在下方主列表中，此处给出重绑/删除入口。 */}
            {store.orphanModels.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-600 dark:text-amber-400">⚠</span>
                  <h3 className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {t("settings.orphanModelsTitle")}
                  </h3>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400/80 mb-3">
                  {t("settings.orphanModelsHint")}
                </p>
                <div className="space-y-2">
                  {store.orphanModels.map((om) => (
                    <div
                      key={om.id}
                      className="flex flex-wrap items-center gap-2 bg-white dark:bg-gray-800 rounded border border-amber-200 dark:border-amber-800 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {om.displayName || om.modelId}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {om.modelId}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                        title={om.providerId}
                      >
                        {t("settings.orphanModelsMissingProvider")}:{" "}
                        {om.providerId.slice(0, 8)}…
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <select
                          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                          value=""
                          disabled={store.savingId === om.id}
                          onChange={(e) => {
                            const pid = e.target.value;
                            if (pid) {
                              void handleRebindOrphan(
                                om.id,
                                pid,
                                om.displayName || om.modelId,
                              );
                            }
                          }}
                        >
                          <option value="">
                            {t("settings.orphanModelsRebindTo")}
                          </option>
                          {store.providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteOrphan(
                              om.id,
                              om.displayName || om.modelId,
                            )
                          }
                          className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          {t("settings.modelDeleteModel")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  {t("settings.modelNoModelsAvailable")}
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-sm">
                  {t("settings.modelAddProviderHint")}
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
                          {probeResults[model.id] && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                              title={t("settings.modelProbeResultTitle")}
                            >
                              {t("settings.modelCapToolUse")}
                              {probeResults[model.id].tool_use === true
                                ? "✓"
                                : probeResults[model.id].tool_use === false
                                  ? "✗"
                                  : "?"}
                              {probeResults[model.id].vision === true
                                ? t("settings.modelProbeVisionYes")
                                : ""}
                            </span>
                          )}
                          {model.pricing && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {t("settings.modelPriceInOut", {
                                input: formatUnitPrice(
                                  model.pricing.inputPer1M,
                                ),
                                output: formatUnitPrice(
                                  model.pricing.outputPer1M,
                                ),
                              })}
                            </span>
                          )}
                          {model.pricing?.billingMode &&
                            model.pricing.billingMode !== "token" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400">
                                {t(
                                  BILLING_LABELS[model.pricing.billingMode] ||
                                    model.pricing.billingMode,
                                )}
                                {model.pricing.pricePerRequest
                                  ? ` ${t("settings.modelPricePerCall", {
                                      price: model.pricing.pricePerRequest,
                                    })}`
                                  : ""}
                              </span>
                            )}
                          {model.pricing?.timeBasedPricing?.length ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                              title={t("settings.modelTimeBasedSpread", {
                                ranges: model.pricing.timeBasedPricing
                                  .map((s) => `${s.start}-${s.end}`)
                                  .join("、"),
                              })}
                            >
                              {t("settings.modelTimeBased")}
                            </span>
                          ) : null}
                          {model.pricing?.pricingSource === "manual" && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                              title={t("settings.modelManualPricingTitle")}
                            >
                              {t("settings.modelCustomPricing")}
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
                            {t("settings.modelManageProvider")}
                          </button>
                        )}
                        <button
                          onClick={() => handleProbeModel(model)}
                          disabled={probingId === model.id}
                          title={t("settings.modelProbeTitle")}
                          className="px-2 py-1 text-xs bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded shrink-0 disabled:opacity-50"
                        >
                          {probingId === model.id
                            ? t("settings.modelProbing")
                            : t("settings.modelProbeCapabilities")}
                        </button>
                        <button
                          onClick={() => setEditMetaId(model.id)}
                          className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded shrink-0"
                        >
                          {t("settings.modelMetadata")}
                        </button>
                        <button
                          onClick={() => handleStartEditModel(model)}
                          className="px-2 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded shrink-0"
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                t("settings.modelDeleteModelConfirm", {
                                  name: model.name || model.id,
                                }),
                              )
                            ) {
                              deleteModel(model.id).catch(() => {});
                            }
                          }}
                          className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded shrink-0"
                          title={t("settings.modelDeleteModel")}
                        >
                          {t("common.delete")}
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
                  {t("settings.modelEditTitle", {
                    name: model.modelId || model.name,
                  })}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t("settings.modelCapabilitiesLabel")}
                    </label>
                    <input
                      type="text"
                      value={editCaps}
                      onChange={(e) => setEditCaps(e.target.value)}
                      placeholder={t("settings.modelCapabilitiesPlaceholder")}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {t("settings.modelCapabilitiesHint")}
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={handleCancelEditModel}
                      className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={handleSaveEditModel}
                      disabled={savingModel}
                      className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {savingModel
                        ? t("settings.modelSaving")
                        : t("common.save")}
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
