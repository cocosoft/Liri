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
 *   - `ai/models/ModelPricingService.ts`：`TimeBasedPrice`（2026-10-01，`R00-001` 倒挂收口 D-155：
 *     `cost`(infra) 的 `cost/ModelPricing.ts` 以 type-only 引用它 ⇒ 构成 `cost -> ai` 倒挂；
 *     原文件转出，全仓引用名不变）
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

/** 分时价格条目（24h 格式 "HH:mm"；end < start 表示跨天，如 21:30-08:00 错峰） */
export interface TimeBasedPrice {
  start: string;
  end: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
}

/** "HH:mm" → 分钟数（0-1439） */
function minutesOfDay(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 解析分时价格：返回当前时刻命中的时段条目；未配置分时或未命中返回 null。
 * end < start 视为跨天时段（如 21:30-08:00 错峰优惠）。
 *
 * 2026-10-13（债四 S1「换算内核」）由 `cost/ModelPricing.ts` **下沉 core** —— 纯函数、零依赖，
 * 供 core 换算与 query 侧取价适配器**共用同一份分时解析**（避免双源漂移，CS01/R02）。
 * 原处**原样转出**，导出名与签名逐字不变。
 */
export function resolveTimeBasedPricing(
  list: TimeBasedPrice[] | undefined | null,
  now: Date = new Date()
): TimeBasedPrice | null {
  if (!list || list.length === 0) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const p of list) {
    const s = minutesOfDay(p.start);
    const e = minutesOfDay(p.end);
    if (s <= e) {
      if (cur >= s && cur < e) return p;
    } else if (cur >= s || cur < e) {
      // 跨天时段
      return p;
    }
  }
  return null;
}

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

/**
 * 未登记 / 零定价模型的**兜底价**（USD / 百万 tokens）。
 *
 * 2026-10-13（债四 S1「换算内核」）由 `cost/ModelPricing.ts` **下沉 core** —— 使闸门折算与
 * 成本报表回落**同一份兜底**（Q-U5「接受兜底价但如实标注」；避免双源漂移）。
 * 原处**原样转出**，数值与 `ModelPricing` 结构逐字不变。
 */
export const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputPricePerMillion: 3,
  outputPricePerMillion: 15,
  cacheReadPricePerMillion: 0.3,
  cacheCreationPricePerMillion: 3.75,
  webSearchPricePerRequest: WEB_SEARCH_COST_PER_REQUEST,
};

/**
 * 模型注册表定价的**最小结构投影**（AI SPI 的 `AiModelPricingDto` 结构可直接赋值于此）。
 * 仅声明换算所需的字段（零依赖；不引 `core/spi` 类型以规避 core 内类型环）。
 */
export interface RegistryPricingSource {
  inputPer1M: number;
  outputPer1M: number;
  billingMode?: BillingMode;
  pricePerRequest?: number;
  timeBasedPricing?: TimeBasedPrice[];
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
}

/**
 * 把注册表定价投影为 `ModelPricing`（**纯函数，无 IO**）。
 *
 * - 未提供 / 零定价（`inputPer1M === 0 && outputPer1M === 0`）⇒ `null`
 *   （调用方据此回落 `DEFAULT_MODEL_PRICING` 并**如实标注**未知模型，Q-U5）。
 * - 分时价命中当前时段则覆盖默认价（`resolveTimeBasedPricing`）。
 *
 * 2026-10-13（债四 S1「换算内核」）由 `cost/ModelPricing.ts` 的 `getPricingFromRegistry()`
 * **下沉 core**（纯逻辑部分）—— 使成本层与 query 侧取价适配器**同源**（避免「判了却不符」反目标）。
 */
export function projectRegistryPricing(
  source: RegistryPricingSource | null | undefined,
  now: Date = new Date()
): ModelPricing | null {
  if (!source) return null;
  if (source.inputPer1M === 0 && source.outputPer1M === 0) return null;

  const cacheRead = source.cacheReadPer1M ?? 0;
  const cacheWrite = source.cacheWritePer1M ?? 0;
  let inputPrice = source.inputPer1M;
  let outputPrice = source.outputPer1M;
  // 分时价差：命中当前时段则用时段价覆盖默认价（如错峰优惠）
  const timeSlot = resolveTimeBasedPricing(source.timeBasedPricing, now);
  if (timeSlot?.inputCostPerMillion !== undefined) {
    inputPrice = timeSlot.inputCostPerMillion;
  }
  if (timeSlot?.outputCostPerMillion !== undefined) {
    outputPrice = timeSlot.outputCostPerMillion;
  }
  const timeCacheRead = timeSlot?.cacheReadCostPerMillion;
  const timeCacheWrite = timeSlot?.cacheWriteCostPerMillion;
  // 启发式兜底：无明确定价时，缓存读 = 输入×0.1、缓存写 = 输入×1.25（参考 codeburn）
  return {
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    cacheReadPricePerMillion:
      timeCacheRead && timeCacheRead > 0
        ? timeCacheRead
        : cacheRead > 0
          ? cacheRead
          : inputPrice * 0.1,
    cacheCreationPricePerMillion:
      timeCacheWrite && timeCacheWrite > 0
        ? timeCacheWrite
        : cacheWrite > 0
          ? cacheWrite
          : inputPrice * 1.25,
    webSearchPricePerRequest: WEB_SEARCH_COST_PER_REQUEST,
    billingMode: source.billingMode,
    pricePerRequest: source.pricePerRequest,
  };
}
