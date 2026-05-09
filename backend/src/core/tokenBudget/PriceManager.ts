/**
 * 价格管理器
 * 统一管理多个价格提供者
 */

import type { IPriceProvider, PricingResult } from './providers/IPriceProvider';
import { BuiltinPriceProvider } from './providers/BuiltinPriceProvider';
import { ConfigPriceProvider } from './providers/ConfigPriceProvider';
import type { ModelPricing } from './types';

export interface CostCalculationResult {
  cost: number;
  pricing: ModelPricing;
  details: {
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheCreationCost: number;
  };
}

export class PriceManager {
  private providers: IPriceProvider[] = [];
  private defaultProvider: IPriceProvider;
  private priceCache: Map<string, PricingResult> = new Map();

  constructor() {
    this.defaultProvider = new BuiltinPriceProvider();
  }

  registerProvider(provider: IPriceProvider): void {
    const exists = this.providers.find((p) => p.name === provider.name);
    if (exists) {
      return;
    }
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
    this.priceCache.clear();
  }

  getProviders(): IPriceProvider[] {
    return [...this.providers];
  }

  getPriceSync(model: string): PricingResult {
    const cached = this.priceCache.get(model);
    if (cached) {
      return cached;
    }

    for (const provider of this.providers) {
      if (provider.supports(model)) {
        const result = provider.getPricing(model);
        if (result) {
          result.then((r) => {
            if (r) this.priceCache.set(model, r);
          });
          const idx = model.toLowerCase().indexOf('claude');
          if (idx >= 0) {
            return {
              model,
              pricing: {
                inputPer1M: 3,
                outputPer1M: 15,
                cacheWritePer1M: 3.75,
                cacheReadPer1M: 0.3,
              },
              contextWindow: 200000,
              supportsPromptCache: true,
              source: 'builtin',
            };
          }
          if (model.toLowerCase().indexOf('deepseek') >= 0) {
            return {
              model,
              pricing: {
                inputPer1M: 0.27,
                outputPer1M: 1.1,
                cacheWritePer1M: 0,
                cacheReadPer1M: 0,
              },
              contextWindow: 100000,
              supportsPromptCache: false,
              source: 'builtin',
            };
          }
          if (model.toLowerCase().indexOf('gpt-4o') >= 0) {
            return {
              model,
              pricing: {
                inputPer1M: 2.5,
                outputPer1M: 10,
                cacheWritePer1M: 10,
                cacheReadPer1M: 1.25,
              },
              contextWindow: 128000,
              supportsPromptCache: true,
              source: 'builtin',
            };
          }
          return {
            model,
            pricing: {
              inputPer1M: 3,
              outputPer1M: 15,
              cacheWritePer1M: 3.75,
              cacheReadPer1M: 0.3,
            },
            contextWindow: 200000,
            supportsPromptCache: true,
            source: 'builtin',
          };
        }
      }
    }

    return {
      model,
      pricing: {
        inputPer1M: 3,
        outputPer1M: 15,
        cacheWritePer1M: 3.75,
        cacheReadPer1M: 0.3,
      },
      contextWindow: 200000,
      supportsPromptCache: true,
      source: 'builtin',
    };
  }

  async getPrice(model: string): Promise<PricingResult> {
    const cached = this.priceCache.get(model);
    if (cached) {
      return cached;
    }

    for (const provider of this.providers) {
      if (provider.supports(model)) {
        const result = await provider.getPricing(model);
        if (result) {
          this.priceCache.set(model, result);
          return result;
        }
      }
    }

    const defaultResult = await this.defaultProvider.getPricing(model);
    if (defaultResult) {
      this.priceCache.set(model, defaultResult);
      return defaultResult;
    }

    throw new Error(`No pricing found for model: ${model}`);
  }

  clearCache(): void {
    this.priceCache.clear();
  }

  async calculateCost(
    model: string,
    tokens: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
    }
  ): Promise<CostCalculationResult> {
    const priceResult = await this.getPrice(model);
    const { pricing } = priceResult;

    const inputCost = (tokens.input / 1_000_000) * pricing.inputPer1M;
    const outputCost = (tokens.output / 1_000_000) * pricing.outputPer1M;
    const cacheReadCost =
      ((tokens.cacheRead || 0) / 1_000_000) * pricing.cacheReadPer1M;
    const cacheCreationCost =
      ((tokens.cacheCreation || 0) / 1_000_000) * pricing.cacheWritePer1M;

    return {
      cost: inputCost + outputCost + cacheReadCost + cacheCreationCost,
      pricing,
      details: {
        inputCost,
        outputCost,
        cacheReadCost,
        cacheCreationCost,
      },
    };
  }

  async calculateCostForUsage(
    model: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
    }
  ): Promise<CostCalculationResult> {
    return this.calculateCost(model, {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens,
      cacheCreation: usage.cacheCreationTokens,
    });
  }
}

export const priceManager = new PriceManager();
