/**
 * 上下文统计收集器
 * 追踪各类上下文的 Token 分配
 */

import { priceManager } from './PriceManager';
import type { ContextCategory, ContextStats, APIProviderType } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'core:tokenBudget:ContextStatsCollector', level: LogLevel.INFO });

const CONTEXT_COLORS = {
  systemPrompt: '#4A90D9',
  tools: '#50C878',
  memoryFiles: '#FF6B6B',
  messages: '#9B59B6',
  deferred: '#95A5A6',
} as const;

export type ContextType = keyof typeof CONTEXT_COLORS;

export interface ContextItem {
  name: string;
  tokens: number;
  type: ContextType;
  isDeferred?: boolean;
}

export class ContextStatsCollector {
  private items: ContextItem[] = [];

  addSystemPrompt(tokens: number, name: string = 'System Prompt'): void {
    this.items.push({ name, tokens, type: 'systemPrompt' });
  }

  addTools(tokens: number, name: string = 'Tools'): void {
    this.items.push({ name, tokens, type: 'tools' });
  }

  addMemoryFiles(tokens: number, name: string = 'Memory Files'): void {
    this.items.push({ name, tokens, type: 'memoryFiles' });
  }

  addMessages(tokens: number, name: string = 'Messages'): void {
    this.items.push({ name, tokens, type: 'messages' });
  }

  addDeferred(tokens: number, name: string = 'Deferred'): void {
    this.items.push({ name, tokens, type: 'deferred', isDeferred: true });
  }

  addCustom(
    tokens: number,
    name: string,
    type: ContextType = 'messages'
  ): void {
    this.items.push({ name, tokens, type });
  }

  collect(model: string): ContextStats {
    let maxTokens = 200_000;
    let provider: APIProviderType = 'anthropic';

    try {
      const priceResult = priceManager.getPriceSync(model);
      maxTokens = priceResult.contextWindow;
    } catch (err) {

      // use default

      logger.debug("Operation skipped", { context: "use default", error: err instanceof Error ? err.message : String(err) });

    }

    const totalTokens = this.items.reduce((sum, item) => sum + item.tokens, 0);
    const categories: ContextCategory[] = this.items.map((item) => ({
      name: item.name,
      tokens: item.tokens,
      percentage: totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0,
      color: CONTEXT_COLORS[item.type] || '#95A5A6',
      isDeferred: item.isDeferred,
    }));

    return {
      categories,
      totalTokens,
      maxTokens,
      percentage: (totalTokens / maxTokens) * 100,
      model,
      provider,
    };
  }

  getItems(): ContextItem[] {
    return [...this.items];
  }

  reset(): void {
    this.items = [];
  }

  static getColorForType(type: ContextType): string {
    return CONTEXT_COLORS[type];
  }

  static getAllColors(): Record<ContextType, string> {
    return { ...CONTEXT_COLORS };
  }
}

export function createContextStatsCollector(): ContextStatsCollector {
  return new ContextStatsCollector();
}
