/**
 * Cost Analytics Tracker
 *
 * @deprecated Phase 4 架构收敛：已转为 COST_RECORDED 事件的只读消费者。
 * modelCosts 数据通过订阅 globalEventBus 的 COST_RECORDED 事件自动同步，
 * 不再由外部直接调用 trackModelUsage() 写入。
 *
 * 迁移路径：
 *   Phase 4: ✅ trackModelUsage() 已移除独立成本累加，改为订阅 globalEventBus
 *   Phase 5: 删除此文件，所有分析能力迁移到 CostReportEndpoint
 *
 * 见 ADR-001: CostTracker 单写入者 + 多只读消费者架构
 */

import { AnalyticsEventQueue } from './AnalyticsEventQueue';
import { calculateTotalCost } from '../cost/calculateCost.js';
import { getModelPricing } from '../cost/ModelPricing.js';
import type { ModelPricing } from '../cost/ModelPricing.js';
import { globalEventBus, SystemEvents } from '../core/events/EventBus';
import type { CostRecordedEvent } from '../core/events/EventBus';
import { createLogger, LogLevel } from '../monitoring/logs/Logger.js';

const logger = createLogger({
  module: 'analytics:CostAnalyticsTracker',
  level: LogLevel.WARN,
});

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ModelCost {
  model: string;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  modelBreakdown: Record<string, ModelCost>;
  averageCostPerRequest: number;
  averageTokensPerRequest: number;
}

export interface CostTrackingConfig {
  pricing: Record<
    string,
    { input: number; output: number; perMillion?: boolean }
  >;
  currency?: string;
  trackCacheTokens?: boolean;
  trackSlowRequests?: boolean;
  slowRequestThresholdMs?: number;
}

const DEFAULT_PRICING: Record<
  string,
  { input: number; output: number; perMillion?: boolean }
> = {};

export class CostAnalyticsTracker {
  private analytics: AnalyticsEventQueue;
  private config: CostTrackingConfig;
  private modelCosts: Map<string, ModelCost> = new Map();
  private totalRequests: number = 0;
  private requestDurations: number[] = [];

  constructor(
    analytics: AnalyticsEventQueue,
    config?: Partial<CostTrackingConfig>
  ) {
    this.analytics = analytics;
    this.config = {
      pricing: { ...DEFAULT_PRICING, ...config?.pricing },
      currency: config?.currency ?? 'USD',
      trackCacheTokens: config?.trackCacheTokens ?? true,
      trackSlowRequests: config?.trackSlowRequests ?? true,
      slowRequestThresholdMs: config?.slowRequestThresholdMs ?? 30000,
    };

    // Phase 4: 订阅 COST_RECORDED 事件，被动同步 CostTracker 数据
    this.subscribeToCostEvents();
  }

  /**
   * 订阅 CostTracker 的 COST_RECORDED 事件，被动同步 modelCosts
   * [ADR-001] 单写入者 + 多只读消费者架构
   */
  private subscribeToCostEvents(): void {
    globalEventBus.subscribe(
      SystemEvents.COST_RECORDED,
      (event: CostRecordedEvent) => {
        const modelCost = this.getOrCreateModelCost(event.model);
        modelCost.totalCost += event.costUSD;
        modelCost.totalTokens += event.inputTokens + event.outputTokens;
        modelCost.requestCount++;
        modelCost.inputTokens += event.inputTokens;
        modelCost.outputTokens += event.outputTokens;
        this.totalRequests++;

        logger.debug('CostAnalyticsTracker: synced from COST_RECORDED', {
          model: event.model,
          costUSD: event.costUSD,
          tokens: event.inputTokens + event.outputTokens,
        });
      }
    );
  }

  /**
   * [ADR-001] trackModelUsage 已迁移为只读消费者。
   * 不再独立累加 modelCosts，数据通过 COST_RECORDED 事件自动同步。
   * 调用方应使用 costTracker.addCost() 作为唯一写入入口。
   */
  trackModelUsage(
    model: string,
    usage: TokenUsage,
    metadata?: Record<string, unknown>
  ): void {
    const cost = this.calculateCost(model, usage);

    // 仅记录分析日志（JSONL），不再独立累加 modelCosts
    this.analytics.logEvent('model_usage', {
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cost,
      cache_read_tokens: usage.cacheReadInputTokens,
      cache_creation_tokens: usage.cacheCreationInputTokens,
      ...metadata,
    });

    if (this.config.trackCacheTokens && usage.cacheReadInputTokens) {
      this.analytics.logEvent('cache_tokens_used', {
        model,
        cache_read_tokens: usage.cacheReadInputTokens,
      });
    }
  }

  trackAPICall(
    model: string,
    duration: number,
    success: boolean = true,
    metadata?: Record<string, unknown>
  ): void {
    this.requestDurations.push(duration);

    this.analytics.logEvent('api_call', {
      model,
      duration_ms: duration,
      success,
      ...metadata,
    });

    if (
      this.config.trackSlowRequests &&
      duration > (this.config.slowRequestThresholdMs || 30000)
    ) {
      this.analytics.logEvent('slow_request', {
        model,
        duration_ms: duration,
        threshold_ms: this.config.slowRequestThresholdMs,
      });
    }
  }

  trackError(
    model: string,
    errorType: string,
    errorMessage: string,
    metadata?: Record<string, unknown>
  ): void {
    this.analytics.logEvent('api_error', {
      model,
      error_type: errorType,
      error_message: errorMessage,
      ...metadata,
    });
  }

  calculateCost(model: string, usage: TokenUsage): number {
    const configPricing = this.config.pricing[model];

    // 无配置时回退到 ModelPricing 统一定价（含 Registry 兜底）
    if (!configPricing) {
      const pricing = getModelPricing(model);
      return calculateTotalCost(
        pricing,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheCreationInputTokens ?? 0,
        usage.cacheReadInputTokens ?? 0
      );
    }

    // config 定价 → 转换为 ModelPricing 统一计算
    const modelPricing: ModelPricing = {
      inputPricePerMillion: configPricing.perMillion
        ? configPricing.input
        : configPricing.input * 1_000_000,
      outputPricePerMillion: configPricing.perMillion
        ? configPricing.output
        : configPricing.output * 1_000_000,
      cacheReadPricePerMillion: 0, // 使用 calculateTotalCost 启发式兜底
      cacheCreationPricePerMillion: 0,
      webSearchPricePerRequest: 0.01,
    };
    return calculateTotalCost(
      modelPricing,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheCreationInputTokens ?? 0,
      usage.cacheReadInputTokens ?? 0
    );
  }

  getModelCost(model: string): ModelCost | undefined {
    return this.modelCosts.get(model);
  }

  getAllModelCosts(): Record<string, ModelCost> {
    return Object.fromEntries(this.modelCosts);
  }

  getSessionCost(): CostSummary {
    let totalCost = 0;
    let totalTokens = 0;

    for (const modelCost of this.modelCosts.values()) {
      totalCost += modelCost.totalCost;
      totalTokens += modelCost.totalTokens;
    }

    const averageCostPerRequest =
      this.totalRequests > 0 ? totalCost / this.totalRequests : 0;
    const averageTokensPerRequest =
      this.totalRequests > 0 ? totalTokens / this.totalRequests : 0;

    return {
      totalCost,
      totalTokens,
      totalRequests: this.totalRequests,
      modelBreakdown: this.getAllModelCosts(),
      averageCostPerRequest,
      averageTokensPerRequest,
    };
  }

  getAverageLatency(): number {
    if (this.requestDurations.length === 0) {
      return 0;
    }

    const sum = this.requestDurations.reduce((acc, dur) => acc + dur, 0);
    return sum / this.requestDurations.length;
  }

  getP95Latency(): number {
    if (this.requestDurations.length === 0) {
      return 0;
    }

    const sorted = [...this.requestDurations].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[index];
  }

  reset(): void {
    this.modelCosts.clear();
    this.totalRequests = 0;
    this.requestDurations = [];
  }

  private getOrCreateModelCost(model: string): ModelCost {
    if (!this.modelCosts.has(model)) {
      this.modelCosts.set(model, {
        model,
        totalCost: 0,
        totalTokens: 0,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    return this.modelCosts.get(model)!;
  }

  getConfig(): CostTrackingConfig {
    return { ...this.config };
  }

  updatePricing(
    model: string,
    pricing: { input: number; output: number; perMillion?: boolean }
  ): void {
    this.config.pricing[model] = pricing;
  }

  /**
   * 获取总成本
   * @returns 总成本
   */
  getTotalCost(): number {
    let totalCost = 0;
    for (const modelCost of this.modelCosts.values()) {
      totalCost += modelCost.totalCost;
    }
    return totalCost;
  }
}

let globalCostTracker: CostAnalyticsTracker | null = null;

export function getCostAnalyticsTracker(
  analytics?: AnalyticsEventQueue
): CostAnalyticsTracker {
  if (!globalCostTracker) {
    const analyticsInstance = analytics || new AnalyticsEventQueue();
    globalCostTracker = new CostAnalyticsTracker(analyticsInstance);
  }
  return globalCostTracker;
}

export function setCostAnalyticsTracker(tracker: CostAnalyticsTracker): void {
  globalCostTracker = tracker;
}

export function createCostAnalyticsTracker(
  analytics?: AnalyticsEventQueue
): CostAnalyticsTracker {
  const analyticsInstance = analytics || new AnalyticsEventQueue();
  return new CostAnalyticsTracker(analyticsInstance);
}
