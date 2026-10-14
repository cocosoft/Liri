/**
 * Provider API 服务层（DB 驱动）
 * 对接后端 /v1/providers/* 端点
 */

import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type {
  ProviderInfo,
  ProviderFormData,
  EndpointLatency,
  FetchedModel,
  BillingMode,
  TimeBasedPrice,
} from "../types";

export const providerService = {
  /** 获取所有供应商 */
  async list(): Promise<ProviderInfo[]> {
    const resp = await http.get<{ data: ProviderInfo[] }>(
      ENDPOINTS.providers.base,
    );
    return resp?.data ?? [];
  },

  /** 获取单个供应商 */
  async get(id: string): Promise<ProviderInfo> {
    const resp = await http.get<{ data: ProviderInfo }>(
      ENDPOINTS.providers.byIdEncoded(id),
    );
    return resp.data;
  },

  /** 创建供应商 */
  async create(data: ProviderFormData): Promise<ProviderInfo> {
    const resp = await http.post<{ data: ProviderInfo }>(
      ENDPOINTS.providers.base,
      data,
    );
    return resp.data;
  },

  /** 更新供应商 */
  async update(
    id: string,
    data: Partial<ProviderFormData>,
  ): Promise<ProviderInfo> {
    const resp = await http.put<{ data: ProviderInfo }>(
      ENDPOINTS.providers.byIdEncoded(id),
      data,
    );
    return resp.data;
  },

  /**
   * 删除供应商。
   * N-59（2026-09-20）：后端会**级联停用**强绑定该供应商的模型，并回传被停用的模型名，
   * 供调用方提示用户（避免"模型静默消失"）。
   */
  async remove(id: string): Promise<{ disabledModels: string[] }> {
    const resp = await http.delete<{
      success?: boolean;
      disabledModels?: string[];
    }>(ENDPOINTS.providers.byIdEncoded(id));
    return { disabledModels: resp?.disabledModels ?? [] };
  },

  /** 切换启用/停用 */
  async toggle(id: string): Promise<ProviderInfo> {
    const resp = await http.post<{ data: ProviderInfo }>(
      ENDPOINTS.providers.toggle(id),
    );
    return resp.data;
  },

  /** 端点测速 */
  async test(
    id: string,
  ): Promise<{ provider: string; results: EndpointLatency[] }> {
    const resp = await http.get<{
      data: { provider: string; results: EndpointLatency[] };
    }>(ENDPOINTS.providers.test(id));
    return resp.data;
  },

  /** 获取供应商可用模型列表 */
  async fetchModels(
    id: string,
    options?: {
      page?: number;
      pageSize?: number;
      search?: string;
    },
  ): Promise<
    | {
        models: FetchedModel[];
        usedUrl: string;
        total: number;
        page: number;
        pageSize: number;
      }
    | { error: string }
  > {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.pageSize) params.set("pageSize", String(options.pageSize));
    if (options?.search) params.set("search", options.search);
    return http.get(`${ENDPOINTS.providers.models(id)}?${params.toString()}`);
  },

  /** 供应商统计 */
  async stats(): Promise<{
    stats: Array<{ type: string; count: number; active: number }>;
    total: number;
    active: number;
  }> {
    const resp = await http.get<{
      data: {
        stats: Array<{ type: string; count: number; active: number }>;
        total: number;
        active: number;
      };
    }>(ENDPOINTS.providers.stats);
    return resp.data;
  },

  /** 获取供应商预设（按分类分组） */
  async getPresets(): Promise<Record<string, unknown[]>> {
    try {
      const resp = await http.get<{ data: Record<string, unknown[]> }>(
        ENDPOINTS.providers.presets,
      );
      return resp?.data ?? {};
    } catch {
      return {};
    }
  },

  /** 创建自定义模型 */
  async createModel(data: {
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
    /** 用户自定义模型标记（is_custom=1，官方价格同步不覆盖） */
    isCustom?: boolean;
  }): Promise<{
    id: string;
    modelId: string;
    displayName?: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    cacheReadCostPerMillion?: number;
    cacheWriteCostPerMillion?: number;
    createdAt: string;
    updatedAt: string;
  }> {
    const resp = await http.post<{
      data: {
        id: string;
        modelId: string;
        displayName?: string;
        inputCostPerMillion: number;
        outputCostPerMillion: number;
        cacheReadCostPerMillion?: number;
        cacheWriteCostPerMillion?: number;
        createdAt: string;
        updatedAt: string;
      };
    }>(ENDPOINTS.models.base, data);
    return resp.data;
  },

  /** 批量导入模型到模型列表 */
  async bulkImportModels(
    providerId: string,
    modelIds: string[],
  ): Promise<{ imported: number }> {
    const resp = await http.post<{
      data: { imported: number };
    }>(ENDPOINTS.models.bulkImport, { modelIds, providerId });
    return resp.data;
  },
};
