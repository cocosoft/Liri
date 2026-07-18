/**
 * Cache-aware Token 预算计算
 * 区分 cache hit/miss 并正确计算成本
 */

import { priceManager } from './PriceManager';
import type { ModelPriceTable, TokenUsageDetail } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'core:tokenBudget:CacheAwareBudget', level: LogLevel.INFO });

export interface CacheEfficiencyResult {
  efficiency: number;
  ratio: string;
  isWorthIt: boolean;
  totalSavings: number;
}

export function calculateCacheAwareUsage(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  model: string
): TokenUsageDetail {
  const priceResult = priceManager.getPriceSync(model);
  const pricing = priceResult.pricing;
  const totalTokens =
    inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  const estimatedCost = calculateCost(
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    pricing
  );

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    estimatedCost,
  };
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  pricing: ModelPriceTable
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M;
  const cacheCreationCost =
    (cacheCreationTokens / 1_000_000) * pricing.cacheWritePer1M;

  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

export function getCacheEfficiency(
  cacheReadTokens: number,
  cacheCreationTokens: number,
  model?: string
): CacheEfficiencyResult {
  if (cacheCreationTokens === 0) {
    return {
      efficiency: 0,
      ratio: 'N/A',
      isWorthIt: false,
      totalSavings: 0,
    };
  }

  const ratio = cacheReadTokens / cacheCreationTokens;
  const isWorthIt = ratio > 1;

  let totalSavings = 0;
  if (model) {
    try {
      const priceResult = priceManager.getPriceSync(model);
      const fullCost =
        (cacheReadTokens / 1_000_000) * priceResult.pricing.inputPer1M;
      const cacheCost =
        (cacheReadTokens / 1_000_000) * priceResult.pricing.cacheReadPer1M;
      totalSavings = fullCost - cacheCost;
    } catch (err) {

      // ignore

      logger.debug("Operation skipped", { context: "ignore", error: err instanceof Error ? err.message : String(err) });

    }
  }

  return {
    efficiency: Math.min(ratio, 10),
    ratio: `${ratio.toFixed(2)}x`,
    isWorthIt,
    totalSavings,
  };
}

export function estimateSavings(
  cacheReadTokens: number,
  model: string
): number {
  try {
    const priceResult = priceManager.getPriceSync(model);
    const fullCost =
      (cacheReadTokens / 1_000_000) * priceResult.pricing.inputPer1M;
    const cacheCost =
      (cacheReadTokens / 1_000_000) * priceResult.pricing.cacheReadPer1M;
    return fullCost - cacheCost;
  } catch {
    return 0;
  }
}
