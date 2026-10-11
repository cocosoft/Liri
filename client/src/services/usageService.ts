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
  /** 供应商名称（后端按 model_registry.provider_id → providers.name 解析） */
  providerName?: string;
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

/** 对账结果（GET /v1/usage/cost/reconcile） */
export interface CostReconcileResult {
  matched: number;
  onlyInUsage: number;
  onlyInCost: number;
  costDiffs: Array<{
    requestId: string;
    model: string;
    costUsageLogs: number;
    costRecords: number;
    diff: number;
  }>;
  total: number;
  matchRate: string;
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

/** 日 Token 限额档位（对齐后端 `DailyBudgetManager` 三级模式） */
export type DailyBudgetMode = "normal" | "report_only" | "locked";

/** 日 Token 限额状态（GET /v1/cost/daily-budget，R16 / D3） */
export interface DailyBudgetStatus {
  /** 统计所属**本地**自然日（YYYY-MM-DD） */
  date: string;
  mode: DailyBudgetMode;
  /** 实际已用 Token（不含在途预留） */
  todayUsed: number;
  /** 预计用量（含在途预留；无预留时 === todayUsed） */
  projectedUsed: number;
  dailyLimit: number;
  /** 已用比例（**0..1+** 的比值，非百分数） */
  percentUsed: number;
  remaining: number;
  warningThreshold: number;
  lockThreshold: number;
  killSwitch: boolean;
}

/** 日限额热更新载荷（至少一项；字段合法性由后端边界校验） */
export interface DailyBudgetUpdate {
  dailyLimit?: number;
  warningThreshold?: number;
  lockThreshold?: number;
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

  /** 对账：校验用量日志与成本记录一致性（GET /v1/usage/cost/reconcile） */
  async getCostReconcile(
    startDate?: string,
    endDate?: string,
  ): Promise<CostReconcileResult> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostReconcile",
      async () => {
        return http.get<CostReconcileResult>("/v1/usage/cost/reconcile", {
          params: { startDate, endDate },
        });
      },
    );
  },

  /** 成本报表导出（GET /v1/usage/cost/report） */
  async getCostReport(
    format: "json" | "text" | "csv" | "prometheus" = "json",
    period: "today" | "week" | "month" | "custom" = "month",
  ): Promise<string> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostReport",
      async () => {
        return http.get<string>("/v1/usage/cost/report", {
          params: { format, period },
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

  // — 日 Token 限额 (R16 / D3，路径 /v1/cost/daily-budget*) —
  /** 查询日限额状态（GET /v1/cost/daily-budget） */
  async getDailyBudget(): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:getDailyBudget",
      async () => {
        return http.get<DailyBudgetStatus>("/v1/cost/daily-budget");
      },
    );
  },

  /** 热更新上限/阈值（PUT /v1/cost/daily-budget）—— 服务端持久化，运行期即时生效 */
  async updateDailyBudget(
    patch: DailyBudgetUpdate,
  ): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:updateDailyBudget",
      async () => {
        return http.put<DailyBudgetStatus>("/v1/cost/daily-budget", patch);
      },
    );
  },

  /** 重置当日用量（POST /v1/cost/daily-budget/reset，D6） */
  async resetDailyBudget(): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:resetDailyBudget",
      async () => {
        return http.post<DailyBudgetStatus>("/v1/cost/daily-budget/reset", {});
      },
    );
  },

  /**
   * 放行（POST /v1/cost/daily-budget/relief，D-b）：临时提额 / 单次豁免 / 当日解除。
   *
   * 参数按**结构**声明（`boost` 可带 `factor`/`amount`/`ttlMs`；`waive-once` 可带 `ttlMs`），
   * 与后端 `ReliefInput` 结构等价；非法参数由服务端 fail-loud 回 400。
   */
  async setDailyBudgetRelief(relief: {
    kind: "boost" | "waive-once" | "unlock-today";
    factor?: number;
    amount?: number;
    ttlMs?: number;
  }): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:setDailyBudgetRelief",
      async () => {
        return http.post<DailyBudgetStatus>(
          "/v1/cost/daily-budget/relief",
          relief,
        );
      },
    );
  },

  /** 手动硬锁开关（POST /v1/cost/daily-budget/kill-switch，D6） */
  async setDailyBudgetKillSwitch(enabled: boolean): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:setDailyBudgetKillSwitch",
      async () => {
        return http.post<DailyBudgetStatus>(
          "/v1/cost/daily-budget/kill-switch",
          { enabled },
        );
      },
    );
  },
};
