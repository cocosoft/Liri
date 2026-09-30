// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 统一成本计算函数 —— **转出壳**（2026-09-30 下沉 core，A 类分层倒挂收口 A1）
 *
 * 实体已移至 `app/src/core/pricing.ts`：`core/tokenBudget/{PriceManager,CacheAwareBudget}.ts`
 * 原先直接引用 `@modules/cost` 的 `calculateCost` / `calculateTotalCost` / `ModelPricing`，
 * 构成 core → infra 倒挂（见 .trae/specs/layer-inversion-a-class-inventory.md §3.2/§3.5.1）。
 *
 * 本文件仅**原样转出**，`@modules/cost` 对外导出名与签名逐字不变。
 */

export {
  calculateCost,
  calculateTotalCost,
  roundCost,
} from '../core/pricing.js';
export type { CostBreakdown } from '../core/pricing.js';
