//
/**
 * 模型显示和格式化服务
 * 提供模型信息的显示和格式化功能
 * 参考CC源码: cc_code/backend/utils/modelCost.ts
 */

import { modelManager } from './ModelManager.js';
import {
  getModelKeyByName,
  ALL_MODEL_CONFIGS,
  type ModelKey,
} from './ModelConfigs.js';
import { priceManager } from '@modules/core/tokenBudget/PriceManager';
import { getCacheEfficiency as getCacheEfficiencyFromBudget } from '@modules/core/tokenBudget/CacheAwareBudget';

/**
 * 格式化模型价格
 * @param pricing 定价信息
 * @returns 格式化后的价格字符串
 */
export function formatModelPricing(pricing: {
  inputPer1M: number;
  outputPer1M: number;
}): string {
  const formatPrice = (price: number): string => {
    if (price < 0.01) {
      return `$${(price * 100).toFixed(2)}/100K`;
    }
    return `$${price.toFixed(2)}/1K`;
  };

  return `${formatPrice(pricing.inputPer1M)} input, ${formatPrice(pricing.outputPer1M)} output`;
}

/**
 * 获取模型价格显示字符串
 * @param modelName 模型名称
 * @returns 价格显示字符串
 */
export function getModelPriceDisplay(modelName: string): string {
  const pricing = modelManager.getModelPricing(modelName);
  if (!pricing) {
    return 'Pricing not available';
  }
  return formatModelPricing(pricing);
}

/**
 * 获取模型完整信息显示
 * @param modelName 模型名称
 * @returns 模型信息字符串
 */
export function getModelInfoDisplay(modelName: string): string {
  const displayName = modelManager.getModelDisplayName(modelName);
  const contextWindow = modelManager.getModelContextWindow(modelName);
  const maxOutput = modelManager.getModelMaxOutputTokens(modelName);
  const pricing = getModelPriceDisplay(modelName);

  const contextDisplay =
    contextWindow >= 1000000
      ? `${contextWindow / 1000000}M`
      : `${contextWindow / 1000}K`;

  return `${displayName}\n  Context: ${contextDisplay} tokens\n  Max Output: ${maxOutput} tokens\n  Pricing: ${pricing}`;
}

/**
 * 获取模型简短显示
 * @param modelName 模型名称
 * @returns 简短显示字符串
 */
export function getModelShortDisplay(modelName: string): string {
  return modelManager.getModelDisplayName(modelName);
}

/**
 * 比较模型性能
 * @param model1 模型1
 * @param model2 模型2
 * @returns 比较结果
 */
export function compareModels(
  model1: string,
  model2: string
): {
  fasterModel: string;
  cheaperModel: string;
  largerContextModel: string;
} {
  const pricing1 = modelManager.getModelPricing(model1);
  const pricing2 = modelManager.getModelPricing(model2);
  const context1 = modelManager.getModelContextWindow(model1);
  const context2 = modelManager.getModelContextWindow(model2);

  const avgPrice1 = pricing1
    ? (pricing1.inputPer1M + pricing1.outputPer1M) / 2
    : Infinity;
  const avgPrice2 = pricing2
    ? (pricing2.inputPer1M + pricing2.outputPer1M) / 2
    : Infinity;

  return {
    fasterModel: avgPrice1 < avgPrice2 ? model1 : model2,
    cheaperModel: avgPrice1 < avgPrice2 ? model1 : model2,
    largerContextModel: context1 > context2 ? model1 : model2,
  };
}

/**
 * 获取模型推荐
 * @param useCase 使用场景
 * @returns 推荐模型
 */
export function getModelRecommendation(
  useCase: 'speed' | 'quality' | 'cost' | 'context'
): string {
  switch (useCase) {
    case 'speed':
      return modelManager.getSmallFastModel();
    case 'quality':
      return modelManager.getBestModel();
    case 'cost':
      return modelManager.getDefaultHaikuModel();
    case 'context':
      const opus = modelManager.getDefaultOpusModel();
      return `${opus}[1m]`;
    default:
      return modelManager.getDefaultSonnetModel();
  }
}

/**
 * 格式化成本
 * @param cost 成本（美元）
 * @returns 格式化后的成本字符串
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(4)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * 计算并格式化成本
 * @param modelName 模型名称
 * @param inputTokens 输入token数
 * @param outputTokens 输出token数
 * @returns 格式化后的成本字符串
 */
export function calculateAndFormatCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number
): string {
  const cost = modelManager.calculateCost(modelName, inputTokens, outputTokens);
  if (cost === null) {
    return 'N/A';
  }
  return formatCost(cost);
}

/**
 * 获取模型列表显示
 * @returns 模型列表字符串
 */
export function getModelListDisplay(): string {
  const models = modelManager.getAvailableModels();
  const lines: string[] = ['Available Models:'];

  for (const model of models) {
    const display = modelManager.getModelDisplayName(model);
    const pricing = getModelPriceDisplay(model);
    lines.push(`  - ${display}: ${pricing}`);
  }

  return lines.join('\n');
}

/**
 * 使用 PriceManager 获取模型价格字符串
 * @param modelName 模型名称
 * @returns 价格显示字符串，包含来源
 */
export function getModelPriceFromPriceManager(modelName: string): string {
  const priceResult = priceManager.getPriceSync(modelName);
  const { pricing, source } = priceResult;

  if (!pricing) {
    return 'Pricing not available';
  }

  return `$${pricing.inputPer1M.toFixed(2)} / $${pricing.outputPer1M.toFixed(2)} per 1M tokens [${source}]`;
}

/**
 * 使用 PriceManager 计算并格式化成本（支持 cache tokens）
 * @param modelName 模型名称
 * @param inputTokens 输入token数
 * @param outputTokens 输出token数
 * @param cacheReadTokens cache读取token数
 * @param cacheCreationTokens cache创建token数
 * @returns 格式化后的成本字符串
 */
export function calculateCostFromPriceManager(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheCreationTokens?: number
): string {
  const priceResult = priceManager.getPriceSync(modelName);
  const { pricing } = priceResult;

  if (!pricing) {
    return 'N/A';
  }

  const cost =
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M +
    ((cacheReadTokens || 0) / 1_000_000) * pricing.cacheReadPer1M +
    ((cacheCreationTokens || 0) / 1_000_000) * pricing.cacheWritePer1M;

  return formatCost(cost);
}

/**
 * 获取缓存效率评估
 * @param modelName 模型名称
 * @param cacheReadTokens cache读取token数
 * @param cacheCreationTokens cache创建token数
 * @returns 缓存效率评估结果
 */
export function getCacheEfficiencyFromPriceManager(
  modelName: string,
  cacheReadTokens: number,
  cacheCreationTokens: number
): { worthIt: boolean; ratio: number; description: string } {
  const result = getCacheEfficiencyFromBudget(
    cacheReadTokens,
    cacheCreationTokens,
    modelName
  );
  return {
    worthIt: result.isWorthIt,
    ratio: result.efficiency,
    description: `缓存命中率 ${result.ratio}`,
  };
}
