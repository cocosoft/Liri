// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 债四（USD 唯一口径）切片 **S2「query 侧取价适配器」** 验收测试（spec §11-S2）。
 *
 * 覆盖（**可注入假定价**，不依赖 DB / 不依赖 SPI 装配）：
 * - 已知模型 ⇒ 经 core 投影得 `ModelPricing`（`unknownModel: false`）
 * - 未知模型（lookup 返回 null）/ 零定价 ⇒ 回落 `DEFAULT_MODEL_PRICING` 且 `unknownModel: true`（Q-U5 如实标注）
 * - `estimateTurnCostUsd` = core `calculateTotalCost`（金额与 S1 同源）
 *
 * 分层断言见 `bun run lint:arch`（本适配器**不** import `@modules/cost`）。
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveModelPricing,
  estimateTurnCostUsd,
} from '../../src/query/modelPricingAdapter';
import type { ModelPricingLookup } from '../../src/query/modelPricingAdapter';
import { DEFAULT_MODEL_PRICING } from '@openliri/kernel/pricing';

/** 已知模型 DTO（结构满足 AI SPI 的 `AiModelPricingDto`） */
const KNOWN_DTO = {
  inputPer1M: 3,
  outputPer1M: 15,
  billingMode: 'token' as const,
  pricePerRequest: 0,
  timeBasedPricing: [],
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
  canonicalName: 'known-model',
};

/** 造一个返回固定 DTO 的取价端口（测试注入） */
function lookupOf(dto: typeof KNOWN_DTO | null): ModelPricingLookup {
  return () => dto;
}

describe('S2 取价适配器 — resolveModelPricing（core SPI 取价 + core 投影）', () => {
  it('已知模型 ⇒ 投影出 ModelPricing，unknownModel=false', () => {
    const r = resolveModelPricing('known-model', lookupOf(KNOWN_DTO));
    expect(r.unknownModel).toBe(false);
    expect(r.pricing.inputPricePerMillion).toBe(3);
    expect(r.pricing.outputPricePerMillion).toBe(15);
    expect(r.pricing.cacheReadPricePerMillion).toBe(0.3);
    expect(r.pricing.cacheCreationPricePerMillion).toBe(3.75);
  });

  it('未知模型（查无）⇒ 回落兜底价且**如实标注** unknownModel=true', () => {
    const r = resolveModelPricing('unregistered', lookupOf(null));
    expect(r.unknownModel).toBe(true);
    expect(r.pricing).toEqual(DEFAULT_MODEL_PRICING);
    // 返回独立对象（不把共享常量泄给调用方就地改写）
    expect(r.pricing).not.toBe(DEFAULT_MODEL_PRICING);
  });

  it('零定价（in/out 均 0）⇒ 同样按未知处理（与 cost 层同判据）', () => {
    const zero = { ...KNOWN_DTO, inputPer1M: 0, outputPer1M: 0 };
    const r = resolveModelPricing('zero', lookupOf(zero));
    expect(r.unknownModel).toBe(true);
    expect(r.pricing).toEqual(DEFAULT_MODEL_PRICING);
  });
});

describe('S2 取价适配器 — estimateTurnCostUsd（金额与 S1/计费链同源）', () => {
  it('已知模型：in/out 四参换算 = core calculateTotalCost', () => {
    const r = estimateTurnCostUsd(
      'known-model',
      { inputTokens: 1000, outputTokens: 500 },
      lookupOf(KNOWN_DTO)
    );
    // 1000/1M*$3 + 500/1M*$15 = $0.0105
    expect(r.costUsd).toBe(0.0105);
    expect(r.unknownModel).toBe(false);
  });

  it('含缓存四参：金额与 S1 核心用例一致', () => {
    const r = estimateTurnCostUsd(
      'known-model',
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 100,
        cacheReadTokens: 200,
      },
      lookupOf(KNOWN_DTO)
    );
    expect(r.costUsd).toBe(0.010935);
  });

  it('未知模型：兜底价换算 + 标注 unknownModel=true（不静默）', () => {
    const r = estimateTurnCostUsd(
      'unregistered',
      { inputTokens: 1000, outputTokens: 500 },
      lookupOf(null)
    );
    expect(r.costUsd).toBe(0.0105);
    expect(r.unknownModel).toBe(true);
  });
});
