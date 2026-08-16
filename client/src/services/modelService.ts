import { httpLegacy as http } from "./httpClient";
import type { BillingMode, ModelInfo, TimeBasedPrice } from "../types";

export type { ModelInfo };

export interface UpdateModelParams {
  capabilities?: string[];
  displayName?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  billingMode?: BillingMode;
  pricePerRequest?: number;
  timeBasedPricing?: TimeBasedPrice[];
}

export const modelService = {
  async list(): Promise<ModelInfo[]> {
    const response = await http.get<{ object: string; data: ModelInfo[] }>(
      "/v1/models",
    );
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  },

  async get(id: string): Promise<ModelInfo | null> {
    const models = await this.list();
    return models.find((m) => m.id === id) || null;
  },

  async update(id: string, params: UpdateModelParams): Promise<ModelInfo> {
    const resp = await http.put<{ data: ModelInfo }>(
      `/v1/models/${encodeURIComponent(id)}`,
      params,
    );
    return resp.data;
  },

  async toggle(id: string): Promise<boolean> {
    const resp = await http.patch<{
      data: { modelId: string; enabled: boolean };
    }>(`/v1/models/${encodeURIComponent(id)}/toggle`);
    return resp.data.enabled;
  },

  async remove(id: string): Promise<void> {
    await http.delete<{ success: boolean }>(
      `/v1/models/${encodeURIComponent(id)}`,
    );
  },

  /** 测试模型连通（POST /v1/models/test，modelId 为模型名，providerId 为供应商 UUID） */
  async test(
    modelId: string,
    providerId: string,
  ): Promise<{ success: boolean; response?: unknown; error?: string }> {
    return await http.post<{
      success: boolean;
      response?: unknown;
      error?: string;
    }>("/v1/models/test", { modelId, providerId });
  },

  /** 同步官方价格到已注册模型（POST /v1/models/pricing/sync），返回更新的模型数 */
  async syncOfficialPricing(): Promise<number> {
    const resp = await http.post<{ data: { updated: number } }>(
      "/v1/models/pricing/sync",
      {},
    );
    return resp?.data?.updated ?? 0;
  },
};
