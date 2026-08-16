// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 统一成本计算函数
 *
 * 全链路唯一成本计算入口，所有定价逻辑集中于此。
 * UsageTracker、CostTracker、ChatManager、CostBudgetManager 均调用此函数。
 *
 * 参考 codeburn-main `src/models.ts:calculateCost` 的设计：
 *   - 优先 DB 定价（ModelPricingService），兜底 Registry 定价
 *   - safe() clamp 负 token / NaN
 *   - safePerTokenRate 拒绝负/NaN/Infinity/超 $1
 *   - 缓存写启发式兜底（写=input×1.25，读=input×0.1）
 *   - 统一精度：roundCost(cost, 6)
 */

import { safeTokens, safePerTokenRate } from './pricingSafety.js';
import type { ModelPricing } from './ModelPricing.js';

/**
 * 成本组成详情（供调用方审计/日志）
 */
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheCreationCost: number;
  webSearchCost: number;
  /** 按次计价成本（billingMode 含 per_request 时 > 0） */
  perRequestCost: number;
  total: number;
}

/** 5 分钟缓存写 → 1 小时缓存写的乘数（参考 codeburn） */
const ONE_HOUR_CACHE_WRITE_MULTIPLIER = 1.6;

/** 网络搜索单次请求成本（参考 codeburn WEB_SEARCH_COST） */
const WEB_SEARCH_COST_PER_REQUEST = 0.01;

/**
 * 计算模型调用成本
 *
 * @param pricing   从 DB 或 Registry 获取的定价（单位：美元/百万 tokens）
 * @param inputTokens        输入 token 数
 * @param outputTokens       输出 token 数
 * @param cacheCreationTokens 缓存创建 token 数（5 分钟缓存写）
 * @param cacheReadTokens     缓存读取 token 数
 * @param webSearchRequests   网络搜索请求数
 * @param speed               标准 / 快速模式
 * @param oneHourCacheCreationTokens 1 小时缓存创建 token 数（当前无采集来源，默认 0）
 * @param requestCount        请求次数（billingMode 含 per_request 时按此计费，默认 0）
 * @returns 成本（美元）+ 成本组成详情
 */
export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
  webSearchRequests: number = 0,
  speed: 'standard' | 'fast' = 'standard',
  oneHourCacheCreationTokens: number = 0,
  requestCount: number = 0
): CostBreakdown {
  // 安全 clamp：负/NaN/Infinity → 0
  const safeInput = safeTokens(inputTokens);
  const safeOutput = safeTokens(outputTokens);
  const safeCacheRead = safeTokens(cacheReadTokens);
  const safeOneHourCacheCreation = safeTokens(oneHourCacheCreationTokens);
  const totalCacheCreation = Math.max(
    safeTokens(cacheCreationTokens),
    safeOneHourCacheCreation
  );
  const safeFiveMinuteCacheCreation = Math.max(
    0,
    totalCacheCreation - safeOneHourCacheCreation
  );
  const safeWebSearch = safeTokens(webSearchRequests);

  // 安全 clamp 定价
  const inputRate = safePerTokenRate(pricing.inputPricePerMillion / 1_000_000);
  const outputRate = safePerTokenRate(
    pricing.outputPricePerMillion / 1_000_000
  );
  const cacheReadRate = safePerTokenRate(
    pricing.cacheReadPricePerMillion > 0
      ? pricing.cacheReadPricePerMillion / 1_000_000
      : (pricing.inputPricePerMillion * 0.1) / 1_000_000 // 启发式兜底：读=input×0.1
  );
  const cacheWriteRate = safePerTokenRate(
    pricing.cacheCreationPricePerMillion > 0
      ? pricing.cacheCreationPricePerMillion / 1_000_000
      : (pricing.inputPricePerMillion * 1.25) / 1_000_000 // 启发式兜底：写=input×1.25
  );

  // 快速模式乘数（当前 Registry 无此字段，保留接口）
  const multiplier =
    speed === 'fast'
      ? ((pricing as ModelPricing & { fastMultiplier?: number })
          .fastMultiplier ?? 1)
      : 1;

  const inputCost = safeInput * inputRate;
  const outputCost = safeOutput * outputRate;
  const cacheReadCost = safeCacheRead * cacheReadRate;
  const cacheCreationCost =
    safeFiveMinuteCacheCreation * cacheWriteRate +
    safeOneHourCacheCreation * cacheWriteRate * ONE_HOUR_CACHE_WRITE_MULTIPLIER;
  const webSearchCost = safeWebSearch * WEB_SEARCH_COST_PER_REQUEST;

  // 按次计价：billingMode 含 per_request 时按请求次数计费（不乘 fastMultiplier）
  const billingMode = pricing.billingMode ?? 'token';
  const perRequestCost =
    billingMode === 'per_request' || billingMode === 'token_and_per_request'
      ? safeTokens(requestCount) * (pricing.pricePerRequest || 0)
      : 0;

  const total = roundCost(
    (inputCost +
      outputCost +
      cacheReadCost +
      cacheCreationCost +
      webSearchCost) *
      multiplier +
      perRequestCost
  );

  return {
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    cacheReadCost: roundCost(cacheReadCost),
    cacheCreationCost: roundCost(cacheCreationCost),
    webSearchCost: roundCost(webSearchCost),
    perRequestCost: roundCost(perRequestCost),
    total,
  };
}

/**
 * 便捷函数：只返回总成本（向后兼容）
 */
export function calculateTotalCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
  webSearchRequests: number = 0,
  speed: 'standard' | 'fast' = 'standard',
  oneHourCacheCreationTokens: number = 0,
  requestCount: number = 0
): number {
  return calculateCost(
    pricing,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    webSearchRequests,
    speed,
    oneHourCacheCreationTokens,
    requestCount
  ).total;
}

/**
 * 统一精度：六位小数舍入
 */
export function roundCost(cost: number, decimals: number = 6): number {
  const factor = Math.pow(10, decimals);
  return Math.round(cost * factor) / factor;
}
