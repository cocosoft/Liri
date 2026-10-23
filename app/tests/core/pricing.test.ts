// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 债四（USD 唯一口径）首批切片 **S1「换算内核」** 验收测试（spec §11-S1 / §3-D2）。
 *
 * 覆盖：定价 + 用量 → 金额(USD) 的**纯换算**（复用 `calculateTotalCost`/`calculateCost`，CS01）
 * - in/out/cacheCreation/cacheRead **四参**（对齐 Q-U4「与计费链同参形状」）
 * - 缺失 / 0 值 / 负值 的默认与钳制
 * - 未知定价的**兜底价**（`DEFAULT_MODEL_PRICING`，Q-U5）—— 纯函数侧只证"兜底价 → 金额同源数值"，
 *   "如实标注"由 S2 取价适配器（`unknownModel`）承载
 * - 注册表定价投影 `projectRegistryPricing`（零定价 ⇒ null；分时价覆盖；缓存启发式）
 *
 * 本文件不引入 IO / DB；全部经 `../../src/core/pricing`（core 零依赖）。
 */

import { describe, it, expect } from 'bun:test';
import {
  calculateCost,
  calculateTotalCost,
  DEFAULT_MODEL_PRICING,
  projectRegistryPricing,
  resolveTimeBasedPricing,
} from '@modules/core/pricing';
import type { ModelPricing } from '@modules/core/pricing';

const PRICING: ModelPricing = {
  inputPricePerMillion: 3,
  outputPricePerMillion: 15,
  cacheReadPricePerMillion: 0.3,
  cacheCreationPricePerMillion: 3.75,
  webSearchPricePerRequest: 0.01,
};

describe('S1 换算内核 — calculateTotalCost（定价 + 用量 → 金额 USD）', () => {
  it('四参（in/out/cacheCreation/cacheRead）换算与分项一致', () => {
    const breakdown = calculateCost(PRICING, 1000, 500, 100, 200);
    // input 1000/1M*$3 = 0.003；output 500/1M*$15 = 0.0075
    // cacheCreation 100/1M*$3.75 = 0.000375；cacheRead 200/1M*$0.3 = 0.00006
    expect(breakdown.inputCost).toBe(0.003);
    expect(breakdown.outputCost).toBe(0.0075);
    expect(breakdown.cacheCreationCost).toBe(0.000375);
    expect(breakdown.cacheReadCost).toBe(0.00006);
    expect(breakdown.total).toBe(0.010935);
    // 便捷入口与分项 total 一致（同源）
    expect(calculateTotalCost(PRICING, 1000, 500, 100, 200)).toBe(
      breakdown.total
    );
  });

  it('缺失缓存参（默认 0）与 0 值 ⇒ 不产生缓存费用', () => {
    expect(calculateTotalCost(PRICING, 1000, 500)).toBe(0.0105);
    expect(calculateTotalCost(PRICING, 1000, 500, 0, 0)).toBe(0.0105);
  });

  it('负 token / 0 用量 钳制 ⇒ 金额 0', () => {
    expect(calculateTotalCost(PRICING, -100, -50)).toBe(0);
    expect(calculateTotalCost(PRICING, 0, 0, 0, 0)).toBe(0);
  });

  it('缓存读/写价缺失（0）⇒ core 启发式兜底（读=input×0.1 / 写=input×1.25）', () => {
    const noCachePricing: ModelPricing = {
      inputPricePerMillion: 10,
      outputPricePerMillion: 30,
      cacheReadPricePerMillion: 0,
      cacheCreationPricePerMillion: 0,
      webSearchPricePerRequest: 0.01,
    };
    const b = calculateCost(noCachePricing, 1000, 500, 100, 200);
    expect(b.cacheReadCost).toBe(0.0002); // 200 * (10*0.1)/1M
    expect(b.cacheCreationCost).toBe(0.00125); // 100 * (10*1.25)/1M
  });
});

describe('S1 换算内核 — 未知定价兜底（Q-U5 数值口径）', () => {
  it('DEFAULT_MODEL_PRICING = $3/M in、$15/M out（与 cost 层同值）', () => {
    expect(DEFAULT_MODEL_PRICING.inputPricePerMillion).toBe(3);
    expect(DEFAULT_MODEL_PRICING.outputPricePerMillion).toBe(15);
  });

  it('兜底价换算可得确定金额（闸门与报表同源数值）', () => {
    // 与 cost/ModelPricing 的兜底路径同值 ⇒ 同源
    expect(calculateTotalCost(DEFAULT_MODEL_PRICING, 1000, 500)).toBe(0.0105);
  });
});

describe('S1 换算内核 — projectRegistryPricing（注册表定价 → ModelPricing，纯函数）', () => {
  it('未提供 / 零定价 ⇒ null（调用方据此回落兜底价并标注未知）', () => {
    expect(projectRegistryPricing(null)).toBeNull();
    expect(projectRegistryPricing(undefined)).toBeNull();
    expect(
      projectRegistryPricing({ inputPer1M: 0, outputPer1M: 0 })
    ).toBeNull();
  });

  it('正常映射 + 缓存启发式（cacheRead/Write 缺省 ⇒ 由核心兜底，与 calculateCost 一致）', () => {
    const p = projectRegistryPricing({
      inputPer1M: 3,
      outputPer1M: 15,
      billingMode: 'token',
      pricePerRequest: 0,
      timeBasedPricing: [],
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
    });
    expect(p).not.toBeNull();
    expect(p!.inputPricePerMillion).toBe(3);
    expect(p!.outputPricePerMillion).toBe(15);
    // 启发式：读=input×0.1、写=input×1.25（与 cost 层 getPricingFromRegistry 同口径）
    expect(p!.cacheReadPricePerMillion).toBeCloseTo(0.3, 10);
    expect(p!.cacheCreationPricePerMillion).toBeCloseTo(3.75, 10);
  });

  it('分时价命中 ⇒ 覆盖 input/output（Q-U4 分时价随取价纳入）', () => {
    const p = projectRegistryPricing(
      {
        inputPer1M: 3,
        outputPer1M: 15,
        timeBasedPricing: [
          {
            start: '21:30',
            end: '08:00',
            inputCostPerMillion: 1.5,
            outputCostPerMillion: 4.5,
          },
        ],
      },
      new Date('2026-08-16T22:00:00')
    );
    expect(p!.inputPricePerMillion).toBe(1.5);
    expect(p!.outputPricePerMillion).toBe(4.5);
  });
});

describe('S1 换算内核 — resolveTimeBasedPricing（由 cost 下沉 core，原样转出）', () => {
  const slots = [{ start: '09:00', end: '18:00', inputCostPerMillion: 3 }];

  it('未配置 / 空数组 ⇒ null', () => {
    expect(
      resolveTimeBasedPricing([], new Date('2026-08-16T10:00:00'))
    ).toBeNull();
    expect(
      resolveTimeBasedPricing(null, new Date('2026-08-16T10:00:00'))
    ).toBeNull();
  });

  it('命中时段 ⇒ 返回该条目', () => {
    const hit = resolveTimeBasedPricing(slots, new Date('2026-08-16T10:00:00'));
    expect(hit?.inputCostPerMillion).toBe(3);
  });
});
