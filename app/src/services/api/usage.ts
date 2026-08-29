/**
 * API 用量追踪
 *
 * 跟踪 API 调用的 Token 消耗、速率限制和使用情况。
 * 参考 CC源码 cc_code/backend/services/api/usage.ts
 */

import { calculateTotalCost } from '@modules/cost';
import type { ModelPricing } from '@modules/cost';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface RateLimit {
  utilization: number | null;
  resetsAt: string | null;
}

export interface UsageRecord {
  timestamp: Date;
  model: string;
  provider: string;
  tokens: TokenUsage;
  durationMs: number;
  requestId: string;
}

export interface UsageStats {
  totalTokens: TokenUsage;
  totalRequests: number;
  totalDurationMs: number;
  byModel: Record<string, { requests: number; tokens: TokenUsage }>;
  byProvider: Record<string, number>;
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  track(record: UsageRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  getStats(): UsageStats {
    const stats: UsageStats = {
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      totalRequests: 0,
      totalDurationMs: 0,
      byModel: {},
      byProvider: {},
    };

    for (const record of this.records) {
      stats.totalRequests++;
      stats.totalDurationMs += record.durationMs;
      stats.totalTokens.input += record.tokens.input;
      stats.totalTokens.output += record.tokens.output;
      stats.totalTokens.cacheRead =
        (stats.totalTokens.cacheRead || 0) + (record.tokens.cacheRead || 0);
      stats.totalTokens.cacheWrite =
        (stats.totalTokens.cacheWrite || 0) + (record.tokens.cacheWrite || 0);

      if (!stats.byModel[record.model]) {
        stats.byModel[record.model] = {
          requests: 0,
          tokens: { input: 0, output: 0 },
        };
      }
      stats.byModel[record.model].requests++;
      stats.byModel[record.model].tokens.input += record.tokens.input;
      stats.byModel[record.model].tokens.output += record.tokens.output;

      stats.byProvider[record.provider] =
        (stats.byProvider[record.provider] || 0) + 1;
    }

    return stats;
  }

  getRecentRecords(limit: number = 100): UsageRecord[] {
    return this.records.slice(-limit).reverse();
  }

  getTotalCost(
    modelCosts: Record<string, { input: number; output: number }>
  ): number {
    let totalCost = 0;
    for (const record of this.records) {
      const costs = modelCosts[record.model];
      if (costs) {
        const pricing: ModelPricing = {
          inputPricePerMillion: costs.input,
          outputPricePerMillion: costs.output,
          cacheReadPricePerMillion: 0,
          cacheCreationPricePerMillion: 0,
          webSearchPricePerRequest: 0.01,
        };
        totalCost += calculateTotalCost(
          pricing,
          record.tokens.input,
          record.tokens.output,
          record.tokens.cacheWrite ?? 0,
          record.tokens.cacheRead ?? 0
        );
      }
    }
    return totalCost;
  }

  clear(): void {
    this.records = [];
  }
}
