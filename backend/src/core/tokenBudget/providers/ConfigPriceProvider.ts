//
/**
 * 配置文件价格提供者
 * 支持用户自定义价格配置
 */

import type { IPriceProvider, PricingResult } from './IPriceProvider';
import type { ModelPricing } from '../types';

export interface UserPricingConfig {
  models?: Record<string, ModelPricing & { contextWindow?: number; supportsPromptCache?: boolean }>;
  remoteUrl?: string;
}

export class ConfigPriceProvider implements IPriceProvider {
  readonly name = 'config';
  priority = 50;
  private config: UserPricingConfig = {};

  setConfig(config: UserPricingConfig): void {
    this.config = config;
  }

  getConfig(): UserPricingConfig {
    return this.config;
  }

  async getPricing(model: string): Promise<PricingResult | null> {
    const modelConfig = this.config.models?.[model];

    if (!modelConfig) {
      return null;
    }

    return {
      model,
      pricing: {
        inputPer1M: modelConfig.inputPer1M,
        outputPer1M: modelConfig.outputPer1M,
        cacheWritePer1M: modelConfig.cacheWritePer1M,
        cacheReadPer1M: modelConfig.cacheReadPer1M,
      },
      contextWindow: modelConfig.contextWindow || 200_000,
      supportsPromptCache: modelConfig.supportsPromptCache ?? true,
      source: 'config',
    };
  }

  supports(model: string): boolean {
    return !!this.config.models?.[model];
  }

  async getBatchPricing(models: string[]): Promise<PricingResult[]> {
    return Promise.all(models.map(m => this.getPricing(m)));
  }
}
