/**
 * 模型定价工具
 * 提供成本计算、格式化等工具函数
 *
 * 注意：定价数据（COST_TIER_*、MODEL_PRICING、MODEL_ALIASES）已迁移到
 * ModelConfigs.ts 和 ModelRegistry，此文件仅保留工具函数。
 */

// 2026-10-01 D-155（`cost -> ai` 倒挂收口）：模型定价/规范名改经 core SPI 取得，
// `TimeBasedPrice`（type-only）已与 `ModelPricing` 一同下沉 core。
import type { ModelPricing, TimeBasedPrice } from '../core/pricing.js';
import { resolveAiAccess } from '@modules/core/spi';

import { handleError } from '../error/handleError.js';

import { getLogger } from '../monitoring/logs/Logger.js';
const logger = getLogger('cost:ModelPricing');

// 2026-09-30 下沉 core（A1 分层倒挂收口）：定义移至 `core/pricing.ts`，此处**原样转出**
// ⇒ `@modules/cost` 的 `ModelPricing` 导出名与结构逐字不变。
export type { ModelPricing };

/** "HH:mm" → 分钟数（0-1439） */
function minutesOfDay(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 解析分时价格：返回当前时刻命中的时段条目；未配置分时或未命中返回 null。
 * end < start 视为跨天时段（如 21:30-08:00 错峰优惠）。
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

let hasUnknownModelCost = false;

export function hasUnknownModel(): boolean {
  return hasUnknownModelCost;
}

export function resetUnknownModelFlag(): void {
  hasUnknownModelCost = false;
}

function getPricingFromRegistry(modelName: string): ModelPricing | null {
  try {
    const dto = resolveAiAccess().getModelPricing(modelName);
    if (dto) {
      // 防止 DB 中零定价覆盖默认定价 — 当所有定价值均为 0 时回退到默认
      if (dto.inputPer1M === 0 && dto.outputPer1M === 0) {
        return null;
      }
      // 启发式兜底：无明确定价时，缓存读 = 输入×0.1、缓存写 = 输入×1.25（参考 codeburn）
      const cacheRead = dto.cacheReadPer1M;
      const cacheWrite = dto.cacheWritePer1M;
      let inputPrice = dto.inputPer1M;
      let outputPrice = dto.outputPer1M;
      // 分时价差：命中当前时段则用时段价覆盖默认价（如 deepseek 错峰优惠）
      const timeSlot = resolveTimeBasedPricing(dto.timeBasedPricing);
      if (timeSlot) {
        if (timeSlot.inputCostPerMillion !== undefined) {
          inputPrice = timeSlot.inputCostPerMillion;
        }
        if (timeSlot.outputCostPerMillion !== undefined) {
          outputPrice = timeSlot.outputCostPerMillion;
        }
      }
      const timeCacheRead = timeSlot?.cacheReadCostPerMillion;
      const timeCacheWrite = timeSlot?.cacheWriteCostPerMillion;
      return {
        inputPricePerMillion: inputPrice,
        outputPricePerMillion: outputPrice,
        cacheReadPricePerMillion:
          timeCacheRead && timeCacheRead > 0
            ? timeCacheRead
            : cacheRead && cacheRead > 0
              ? cacheRead
              : inputPrice * 0.1,
        cacheCreationPricePerMillion:
          timeCacheWrite && timeCacheWrite > 0
            ? timeCacheWrite
            : cacheWrite && cacheWrite > 0
              ? cacheWrite
              : inputPrice * 1.25,
        webSearchPricePerRequest: 0.01,
        billingMode: dto.billingMode,
        pricePerRequest: dto.pricePerRequest,
      };
    }
  } catch (err) {
    // ModelRegistry 不可用时忽略
    // @ignore-catch: non-critical fallback

    handleError(err, { module: 'cost:ModelPricing', action: 'getPricing' });
  }
  return null;
}

export function getCanonicalModelName(modelName: string): string {
  try {
    const canonical =
      resolveAiAccess().getModelPricing(modelName)?.canonicalName;
    if (canonical) return canonical;
  } catch (err) {
    // 忽略
    // @ignore-catch: non-critical fallback

    handleError(err, {
      module: 'cost:ModelPricing',
      action: 'getCanonicalName',
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
