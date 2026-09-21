/**
 * 模型管理 Store（DB 驱动）
 * 管理 Provider 列表、CRUD 操作状态
 */

import { create } from "zustand";
import { providerService } from "../services/providerService";
import { modelService } from "../services/modelService";
import type { OrphanModel } from "../services/modelService";
import { sseService } from "../services/sseService";
import type {
  ProviderInfo,
  ProviderFormData,
  BillingMode,
  TimeBasedPrice,
} from "../types";
import { handleClientError } from "@/utils/handleError";

interface ModelAdminState {
  providers: ProviderInfo[];
  /** N-59 后续：供应商已被删除的模型（孤儿）—— 供模型管理页展示与重绑 */
  orphanModels: OrphanModel[];
  isLoading: boolean;
  error: string | null;
  savingId: string | null;

  loadProviders: () => Promise<void>;
  createProvider: (data: ProviderFormData) => Promise<void>;
  updateProvider: (
    id: string,
    data: Partial<ProviderFormData>,
  ) => Promise<void>;
  /** 删除供应商；返回被**级联停用**的强绑定模型名（N-59，无则空数组） */
  deleteProvider: (id: string) => Promise<string[]>;
  /** N-59 后续：加载"供应商已被删除"的模型（孤儿） */
  loadOrphans: () => Promise<void>;
  /** N-59 后续：把孤儿模型重绑到现有供应商，并自动启用（仅当原为停用） */
  rebindModel: (id: string, providerId: string) => Promise<void>;
  toggleProvider: (id: string) => Promise<void>;
  testConnection: (
    id: string,
  ) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
  fetchModels: (
    id: string,
    options?: { page?: number; pageSize?: number; search?: string },
  ) => Promise<
    | {
        models: Array<{ id: string; ownedBy?: string }>;
        total: number;
        page: number;
        pageSize: number;
      }
    | { error: string }
  >;

  clearError: () => void;
  createModel: (data: {
    modelId: string;
    displayName?: string;
    providerId: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    inputCostPerMillion?: number;
    outputCostPerMillion?: number;
    cacheReadCostPerMillion?: number;
    cacheWriteCostPerMillion?: number;
    billingMode?: BillingMode;
    pricePerRequest?: number;
    timeBasedPricing?: TimeBasedPrice[];
    /** 用户自定义模型标记（is_custom=1） */
    isCustom?: boolean;
  }) => Promise<void>;
}

export const useModelAdminStore = create<ModelAdminState>((set, get) => ({
  providers: [],
  orphanModels: [],
  isLoading: false,
  error: null,
  savingId: null,

  loadProviders: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await providerService.list();
      set({ providers, isLoading: false });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "loadProviders",
      });
      set({
        error: e instanceof Error ? e.message : "获取 Provider 列表失败",
        isLoading: false,
      });
    }
  },

  createProvider: async (data) => {
    set({ savingId: "new", error: null });
    try {
      await providerService.create(data);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "createProvider",
      });
      set({
        error: e instanceof Error ? e.message : "创建 Provider 失败",
        savingId: null,
      });
    }
  },

  updateProvider: async (id, data) => {
    set({ savingId: id, error: null });
    try {
      await providerService.update(id, data);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "updateProvider",
      });
      set({
        error: e instanceof Error ? e.message : "更新 Provider 失败",
        savingId: null,
      });
    }
  },

  deleteProvider: async (id) => {
    set({ savingId: id, error: null });
    try {
      // N-59：后端级联停用该供应商的强绑定模型并回传清单，交由 UI 提示
      const { disabledModels } = await providerService.remove(id);
      const providers = await providerService.list();
      set({ providers, savingId: null });
      return disabledModels;
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "deleteProvider",
      });
      set({
        error: e instanceof Error ? e.message : "删除 Provider 失败",
        savingId: null,
      });
      return [];
    }
  },

  /** N-59 后续：加载"供应商已被删除"的模型（孤儿） */
  loadOrphans: async () => {
    try {
      const orphanModels = await modelService.listOrphanModels();
      set({ orphanModels });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "loadOrphans",
      });
    }
  },

  /**
   * N-59 后续：把孤儿模型重绑到现有供应商，并**自动启用**
   * （仅当该模型原为停用时 toggle 一次，避免盲目翻转）。
   * 成功后刷新孤儿列表与主列表 —— 模型随之回到模型列表。
   */
  rebindModel: async (id, providerId) => {
    set({ savingId: id, error: null });
    try {
      const orphan = get().orphanModels.find((m) => m.id === id);
      await modelService.update(id, { providerId });
      if (orphan && !orphan.enabled) {
        await modelService.toggle(id);
      }
      const [orphanModels, providers] = await Promise.all([
        modelService.listOrphanModels(),
        providerService.list(),
      ]);
      set({ orphanModels, providers, savingId: null });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "rebindModel",
      });
      set({
        error: e instanceof Error ? e.message : "重绑供应商失败",
        savingId: null,
      });
    }
  },

  toggleProvider: async (id) => {
    set({ savingId: id, error: null });
    try {
      await providerService.toggle(id);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "toggleProvider",
      });
      set({
        error: e instanceof Error ? e.message : "切换状态失败",
        savingId: null,
      });
    }
  },

  testConnection: async (id) => {
    set({ error: null });
    try {
      const result = await providerService.test(id);
      const first = result.results?.[0];
      // 仅凭无 error 不够：非 2xx 状态码同样视为失败（后端已标注 error，此处双重保险）
      const statusOk =
        first?.status === undefined ||
        (first.status >= 200 && first.status < 300);
      return {
        success: !first?.error && statusOk,
        error:
          first?.error ||
          (first?.status !== undefined && !statusOk
            ? `HTTP ${first.status}`
            : undefined),
        latencyMs: first?.latency,
      };
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "testConnection",
      });
      return {
        success: false,
        error: e instanceof Error ? e.message : "连接测试失败",
      };
    }
  },

  fetchModels: async (id, options) => {
    return providerService.fetchModels(id, options);
  },

  createModel: async (data) => {
    set({ savingId: "model", error: null });
    try {
      await providerService.createModel(data);
      // 创建成功后重新加载供应商列表（触发模型列表刷新）
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      handleClientError(e, {
        module: "stores:modelAdmin",
        action: "createModel",
      });
      set({
        error: e instanceof Error ? e.message : "创建模型失败",
        savingId: null,
      });
    }
  },

  clearError: () => set({ error: null }),
}));

// P0 补齐（对齐 dsh llm/adapters-updated）：Provider 拓扑变更事件 → 刷新列表。
// 本地 CRUD 操作后 store 已自行 list() 刷新；此订阅覆盖后台任务/多端变更等外部场景。
if (typeof window !== "undefined") {
  sseService.on("providers:changed", () => {
    useModelAdminStore.getState().loadProviders();
  });
}
