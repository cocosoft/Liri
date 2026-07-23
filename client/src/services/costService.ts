import { httpLegacy as http } from "./httpClient";

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

export interface CostService {
  getCostSummary(): Promise<CostSummary>;
  getCostRecords(page: number, limit: number): Promise<CostRecordsResponse>;
  getCostByDateRange(startDate: string, endDate: string): Promise<CostRecord[]>;
}

export const costService: CostService = {
  async getCostSummary(): Promise<CostSummary> {
    return http.get<CostSummary>("/api/cost/summary");
  },

  async getCostRecords(
    page: number,
    limit: number,
  ): Promise<CostRecordsResponse> {
    return http.get<CostRecordsResponse>("/api/cost/records", {
      params: { page, limit },
    });
  },

  async getCostByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<CostRecord[]> {
    return http.get<CostRecord[]>("/api/cost/range", {
      params: { startDate, endDate },
    });
  },
};
