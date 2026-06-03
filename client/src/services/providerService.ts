/**
 * Provider API 服务层（DB 驱动）
 * 对接后端 /v1/providers/* 端点
 */

import { http } from './httpClient';
import type { ProviderInfo, ProviderFormData, EndpointLatency, FetchedModel } from '../types';

export const providerService = {
  /** 获取所有供应商 */
  async list(): Promise<ProviderInfo[]> {
    const resp = await http.get<{ data: ProviderInfo[] }>('/v1/providers');
    return resp?.data ?? [];
  },

  /** 获取单个供应商 */
  async get(id: string): Promise<ProviderInfo> {
    const resp = await http.get<{ data: ProviderInfo }>(`/v1/providers/${encodeURIComponent(id)}`);
    return resp.data;
  },

  /** 创建供应商 */
  async create(data: ProviderFormData): Promise<ProviderInfo> {
    const resp = await http.post<{ data: ProviderInfo }>('/v1/providers', data);
    return resp.data;
  },

  /** 更新供应商 */
  async update(id: string, data: Partial<ProviderFormData>): Promise<ProviderInfo> {
    const resp = await http.put<{ data: ProviderInfo }>(`/v1/providers/${encodeURIComponent(id)}`, data);
    return resp.data;
  },

  /** 删除供应商 */
  async remove(id: string): Promise<void> {
    await http.delete(`/v1/providers/${encodeURIComponent(id)}`);
  },

  /** 切换启用/停用 */
  async toggle(id: string): Promise<ProviderInfo> {
    const resp = await http.post<{ data: ProviderInfo }>(`/v1/providers/${encodeURIComponent(id)}/toggle`);
    return resp.data;
  },

  /** 端点测速 */
  async test(id: string): Promise<{ provider: string; results: EndpointLatency[] }> {
    const resp = await http.get<{ data: { provider: string; results: EndpointLatency[] } }>(
      `/v1/providers/${encodeURIComponent(id)}/test`,
    );
    return resp.data;
  },

  /** 获取供应商可用模型列表 */
  async fetchModels(id: string): Promise<{ models: FetchedModel[]; usedUrl: string } | { error: string }> {
    return http.get(`/v1/providers/${encodeURIComponent(id)}/models`);
  },

  /** 供应商统计 */
  async stats(): Promise<{ stats: Array<{ type: string; count: number; active: number }>; total: number; active: number }> {
    const resp = await http.get<{ data: { stats: Array<{ type: string; count: number; active: number }>; total: number; active: number } }>('/v1/providers/stats');
    return resp.data;
  },
};
