/**
 * 模型定价管理 API 服务层
 * 对接后端 /v1/pricing/* 端点
 */

import { http } from './httpClient';

export interface ModelPricingRecord {
  id: string;
  modelId: string;
  displayName: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheWriteCostPerMillion: number;
  isCustom: boolean;
}

export const pricingService = {
  async list(): Promise<ModelPricingRecord[]> {
    const resp = await http.get<{ data: ModelPricingRecord[] }>('/v1/pricing');
    return resp.data ?? [];
  },

  async upsert(params: {
    modelId: string;
    displayName?: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    cacheReadCostPerMillion?: number;
    cacheWriteCostPerMillion?: number;
  }): Promise<ModelPricingRecord> {
    const resp = await http.post<{ data: ModelPricingRecord }>('/v1/pricing', params);
    return resp.data;
  },

  async remove(modelId: string): Promise<void> {
    await http.delete(`/v1/pricing/${encodeURIComponent(modelId)}`);
  },
};
