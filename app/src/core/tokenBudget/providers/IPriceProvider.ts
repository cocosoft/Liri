/**
 * 价格提供者接口
 * 所有价格获取逻辑都实现此接口
 */

import type { ModelPricing } from '@modules/core/tokenBudget/types';

export interface PricingResult {
  model: string;
  pricing: ModelPricing;
  contextWindow: number;
  supportsPromptCache: boolean;
  source: 'builtin' | 'config' | 'remote' | 'custom';
  lastUpdated?: string;
}

export interface IPriceProvider {
  readonly name: string;
  getPricing(model: string): Promise<PricingResult | null>;
  getBatchPricing(models: string[]): Promise<PricingResult[]>;
  supports(model: string): boolean;
  priority: number;
}
