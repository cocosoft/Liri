/**
 * 价格管理器
 * 统一管理多个价格提供者，使用 ModelRegistry 作为默认回退
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import type { IPriceProvider, PricingResult } from './providers/IPriceProvider';
import { ConfigPriceProvider } from './providers/ConfigPriceProvider';
import type { ModelPriceTable } from './types';
import { ModelRegistry } from '@modules/ai';

import { calculateCost } from '@modules/cost';
import type { ModelPricing } from '@modules/cost';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('core:tokenBudget:PriceManager');

export interface CostCalculationResult {
  cost: number;
  pricing: ModelPriceTable;
  details: {
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheCreationCost: number;
  };
}

const DEFAULT_PRICING_RESULT: PricingResult = {
  model: '',
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

export class PriceManager {
  private providers: IPriceProvider[] = [];
  private priceCache: Map<string, PricingResult> = new Map();

  constructor() {
    // 不再使用 BuiltinPriceProvider，由 ModelRegistry 替代
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

  private getPricingFromRegistry(model: string): PricingResult | null {
    try {
      const registry = ModelRegistry.getInstance();
      const pricing = registry.getModelPricing(model);
      if (pricing) {
        return {
          model,
          pricing: {
            inputPer1M: pricing.inputPer1M,
            outputPer1M: pricing.outputPer1M,
            cacheWritePer1M: 0,
            cacheReadPer1M: 0,
          },
          contextWindow: 200000,
          supportsPromptCache: true,
          source: 'builtin',
        };
      }
    } catch (err) {
      // ModelRegistry 不可用时忽略
      // @ignore-catch: non-critical fallback

      handleError(err, {
        module: 'core:tokenBudget',
        action: 'getPrice',
      });
    }
    return null;
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
          result
            .then((r) => {
              if (r) this.priceCache.set(model, r);
            })
            .catch(() => {
              /* 定价查询失败，静默忽略 */
            });
        }
      }
    }

    const fromRegistry = this.getPricingFromRegistry(model);
    if (fromRegistry) {
      this.priceCache.set(model, fromRegistry);
      return fromRegistry;
    }

    return { ...DEFAULT_PRICING_RESULT, model };
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

    const fromRegistry = this.getPricingFromRegistry(model);
    if (fromRegistry) {
      this.priceCache.set(model, fromRegistry);
      return fromRegistry;
    }

    const result = { ...DEFAULT_PRICING_RESULT, model };
    this.priceCache.set(model, result);
    return result;
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

    const modelPricing: ModelPricing = {
      inputPricePerMillion: pricing.inputPer1M,
      outputPricePerMillion: pricing.outputPer1M,
      cacheReadPricePerMillion: pricing.cacheReadPer1M,
      cacheCreationPricePerMillion: pricing.cacheWritePer1M,
      webSearchPricePerRequest: 0.01,
    };
    const breakdown = calculateCost(
      modelPricing,
      tokens.input,
      tokens.output,
      tokens.cacheCreation ?? 0,
      tokens.cacheRead ?? 0
    );

    return {
      cost: breakdown.total,
      pricing,
      details: {
        inputCost: breakdown.inputCost,
        outputCost: breakdown.outputCost,
        cacheReadCost: breakdown.cacheReadCost,
        cacheCreationCost: breakdown.cacheCreationCost,
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
