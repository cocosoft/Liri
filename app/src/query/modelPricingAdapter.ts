// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * query 侧「模型 → 定价 / 金额(USD)」取价适配器 —— 债四（USD 唯一口径）切片 **S2**
 * （spec `.trae/specs/unified-budget-and-accounting.md` §11-S2 / §3-D2）。
 *
 * **为什么要适配器**：发送前闸门（`checkDailyBudget`）后续要按「金额(USD)」判定（S3），
 * 需在 `query` 层把"本轮模型"折算为金额。而 `query → cost` 是**分层倒挂**（R00-001）⇒
 * 本适配器**不** import `@modules/cost/**`，而是：
 *   1. **取价**：经 **core SPI** `resolveAiAccess().getModelPricing()`（`spiWiring.ts:247-263` 装配）；
 *   2. **投影**：core 纯函数 `projectRegistryPricing()`（S1 下沉；与 cost 层**同源**）；
 *   3. **换算**：core 纯函数 `calculateTotalCost()`（S1 复用；零依赖）。
 *
 * ⇒ 闸门折算口径 === 成本报表计费口径（同一 `model_registry` 来源 + 同一公式），
 *    满足 spec §6-1「同源」与反目标「判了却不符」的规避。
 *
 * ⚠️ 本文件**不含闸门判定/开关**（那是 S3；依赖 U3/U5/U6）—— 仅提供可注入的取价+换算能力。
 */

import { resolveAiAccess, type AiModelPricingDto } from '@openliri/kernel/spi';
import {
  calculateTotalCost,
  DEFAULT_MODEL_PRICING,
  projectRegistryPricing,
  type ModelPricing,
} from '@openliri/kernel/pricing.js';

/** 模型名 → 注册表定价 DTO 的取价端口（默认经 core SPI；测试可注入假价） */
export type ModelPricingLookup = (
  modelName: string
) => AiModelPricingDto | null;

/** 默认取价端口：经 core SPI 读 `model_registry`（DB 唯一事实来源，`model-usage.md`） */
const defaultLookup: ModelPricingLookup = (modelName) =>
  resolveAiAccess().getModelPricing(modelName);

export interface ResolvedModelPricing {
  pricing: ModelPricing;
  /** true ⇒ 注册表查无此模型 / 零定价，已回落 `DEFAULT_MODEL_PRICING`（**如实标注**，不静默；Q-U5） */
  unknownModel: boolean;
}

/**
 * 解析某模型的定价（经 core SPI 取价 → core 纯投影）。
 *
 * 未登记 / 零定价 ⇒ 回落**兜底价**并**如实标注** `unknownModel: true`
 * （Q-U5：接受兜底价（降级可用），但不静默、不 fail-closed 拒发）。
 */
export function resolveModelPricing(
  modelName: string,
  lookup: ModelPricingLookup = defaultLookup
): ResolvedModelPricing {
  const projected = projectRegistryPricing(lookup(modelName));
  return projected
    ? { pricing: projected, unknownModel: false }
    : { pricing: { ...DEFAULT_MODEL_PRICING }, unknownModel: true };
}

/** 单位换算所需的用量估计（与计费链**同参形状**，Q-U4） */
export interface TurnUsageEstimate {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface TurnCostEstimate {
  costUsd: number;
  unknownModel: boolean;
}

/**
 * 估算单轮 USD 金额：取价（core SPI）→ 换算（`calculateTotalCost`）。
 *
 * 与**计费链**（`StreamPipeline.notifyUsage`）**同参形状**（in/out/cacheCreation/cacheRead；
 * 其余入参默认 0，且**不含 `cost_multiplier`**，Q-U4）⇒ 闸门折算口径 === `cost_records` 计费口径。
 */
export function estimateTurnCostUsd(
  modelName: string,
  usage: TurnUsageEstimate,
  lookup: ModelPricingLookup = defaultLookup
): TurnCostEstimate {
  const { pricing, unknownModel } = resolveModelPricing(modelName, lookup);
  const costUsd = calculateTotalCost(
    pricing,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreationTokens ?? 0,
    usage.cacheReadTokens ?? 0
  );
  return { costUsd, unknownModel };
}
