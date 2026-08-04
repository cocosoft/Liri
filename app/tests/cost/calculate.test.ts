// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 第 6 步补充测试 — calculateCost 安全函数 + UsageExtractor cache 三级回退
 */

import { describe, it, expect } from 'bun:test';
import { safeTokens, safePerTokenRate, safeModelName } from '../../src/cost/pricingSafety';
import { calculateCost, roundCost } from '../../src/cost/calculateCost';
import type { ModelPricing } from '../../src/cost/ModelPricing';
import {
  extractOpenAIUsage,
  extractAnthropicUsage,
  extractDeepSeekUsage,
  extractUsage,
} from '../../src/ai/tokenizer/UsageExtractor';

// ============================================================
// pricingSafety 测试
// ============================================================
describe('pricingSafety', () => {
  describe('safeTokens', () => {
    it('正常值原样返回', () => {
      expect(safeTokens(1000)).toBe(1000);
    });
    it('负值钳制为 0', () => {
      expect(safeTokens(-100)).toBe(0);
    });
    it('NaN 钳制为 0', () => {
      expect(safeTokens(NaN)).toBe(0);
    });
    it('Infinity 钳制为 0', () => {
      expect(safeTokens(Infinity)).toBe(0);
    });
    it('0 保持不变', () => {
      expect(safeTokens(0)).toBe(0);
    });
  });

  describe('safePerTokenRate', () => {
    it('正常值原样返回', () => {
      expect(safePerTokenRate(0.000015)).toBe(0.000015);
    });
    it('负值钳制为 0', () => {
      expect(safePerTokenRate(-0.001)).toBe(0);
    });
    it('NaN 钳制为 0', () => {
      expect(safePerTokenRate(NaN)).toBe(0);
    });
    it('Infinity 钳制为 0（非有限数）', () => {
      expect(safePerTokenRate(Infinity)).toBe(0);
    });
    it('超过 $1/token 钳制为 1', () => {
      expect(safePerTokenRate(5)).toBe(1);
    });
    it('undefined 返回 0', () => {
      expect(safePerTokenRate(undefined)).toBe(0);
    });
    it('null 返回 0', () => {
      expect(safePerTokenRate(null)).toBe(0);
    });
  });

  describe('safeModelName', () => {
    it('正常名原样返回', () => {
      expect(safeModelName('gpt-4o')).toBe('gpt-4o');
    });
    it('控制字符被替换为 ?', () => {
      expect(safeModelName('test\x00name')).toBe('test?name');
    });
    it('空字符串返回 <unknown>', () => {
      expect(safeModelName('')).toBe('<unknown>');
    });
  });
});

// ============================================================
// calculateCost 测试
// ============================================================
describe('calculateCost', () => {
  const pricing: ModelPricing = {
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    cacheReadPricePerMillion: 0.3,
    cacheCreationPricePerMillion: 3.75,
    webSearchPricePerRequest: 0.01,
  };

  it('基础成本计算', () => {
    const result = calculateCost(pricing, 1000, 500);
    // input: 1000/1M * $3 = $0.003; output: 500/1M * $15 = $0.0075
    // total: $0.0105
    expect(result.inputCost).toBe(0.003);
    expect(result.outputCost).toBe(0.0075);
    expect(result.total).toBe(0.0105);
  });

  it('含缓存读的成本', () => {
    const result = calculateCost(pricing, 1000, 500, 0, 200);
    // cacheRead: 200/1M * $0.3 = $0.00006
    expect(result.cacheReadCost).toBe(0.00006);
    expect(result.total).toBe(0.01056);
  });

  it('缓存读启发式兜底（cacheRead=0 时用 input×0.1）', () => {
    const noCachePricing: ModelPricing = {
      inputPricePerMillion: 10,
      outputPricePerMillion: 30,
      cacheReadPricePerMillion: 0,     // 未配置
      cacheCreationPricePerMillion: 0,  // 未配置
      webSearchPricePerRequest: 0.01,
    };
    const result = calculateCost(noCachePricing, 1000, 500, 100, 200);
    // cacheRead rate 启发式 = 10*0.1/1M = 1e-6 → 200*1e-6 = 0.0002
    // cacheWrite rate 启发式 = 10*1.25/1M = 1.25e-5 → 100*1.25e-5 = 0.00125
    expect(result.cacheReadCost).toBe(0.0002);
    expect(result.cacheCreationCost).toBe(0.00125);
  });

  it('负 token 钳制为 0', () => {
    const result = calculateCost(pricing, -100, -50);
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.total).toBe(0);
  });

  it('网络搜索成本', () => {
    const result = calculateCost(pricing, 1000, 500, 0, 0, 3);
    expect(result.webSearchCost).toBe(0.03);
  });

  describe('roundCost', () => {
    it('六位精度舍入', () => {
      expect(roundCost(0.123456789)).toBe(0.123457);
    });
    it('整数不变', () => {
      expect(roundCost(1)).toBe(1);
    });
  });
});

// ============================================================
// UsageExtractor cache 三级回退测试
// ============================================================
describe('UsageExtractor cache 字段', () => {
  describe('extractOpenAIUsage — cache 字段', () => {
    it('prompt_tokens_details.cached_tokens 提取为 cacheReadTokens', () => {
      const body = {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          prompt_tokens_details: { cached_tokens: 200 },
        },
      };
      const result = extractOpenAIUsage(body);
      expect(result).not.toBeNull();
      expect(result!.cacheReadTokens).toBe(200);
      expect(result!.cacheCreationTokens).toBe(0);
    });
  });

  describe('extractAnthropicUsage — cache 字段', () => {
    it('cache_read_input_tokens / cache_creation_input_tokens', () => {
      const body = {
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 100,
        },
      };
      const result = extractAnthropicUsage(body);
      expect(result).not.toBeNull();
      expect(result!.cacheReadTokens).toBe(300);
      expect(result!.cacheCreationTokens).toBe(100);
    });
  });

  describe('extractDeepSeekUsage — cache 字段', () => {
    it('prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
      const body = {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          prompt_cache_hit_tokens: 200,
          prompt_cache_miss_tokens: 50,
        },
      };
      const result = extractDeepSeekUsage(body);
      expect(result).not.toBeNull();
      expect(result!.cacheReadTokens).toBe(200);
      expect(result!.cacheCreationTokens).toBe(50);
    });
  });

  describe('extractUsage 统一入口', () => {
    it('OpenAI 格式自动检测', () => {
      const body = {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
        },
      };
      const result = extractUsage(body);
      expect(result).not.toBeNull();
      expect(result!.source).toBe('api');
      expect(result!.inputTokens).toBe(1000);
    });

    it('未知格式返回 null', () => {
      const result = extractUsage({});
      expect(result).toBeNull();
    });
  });
});
