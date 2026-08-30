// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 第七十次补充测试 — 官方价格源 schema 校验（validateOfficialPricing）
 *
 * 校验是"数据进库前的防线"（用户要求：种子/内置数据进库前必须校验），
 * 覆盖：内置数据表合法性 + 非法数据的各类拒绝路径。
 */

import { describe, it, expect } from 'bun:test';
import {
  OFFICIAL_PRICING,
  type OfficialProviderPricing,
} from '../../src/ai/config/official-pricing-data';
import { validateOfficialPricing } from '../../src/ai/config/official-pricing';

function makeProvider(
  overrides: Partial<OfficialProviderPricing> = {}
): OfficialProviderPricing {
  return {
    providerType: 'test',
    sourceUrl: 'https://example.com/pricing',
    updatedAt: '2026-08-31',
    models: [
      {
        modelId: 'test-model',
        inputPer1M: 1,
        outputPer1M: 2,
      },
    ],
    ...overrides,
  };
}

describe('validateOfficialPricing', () => {
  it('内置 OFFICIAL_PRICING 数据表全部合法（保护数据源）', () => {
    const errors = validateOfficialPricing();
    expect(errors).toEqual([]);
  });

  it('合法数据（含跨天分时段）返回空错误', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: 'peak-model',
            inputPer1M: 0.5,
            outputPer1M: 1,
            cacheReadPer1M: 0.05,
            billingMode: 'token_and_per_request',
            pricePerRequest: 0.01,
            timeBasedPricing: [
              {
                start: '21:30',
                end: '08:00', // 跨天时段合法
                inputCostPerMillion: 0.25,
              },
            ],
          },
        ],
      }),
    ];
    expect(validateOfficialPricing(data)).toEqual([]);
  });

  it('纯按次计价（无 token 价）合法', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: 'per-req-model',
            billingMode: 'per_request',
            pricePerRequest: 0.5,
          },
        ],
      }),
    ];
    expect(validateOfficialPricing(data)).toEqual([]);
  });

  it('非法 billingMode 报错', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: 'bad-mode',
            // @ts-expect-error 故意传非法枚举验证校验
            billingMode: 'per_second',
            inputPer1M: 1,
          },
        ],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('billingMode 非法'))).toBe(true);
  });

  it('负价格报错', () => {
    const data = [
      makeProvider({
        models: [{ modelId: 'neg', inputPer1M: -1, outputPer1M: 2 }],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('inputPer1M 不能为负'))).toBe(true);
  });

  it('缺 modelId 报错', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: '',
            inputPer1M: 1,
            outputPer1M: 2,
          },
        ],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('modelId 不能为空'))).toBe(true);
  });

  it('无任何计费依据报错', () => {
    const data = [
      makeProvider({
        models: [{ modelId: 'empty' }],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('至少需要'))).toBe(true);
  });

  it('分时段坏时间格式报错', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: 'bad-slot',
            inputPer1M: 1,
            outputPer1M: 2,
            timeBasedPricing: [
              { start: '9:00', end: '18:00', inputCostPerMillion: 0.5 },
            ],
          },
        ],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('时间格式非法'))).toBe(true);
  });

  it('分时段 start === end 报错（零长度时段）', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: 'zero-slot',
            inputPer1M: 1,
            outputPer1M: 2,
            timeBasedPricing: [
              { start: '10:00', end: '10:00', inputCostPerMillion: 0.5 },
            ],
          },
        ],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('start 不能等于 end'))).toBe(true);
  });

  it('分时段负价格报错', () => {
    const data = [
      makeProvider({
        models: [
          {
            modelId: 'neg-slot',
            inputPer1M: 1,
            outputPer1M: 2,
            timeBasedPricing: [
              { start: '09:00', end: '18:00', outputCostPerMillion: -1 },
            ],
          },
        ],
      }),
    ];
    const errors = validateOfficialPricing(data);
    expect(errors.some((e) => e.includes('分时段 outputCostPerMillion 不能为负'))).toBe(
      true
    );
  });

  it('provider 缺 sourceUrl / 空 models 报错', () => {
    const noUrl = makeProvider({ sourceUrl: '' });
    expect(validateOfficialPricing([noUrl]).some((e) => e.includes('sourceUrl'))).toBe(true);

    const noModels = makeProvider({ models: [] });
    expect(validateOfficialPricing([noModels]).some((e) => e.includes('models 不能为空'))).toBe(
      true
    );
  });
});
