/**
 * 成本追踪模块类型定义
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ModelPricing {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CostRecord {
  timestamp: Date;
  model: string;
  usage: TokenUsage;
  costUSD: number;
  durationMs: number;
  requestId?: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  requestCount: number;
}

export interface CostSummary {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalDurationMs: number;
  requestCount: number;
  usageByModel: Map<string, ModelUsage>;
}

export interface CostData {
  totalCost: number;
  totalTokens: number;
  costByModel: Record<string, number>;
  tokenByModel: Record<string, { input: number; output: number }>;
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  category: string;
  timestamp: number;
}

export enum CostCategory {
  API_CALL = 'api_call',
  EMBEDDING = 'embedding',
  CACHE = 'cache',
  STORAGE = 'storage',
  COMPUTE = 'compute',
  NETWORK = 'network',
  AI = 'ai',
  OTHER = 'other',
}

export enum CostPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  CUSTOM = 'custom',
}

export interface CostAnalysis {
  totalCost: number;
  averageCost: number;
  minCost: number;
  maxCost: number;
  modelCosts: Record<string, number>;
  dailyCosts: Record<string, number>;
  startDate: string;
  endDate: string;
  projectedCost?: number;
  topModels: Array<{ model: string; cost: number }>;

  /** 按类别成本（EnhancedCostManager使用） */
  costByCategory?: Record<string, number>;
}
