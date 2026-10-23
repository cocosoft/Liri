/**
 * 模型定价工具
 * 提供成本计算、格式化等工具函数
 *
 * 注意：定价数据（COST_TIER_*、MODEL_PRICING、MODEL_ALIASES）已迁移到
 * ModelConfigs.ts 和 ModelRegistry，此文件仅保留工具函数。
 */

// 2026-10-01 D-155（`cost -> ai` 倒挂收口）：模型定价/规范名改经 core SPI 取得，
// `TimeBasedPrice`（type-only）已与 `ModelPricing` 一同下沉 core。
// 2026-10-13（债四 S1「换算内核」）：分时价解析 / 兜底价 / 注册表定价投影亦下沉 core。
import {
  DEFAULT_MODEL_PRICING,
  projectRegistryPricing,
  type ModelPricing,
} from '@modules/core/pricing.js';
import { resolveAiAccess } from '@modules/core/spi';

import { handleError } from '../error/handleError.js';

import { getLogger } from '../monitoring/logs/Logger.js';
const logger = getLogger('cost:ModelPricing');

// 2026-09-30 下沉 core（A1 分层倒挂收口）：定义移至 `core/pricing.ts`，此处**原样转出**
// ⇒ `@modules/cost` 的 `ModelPricing` 导出名与结构逐字不变。
export type { ModelPricing };
// 2026-10-13（债四 S1）：分时价解析下沉 core，此处**原样转出**（导出名与签名逐字不变）。
export { resolveTimeBasedPricing } from '@modules/core/pricing.js';

let hasUnknownModelCost = false;

export function hasUnknownModel(): boolean {
  return hasUnknownModelCost;
}

export function resetUnknownModelFlag(): void {
  hasUnknownModelCost = false;
}

function getPricingFromRegistry(modelName: string): ModelPricing | null {
  try {
    // 2026-10-13（债四 S1）：零定价判定 / 分时价覆盖 / 缓存启发式兜底已**下沉 core**
    // （`projectRegistryPricing`，纯函数）—— 与 query 侧取价适配器**同源**，避免「判了却不符」。
    return projectRegistryPricing(resolveAiAccess().getModelPricing(modelName));
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

  // 2026-10-13（债四 S1）：兜底价已下沉 core（`DEFAULT_MODEL_PRICING`，与闸门折算**同一份**）。
  // 返回浅拷贝以保持"每次调用返回独立对象"的既有语义（防调用方就地改写共享常量）。
  hasUnknownModelCost = true;
  return { ...DEFAULT_MODEL_PRICING };
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
