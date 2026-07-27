/**
 * 统一用量服务层
 * 合并原 usageService / costService / pricingService / balanceService
 * 全部指向 /v1/usage/* 统一前缀
 */

import { httpLegacy as http } from "./httpClient";
import { getOTelTracing } from "../monitoring/otel";
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
  BalanceResult,
  BalanceRecord,
} from "../types";

// ─── 类型定义 (原 costService / pricingService) ──────────────────

export interface CostRecord {
  id: string;
  date: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number;
  currency: string;
}

export interface ProviderBreakdown {
  provider: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number;
  avgLatencyMs: number;
  percentage: number;
}

export interface DailyBreakdown {
  date: string;
  cost: number;
  tokens: number;
}

export interface CostSummary {
  totalSessions: number;
  todayCost: number;
  weeklyCost: number;
  monthlyCost: number;
  yearlyCost: number;
  todayTokens: number;
  monthlyTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  successRate: number;
  sessionCost: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTokens: number;
  topProviders: ProviderBreakdown[];
  dailyBreakdown: DailyBreakdown[];
}

export interface CostRecordsResponse {
  records: CostRecord[];
  total: number;
}

export interface ModelPricingRecord {
  id: string;
  modelId: string;
  displayName: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheWriteCostPerMillion: number;
  costMultiplier: number;
  pricingSource: string;
  isCustom: boolean;
}

// ─── 统一服务 ──────────────────────────────────────────────────

export const usageService = {
  // — 用量统计 (原 usageService) —
  async summary(params?: {
    startDate?: number;
    endDate?: number;
    model?: string;
    providerId?: string;
  }): Promise<UsageSummary> {
    return getOTelTracing().asyncWrap("services:usage:summary", async () => {
      const resp = await http.get<{ data: UsageSummary }>("/v1/usage/summary", {
        params: params as Record<string, unknown>,
      });
      return resp.data;
    });
  },

  async trend(params?: {
    startDate?: number;
    endDate?: number;
    model?: string;
  }): Promise<DailyUsageStats[]> {
    return getOTelTracing().asyncWrap("services:usage:trend", async () => {
      const resp = await http.get<{ data: DailyUsageStats[] }>(
        "/v1/usage/trend",
        { params: params as Record<string, unknown> },
      );
      return resp.data;
    });
  },

  async modelStats(params?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ModelUsageStats[]> {
    return getOTelTracing().asyncWrap("services:usage:modelStats", async () => {
      const resp = await http.get<{ data: ModelUsageStats[] }>(
        "/v1/usage/models",
        { params: params as Record<string, unknown> },
      );
      return resp.data;
    });
  },

  async providerStats(params?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ProviderUsageStats[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:providerStats",
      async () => {
        const resp = await http.get<{ data: ProviderUsageStats[] }>(
          "/v1/usage/providers",
          { params: params as Record<string, unknown> },
        );
        return resp.data;
      },
    );
  },

  async logs(params?: {
    model?: string;
    providerId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    data: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return getOTelTracing().asyncWrap("services:usage:logs", async () => {
      const resp = await http.get<{
        data: {
          data: unknown[];
          total: number;
          page: number;
          pageSize: number;
        };
      }>("/v1/usage/logs", { params: params as Record<string, unknown> });
      return resp.data;
    });
  },

  // — 成本分析 (原 costService，路径迁移到 /v1/usage/cost/*) —
  async getCostSummary(): Promise<CostSummary> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostSummary",
      async () => {
        return http.get<CostSummary>("/v1/usage/cost/summary");
      },
    );
  },

  async getCostRecords(
    page: number,
    limit: number,
  ): Promise<CostRecordsResponse> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostRecords",
      async () => {
        return http.get<CostRecordsResponse>("/v1/usage/cost/records", {
          params: { page, limit },
        });
      },
    );
  },

  async getCostByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<CostRecord[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostByDateRange",
      async () => {
        return http.get<CostRecord[]>("/v1/usage/cost/range", {
          params: { startDate, endDate },
        });
      },
    );
  },

  // — 定价管理 (原 pricingService，路径不变) —
  async listPricing(): Promise<ModelPricingRecord[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:listPricing",
      async () => {
        const resp = await http.get<{ data: ModelPricingRecord[] }>(
          "/v1/pricing",
        );
        return resp.data ?? [];
      },
    );
  },

  async upsertPricing(params: {
    modelId: string;
    displayName?: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    cacheReadCostPerMillion?: number;
    cacheWriteCostPerMillion?: number;
    costMultiplier?: number;
    pricingSource?: string;
  }): Promise<ModelPricingRecord> {
    return getOTelTracing().asyncWrap(
      "services:usage:upsertPricing",
      async () => {
        const resp = await http.post<{ data: ModelPricingRecord }>(
          "/v1/pricing",
          params,
        );
        return resp.data;
      },
    );
  },

  async removePricing(modelId: string): Promise<void> {
    return getOTelTracing().asyncWrap(
      "services:usage:removePricing",
      async () => {
        await http.delete(`/v1/pricing/${encodeURIComponent(modelId)}`);
      },
    );
  },

  // — 余额查询 (原 balanceService，路径迁移到 /v1/usage/balance*) —
  async checkBalance(params: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<BalanceResult> {
    return getOTelTracing().asyncWrap(
      "services:usage:checkBalance",
      async () => {
        const resp = await http.post<{ data: BalanceResult }>(
          "/v1/usage/balance",
          params,
        );
        return resp.data;
      },
    );
  },

  async batchCheckBalance(): Promise<BalanceRecord[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:batchCheckBalance",
      async () => {
        const resp = await http.get<{ data: BalanceRecord[] }>(
          "/v1/usage/balances",
        );
        return resp.data;
      },
    );
  },
};
