// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 成本计算核心（**零依赖**）—— core 侧共享实现。
 *
 * 2026-09-30 由上层下沉至 core（A 类分层倒挂收口 A1，见
 * .trae/specs/layer-inversion-a-class-inventory.md §3.2/§3.5.1）：
 * 原 `core/tokenBudget/{PriceManager,CacheAwareBudget}.ts` 直接引用 `@modules/cost`
 * 的 `calculateCost` / `calculateTotalCost` / `ModelPricing`，构成 core → infra 倒挂。
 *
 * 搬入本文件的定义（原文件保留**同名转出**，对外导出名与签名逐字不变）：
 *   - `cost/calculateCost.ts`：`calculateCost` / `calculateTotalCost` / `roundCost` / `CostBreakdown`
 *   - `cost/pricingSafety.ts`：`safeTokens` / `safePerTokenRate`（`safeModelName` 留在原处）
 *   - `cost/ModelPricing.ts`：`ModelPricing`
 *   - `ai/models/ModelPricingService.ts`：`BillingMode`（`ModelPricing` 引用它，不同批搬入会新造
 *     core → app 倒挂，故一并下沉；原文件转出）
 *
 * 落点说明：置于 **core 模块根**（与 `core/paths.ts` 同级），跨模块消费方按**相对 2 段路径**直连 ——
 * 落 `core/utils/**` 等子目录会触发 R03-002「模块出口单一」（台账 D-61 实测）。
 *
 * 设计参考 codeburn-main `src/models.ts:calculateCost`：
 *   - safe() clamp 负 token / NaN → 0
 *   - safePerTokenRate 拒绝负/NaN/Infinity/超 $1
 *   - 缓存写启发式兜底（写 = input×1.25，读 = input×0.1）
 *   - 统一精度：roundCost(cost, 6)
 */

/** 计费模式：按 token / 按次 / 混合 */
export type BillingMode = 'token' | 'per_request' | 'token_and_per_request';

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadPricePerMillion: number;
  cacheCreationPricePerMillion: number;
  webSearchPricePerRequest: number;
  fastModePricing?: ModelPricing;
  /** 计费模式（默认 'token'） */
  billingMode?: BillingMode;
  /** 按次计价单价（美元/请求） */
  pricePerRequest?: number;
}

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
 * 安全 token 数：拒绝负/NaN/Infinity，钳制为 0
 */
export function safeTokens(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 安全每 token 定价（USD）：
 * - 拒绝 undefined/null
 * - 拒绝负/NaN/Infinity
 * - 上限 $1/token（防小数点错位成本虚高，参考 codeburn）
 * - 返回 0 表示不可用
 */
export function safePerTokenRate(n: number | undefined | null): number {
  if (n === undefined || n === null || !Number.isFinite(n) || n < 0) {
    return 0;
  }
  // 上限 $1/token — 远超高最昂贵模型，防上游 JSON 小数点错位
  if (n > 1) {
    return 1;
  }
  return n;
}

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
 * 便捷函数：只返回总成本
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
