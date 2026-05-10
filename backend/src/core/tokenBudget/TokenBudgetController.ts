/**
 * Token预算控制器 - 增强版
 * 管理token使用预算，防止超出限制
 *
 * 增强功能:
 * - Cache-aware Token 追踪
 * - 上下文分类统计
 * - 多供应商/多模型支持
 */

import { priceManager } from './PriceManager';
import {
  calculateCacheAwareUsage,
  getCacheEfficiency,
} from './CacheAwareBudget';
import {
  createContextStatsCollector,
  type ContextStatsCollector,
} from './ContextStatsCollector';
import type { APIProviderType, TokenUsageDetail, ContextStats } from './types';

let nativeEstimateTokens: ((text: string, model?: string) => number) | null =
  null;

function lazyInitNative() {
  if (nativeEstimateTokens === undefined) {
    try {
      const native = require('../../../native');
      if (native && typeof native.estimateTokens === 'function') {
        nativeEstimateTokens = (text, model) =>
          native.estimateTokens(text, model);
      } else {
        nativeEstimateTokens = null;
      }
    } catch {
      nativeEstimateTokens = null;
    }
  }
  return nativeEstimateTokens;
}

export interface TokenBudgetParams {
  total: number;
  remaining: number;
  used?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  budgetRemaining: number;
  budgetPercentage: number;
}

export interface CacheAwareTokenUsage extends TokenUsage {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCost: number;
}

export class TokenBudgetController {
  private budget: TokenBudgetParams;
  private spent: number = 0;
  private model: string;
  private contextWindow: number;
  private provider: APIProviderType;
  private contextStats: ContextStatsCollector;

  constructor(
    model: string,
    budget: TokenBudgetParams,
    contextWindow?: number
  ) {
    this.model = model;
    this.budget = {
      total: budget.total,
      remaining: budget.remaining,
      used: budget.used || 0,
      maxInputTokens: budget.maxInputTokens,
      maxOutputTokens: budget.maxOutputTokens,
    };
    this.contextWindow = contextWindow || this.getContextWindowForModel(model);
    this.spent = this.budget.used || 0;
    this.provider = this.detectProvider(model);
    this.contextStats = createContextStatsCollector();
  }

  private detectProvider(model: string): APIProviderType {
    const lower = model.toLowerCase();
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
    if (lower.includes('bedrock')) return 'bedrock';
    if (lower.includes('vertex')) return 'vertex';
    if (lower.includes('azure')) return 'azure';
    return 'anthropic';
  }

  private getContextWindowForModel(model: string): number {
    try {
      const priceResult = priceManager.getPriceSync(model);
      return priceResult.contextWindow;
    } catch {
      return 200_000;
    }
  }

  shouldContinue(): boolean {
    return this.budget.remaining > 0;
  }

  recordUsage(inputTokens: number, outputTokens: number): TokenUsage {
    const totalTokens = inputTokens + outputTokens;
    this.spent += totalTokens;
    this.budget.remaining = Math.max(0, this.budget.total - this.spent);

    if (this.budget.used !== undefined) {
      this.budget.used = this.spent;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      budgetRemaining: this.budget.remaining,
      budgetPercentage: (this.budget.remaining / this.budget.total) * 100,
    };
  }

  recordCacheAwareUsage(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0
  ): CacheAwareTokenUsage {
    const usage = calculateCacheAwareUsage(
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      this.model
    );

    const totalTokens = inputTokens + outputTokens;
    this.spent += totalTokens;
    this.budget.remaining = Math.max(0, this.budget.total - this.spent);

    if (this.budget.used !== undefined) {
      this.budget.used = this.spent;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      estimatedCost: usage.estimatedCost,
      budgetRemaining: this.budget.remaining,
      budgetPercentage: (this.budget.remaining / this.budget.total) * 100,
    };
  }

  getCacheEfficiencyMetrics(
    cacheReadTokens: number,
    cacheCreationTokens: number
  ) {
    return getCacheEfficiency(cacheReadTokens, cacheCreationTokens, this.model);
  }

  addSystemPromptTokens(tokens: number): void {
    this.contextStats.addSystemPrompt(tokens);
  }

  addToolsTokens(tokens: number): void {
    this.contextStats.addTools(tokens);
  }

  addMemoryFilesTokens(tokens: number): void {
    this.contextStats.addMemoryFiles(tokens);
  }

  addMessageTokens(tokens: number): void {
    this.contextStats.addMessages(tokens);
  }

  addDeferredTokens(tokens: number): void {
    this.contextStats.addDeferred(tokens);
  }

  getContextStats(): ContextStats {
    return this.contextStats.collect(this.model);
  }

  resetContextStats(): void {
    this.contextStats.reset();
  }

  getRemainingBudget(): number {
    return this.budget.remaining;
  }

  getUsedBudget(): number {
    return this.spent;
  }

  getTotalBudget(): number {
    return this.budget.total;
  }

  getBudgetPercentage(): number {
    return (this.budget.remaining / this.budget.total) * 100;
  }

  resetBudget(): void {
    this.spent = 0;
    this.budget.remaining = this.budget.total;
    if (this.budget.used !== undefined) {
      this.budget.used = 0;
    }
  }

  getModel(): string {
    return this.model;
  }

  getContextWindow(): number {
    return this.contextWindow;
  }

  getProvider(): APIProviderType {
    return this.provider;
  }

  setBudget(budget: TokenBudgetParams): void {
    this.budget = budget;
    this.spent = this.budget.used || 0;
  }

  getBudgetParams(): TokenBudgetParams {
    return { ...this.budget };
  }

  isBudgetExhausted(): boolean {
    return this.budget.remaining <= 0;
  }

  isBudgetLow(): boolean {
    return this.getBudgetPercentage() < 20;
  }

  isBudgetCritical(): boolean {
    return this.getBudgetPercentage() < 10;
  }
}

export function getContextWindowForModel(model: string): number {
  try {
    const priceResult = priceManager.getPriceSync(model);
    return priceResult.contextWindow;
  } catch {
    return 200_000;
  }
}

export function getEffectiveContextWindow(
  model: string,
  reservedOutputTokens: number = 20000
): number {
  const contextWindow = getContextWindowForModel(model);
  return Math.max(0, contextWindow - reservedOutputTokens);
}

export function getDefaultTokenBudget(model: string): TokenBudgetParams {
  const contextWindow = getContextWindowForModel(model);
  return {
    total: contextWindow,
    remaining: contextWindow,
    used: 0,
    maxInputTokens: Math.floor(contextWindow * 0.8),
    maxOutputTokens: Math.floor(contextWindow * 0.2),
  };
}

export function estimateTokenCount(text: string): number {
  const native = lazyInitNative();
  if (native) {
    return native(text);
  }
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokenCount(message: unknown): number {
  const native = lazyInitNative();

  function doCount(text: string): number {
    if (native) return native(text);
    return Math.ceil(text.length / 4);
  }

  if (typeof message === 'string') {
    return doCount(message);
  }

  const msg = message as Record<string, unknown>;
  if (msg.content) {
    if (typeof msg.content === 'string') {
      return doCount(msg.content);
    }
    if (Array.isArray(msg.content)) {
      let total = 0;
      for (const part of msg.content) {
        const p = part as Record<string, unknown>;
        if (p.text && typeof p.text === 'string') {
          total += doCount(p.text);
        }
      }
      return total;
    }
  }

  return 0;
}
