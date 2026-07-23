/**
 * 模型定价工具
 * 提供成本计算、格式化等工具函数
 *
 * 注意：定价数据（COST_TIER_*、MODEL_PRICING、MODEL_ALIASES）已迁移到
 * ModelConfigs.ts 和 ModelRegistry，此文件仅保留工具函数。
 */

import { ModelRegistry } from '@modules/ai';
import { getModelConfigById } from '@modules/ai';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'cost:ModelPricing',
  level: LogLevel.INFO,
});

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadPricePerMillion: number;
  cacheCreationPricePerMillion: number;
  webSearchPricePerRequest: number;
  fastModePricing?: ModelPricing;
}

let hasUnknownModelCost = false;

export function hasUnknownModel(): boolean {
  return hasUnknownModelCost;
}

export function resetUnknownModelFlag(): void {
  hasUnknownModelCost = false;
}

function getPricingFromRegistry(modelName: string): ModelPricing | null {
  try {
    const registry = ModelRegistry.getInstance();
    const pricing = registry.getModelPricing(modelName);
    if (pricing) {
      // 防止 DB 中零定价覆盖默认定价 — 当所有定价值均为 0 时回退到默认
      if (pricing.inputPer1M === 0 && pricing.outputPer1M === 0) {
        return null;
      }
      const model = registry.getModel(modelName);
      return {
        inputPricePerMillion: pricing.inputPer1M,
        outputPricePerMillion: pricing.outputPer1M,
        cacheReadPricePerMillion: model?.pricing?.cacheReadPer1M ?? 0,
        cacheCreationPricePerMillion: model?.pricing?.cacheWritePer1M ?? 0,
        webSearchPricePerRequest: 0.01,
      };
    }
  } catch (err) {
    // ModelRegistry 不可用时忽略
    // @ignore-catch: non-critical fallback

    logger.debug('Operation skipped', {
      context: 'ModelRegistry 不可用时忽略',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

export function getCanonicalModelName(modelName: string): string {
  try {
    const config = getModelConfigById(modelName);
    if (config?.firstParty) return config.firstParty;
  } catch (err) {
    // 忽略
    // @ignore-catch: non-critical fallback

    logger.debug('Operation skipped', {
      context: '忽略',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return modelName;
}

export function getModelPricing(
  modelName: string,
  isFastMode?: boolean,
  _customPricingOverride?: ModelPricing
): ModelPricing {
  const registryResult = getPricingFromRegistry(modelName);
  if (registryResult) {
    if (isFastMode && registryResult.fastModePricing) {
      return registryResult.fastModePricing;
    }
    return registryResult;
  }

  const defaultPricing: ModelPricing = {
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    cacheReadPricePerMillion: 0.3,
    cacheCreationPricePerMillion: 3.75,
    webSearchPricePerRequest: 0.01,
  };
  hasUnknownModelCost = true;
  return defaultPricing;
}

export function calculateModelCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  webSearchRequests: number = 0,
  isFastMode?: boolean
): number {
  const pricing = getModelPricing(modelName, isFastMode);

  let cost = 0;
  cost += (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  cost += (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPricePerMillion;
  cost +=
    (cacheCreationTokens / 1_000_000) * pricing.cacheCreationPricePerMillion;
  cost += webSearchRequests * pricing.webSearchPricePerRequest;

  return cost;
}

export function calculateCostFromTokens(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  webSearchRequests: number = 0
): number {
  let cost = 0;
  cost += (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  cost += (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPricePerMillion;
  cost +=
    (cacheCreationTokens / 1_000_000) * pricing.cacheCreationPricePerMillion;
  cost += webSearchRequests * pricing.webSearchPricePerRequest;
  return cost;
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

export function formatModelPricing(pricing: ModelPricing): string {
  return [
    `输入: ${formatPrice(pricing.inputPricePerMillion)}/1M`,
    `输出: ${formatPrice(pricing.outputPricePerMillion)}/1M`,
    pricing.cacheReadPricePerMillion > 0
      ? `缓存读: ${formatPrice(pricing.cacheReadPricePerMillion)}/1M`
      : '',
    pricing.cacheCreationPricePerMillion > 0
      ? `缓存写: ${formatPrice(pricing.cacheCreationPricePerMillion)}/1M`
      : '',
  ]
    .filter(Boolean)
    .join(', ');
}

export function getModelPricingString(
  modelName: string,
  isFastMode?: boolean
): string {
  const pricing = getModelPricing(modelName, isFastMode);
  return formatModelPricing(pricing);
}

export function formatCost(cost: number, maxDecimalPlaces: number = 4): string {
  return `$${cost > 0.5 ? Math.round(cost * 100) / 100 : cost.toFixed(maxDecimalPlaces)}`;
}
