export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  successRate: number;
}

export interface DailyUsageStats {
  date: string;
  requestCount: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ModelUsageStats {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
}

export interface ProviderUsageStats {
  providerId: string;
  providerName: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  avgLatencyMs: number;
}

export interface BalanceResult {
  success: boolean;
  provider: string;
  data: Array<{
    planName?: string;
    remaining?: number;
    total?: number;
    used?: number;
    unit?: string;
  }>;
  error?: string;
}

export interface BalanceRecord {
  providerId: string;
  providerName: string;
  providerType: string;
  remaining: number | null;
  total: number | null;
  unit: string;
  queriedAt: number | null;
  supported: boolean;
  belowThreshold: boolean;
}
