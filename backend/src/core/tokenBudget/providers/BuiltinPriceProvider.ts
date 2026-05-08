//
/**
 * 内置价格提供者
 * 提供常用模型的默认价格配置
 */

import type { IPriceProvider, PricingResult } from './IPriceProvider';
import type { ModelPricing } from '../types';

const DEFAULT_CONTEXT_WINDOW = 200_000;

const BUILTIN_PRICES: Record<string, ModelPricing & { contextWindow: number; supportsPromptCache: boolean }> = {
  'claude-opus-4-6': {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheWritePer1M: 18.75,
    cacheReadPer1M: 1.5,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-sonnet-4-6': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheWritePer1M: 3.75,
    cacheReadPer1M: 0.3,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-opus-4-5': {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheWritePer1M: 18.75,
    cacheReadPer1M: 1.5,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-sonnet-4-5': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheWritePer1M: 3.75,
    cacheReadPer1M: 0.3,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-opus-4': {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheWritePer1M: 18.75,
    cacheReadPer1M: 1.5,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-sonnet-4': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheWritePer1M: 3.75,
    cacheReadPer1M: 0.3,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-opus-3-5': {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheWritePer1M: 18.75,
    cacheReadPer1M: 1.5,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-sonnet-3-5': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheWritePer1M: 3.75,
    cacheReadPer1M: 0.3,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'claude-haiku-3-5': {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cacheWritePer1M: 1,
    cacheReadPer1M: 0.08,
    contextWindow: 200_000,
    supportsPromptCache: true,
  },
  'deepseek-chat': {
    inputPer1M: 0.27,
    outputPer1M: 1.1,
    cacheWritePer1M: 0,
    cacheReadPer1M: 0,
    contextWindow: 100_000,
    supportsPromptCache: false,
  },
  'deepseek-coder': {
    inputPer1M: 0.27,
    outputPer1M: 1.1,
    cacheWritePer1M: 0,
    cacheReadPer1M: 0,
    contextWindow: 100_000,
    supportsPromptCache: false,
  },
  'deepseek-v3': {
    inputPer1M: 0.27,
    outputPer1M: 1.1,
    cacheWritePer1M: 0,
    cacheReadPer1M: 0,
    contextWindow: 100_000,
    supportsPromptCache: false,
  },
  'gpt-4o': {
    inputPer1M: 2.5,
    outputPer1M: 10,
    cacheWritePer1M: 10,
    cacheReadPer1M: 1.25,
    contextWindow: 128_000,
    supportsPromptCache: true,
  },
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cacheWritePer1M: 0.6,
    cacheReadPer1M: 0.075,
    contextWindow: 128_000,
    supportsPromptCache: true,
  },
  'gpt-4-turbo': {
    inputPer1M: 10,
    outputPer1M: 30,
    cacheWritePer1M: 10,
    cacheReadPer1M: 1.25,
    contextWindow: 128_000,
    supportsPromptCache: true,
  },
  'gpt-4': {
    inputPer1M: 30,
    outputPer1M: 60,
    cacheWritePer1M: 0,
    cacheReadPer1M: 0,
    contextWindow: 128_000,
    supportsPromptCache: false,
  },
  'gpt-3.5-turbo': {
    inputPer1M: 0.5,
    outputPer1M: 1.5,
    cacheWritePer1M: 0,
    cacheReadPer1M: 0,
    contextWindow: 16_385,
    supportsPromptCache: false,
  },
};

export class BuiltinPriceProvider implements IPriceProvider {
  readonly name = 'builtin';
  priority = 100;

  async getPricing(model: string): Promise<PricingResult | null> {
    const normalizedModel = this.normalizeModelName(model);
    const config = BUILTIN_PRICES[normalizedModel];

    if (!config) {
      return null;
    }

    return {
      model,
      pricing: {
        inputPer1M: config.inputPer1M,
        outputPer1M: config.outputPer1M,
        cacheWritePer1M: config.cacheWritePer1M,
        cacheReadPer1M: config.cacheReadPer1M,
      },
      contextWindow: config.contextWindow,
      supportsPromptCache: config.supportsPromptCache,
      source: 'builtin',
    };
  }

  supports(model: string): boolean {
    const normalizedModel = this.normalizeModelName(model);
    return normalizedModel in BUILTIN_PRICES;
  }

  async getBatchPricing(models: string[]): Promise<PricingResult[]> {
    return Promise.all(models.map(m => this.getPricing(m)));
  }

  private normalizeModelName(model: string): string {
    const lower = model.toLowerCase();

    if (lower.includes('claude-opus-4-6')) return 'claude-opus-4-6';
    if (lower.includes('claude-sonnet-4-6')) return 'claude-sonnet-4-6';
    if (lower.includes('claude-opus-4-5')) return 'claude-opus-4-5';
    if (lower.includes('claude-sonnet-4-5')) return 'claude-sonnet-4-5';
    if (lower.includes('claude-opus-4-1')) return 'claude-opus-4';
    if (lower.includes('claude-opus-4-0')) return 'claude-opus-4';
    if (lower.includes('claude-sonnet-4-1')) return 'claude-sonnet-4';
    if (lower.includes('claude-sonnet-4-0')) return 'claude-sonnet-4';
    if (lower.includes('claude-opus-3-5')) return 'claude-opus-3-5';
    if (lower.includes('claude-sonnet-3-5')) return 'claude-sonnet-3-5';
    if (lower.includes('claude-haiku-3-5')) return 'claude-haiku-3-5';

    if (lower.includes('deepseek-chat')) return 'deepseek-chat';
    if (lower.includes('deepseek-coder')) return 'deepseek-coder';
    if (lower.includes('deepseek-v3') || lower.includes('deepseek-v2')) return 'deepseek-v3';

    if (lower.includes('gpt-4o-mini')) return 'gpt-4o-mini';
    if (lower.includes('gpt-4o')) return 'gpt-4o';
    if (lower.includes('gpt-4-turbo')) return 'gpt-4-turbo';
    if (lower.includes('gpt-4 ')) return 'gpt-4';
    if (lower.includes('gpt-3.5-turbo')) return 'gpt-3.5-turbo';

    return lower;
  }
}
