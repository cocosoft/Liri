/**
 * 使用量统计 API 服务层
 * 对接后端 /v1/usage/* 端点
 */

import { http } from './httpClient';
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
} from '../types';

export const usageService = {
  /** 使用量概览 */
  async summary(params?: {
    startDate?: number;
    endDate?: number;
    model?: string;
    providerId?: string;
  }): Promise<UsageSummary> {
    const resp = await http.get<{ data: UsageSummary }>('/v1/usage/summary', { params: params as Record<string, unknown> });
    return resp.data;
  },

  /** 每日趋势 */
  async trend(params?: {
    startDate?: number;
    endDate?: number;
    model?: string;
  }): Promise<DailyUsageStats[]> {
    const resp = await http.get<{ data: DailyUsageStats[] }>('/v1/usage/trend', { params: params as Record<string, unknown> });
    return resp.data;
  },

  /** 按模型统计 */
  async modelStats(params?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ModelUsageStats[]> {
    const resp = await http.get<{ data: ModelUsageStats[] }>('/v1/usage/models', { params: params as Record<string, unknown> });
    return resp.data;
  },

  /** 按供应商统计 */
  async providerStats(params?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ProviderUsageStats[]> {
    const resp = await http.get<{ data: ProviderUsageStats[] }>('/v1/usage/providers', { params: params as Record<string, unknown> });
    return resp.data;
  },

  /** 请求日志 */
  async logs(params?: {
    model?: string;
    providerId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: unknown[]; total: number; page: number; pageSize: number }> {
    const resp = await http.get<{ data: { data: unknown[]; total: number; page: number; pageSize: number } }>(
      '/v1/usage/logs',
      { params: params as Record<string, unknown> },
    );
    return resp.data;
  },
};
