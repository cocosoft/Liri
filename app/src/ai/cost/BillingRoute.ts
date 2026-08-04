/**
 * 计费路由
 * 对标 Hermes BillingRoute
 * 实现多模型 → 多定价策略的动态路由
 */
import type { ModelTokenUsage } from '../../cost/types';
// eslint-disable-next-line module-registry/no-direct-module-import
import { calculateTotalCost } from '@modules/cost/calculateCost.js';
import type { ModelPricing } from '@modules/cost/ModelPricing.js';

/**
 * 计费路由决策
 */
export interface BillingRouteDecision {
  /** 选中的模型 */
  model: string;
  /** 定价方案 */
  pricing: ModelTokenUsage;
  /** 路由原因 */
  reason: string;
  /** 预估成本（USD） */
  estimatedCost: number;
  /** 优先级分数（越高越好） */
  priorityScore: number;
}

/**
 * 计费路由策略
 */
export type BillingStrategy =
  | 'cheapest'
  | 'fastest'
  | 'balanced'
  | 'best_quality';

/**
 * 计费路由配置
 */
export interface BillingRouteConfig {
  strategy: BillingStrategy;
  maxCostPerRequest: number;
  maxCostPerDay: number;
  preferCacheHits: boolean;
  costWeights: {
    inputTokenWeight: number;
    outputTokenWeight: number;
    cacheTokenWeight: number;
    latencyWeight: number;
    qualityWeight: number;
  };
}

/**
 * 模型定价条目
 */
export interface ModelPricingEntry {
  model: string;
  pricing: ModelTokenUsage;
  quality: number;
  averageLatencyMs: number;
  contextWindow: number;
  enabled: boolean;
}

/**
 * 路由候选（带计算字段）
 */
interface RouteCandidate extends ModelPricingEntry {
  estimatedCost: number;
  priorityScore: number;
}

/**
 * 默认配置
 */
const DEFAULT_ROUTE_CONFIG: BillingRouteConfig = {
  strategy: 'balanced',
  maxCostPerRequest: 0.5,
  maxCostPerDay: 50,
  preferCacheHits: true,
  costWeights: {
    inputTokenWeight: 0.35,
    outputTokenWeight: 0.25,
    cacheTokenWeight: -0.15,
    latencyWeight: 0.15,
    qualityWeight: 0.1,
  },
};

/**
 * 计费路由
 */
export class BillingRoute {
  private modelEntries: Map<string, ModelPricingEntry> = new Map();
  private config: BillingRouteConfig;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<BillingRouteConfig>) {
    this.config = { ...DEFAULT_ROUTE_CONFIG, ...config };
  }

  /**
   * 注册模型定价
   * @param entry 模型定价条目
   */
  registerModel(entry: ModelPricingEntry): void {
    this.modelEntries.set(entry.model, entry);
  }

  /**
   * 注销模型
   * @param model 模型名
   */
  unregisterModel(model: string): void {
    this.modelEntries.delete(model);
  }

  /**
   * 获取计费路由决策
   * @param inputTokens 预估输入 token
   * @param outputTokens 预估输出 token
   * @param overrideStrategy 覆盖策略
   * @returns 路由决策
   */
  decideRoute(
    inputTokens: number,
    outputTokens: number = inputTokens * 0.3,
    overrideStrategy?: BillingStrategy
  ): BillingRouteDecision | null {
    const strategy = overrideStrategy || this.config.strategy;
    const baseCandidates = this.getEligibleModels(inputTokens, outputTokens);

    if (baseCandidates.length === 0) {
      return null;
    }

    const candidates: RouteCandidate[] = baseCandidates.map((entry) => ({
      ...entry,
      estimatedCost: this.calculateCost(
        entry.pricing,
        inputTokens,
        outputTokens
      ),
      priorityScore: 0,
    }));

    const weights = this.config.costWeights;
    const maxCost = Math.max(...candidates.map((c) => c.estimatedCost), 1);

    for (const candidate of candidates) {
      const costScore = 1 - candidate.estimatedCost / maxCost;

      let priorityScore =
        costScore * weights.inputTokenWeight +
        (1 - candidate.averageLatencyMs / 10000) * weights.latencyWeight +
        candidate.quality * weights.qualityWeight;

      if (
        this.config.preferCacheHits &&
        candidate.pricing.cacheReadTokens > 0
      ) {
        priorityScore += weights.cacheTokenWeight;
      }

      candidate.priorityScore = priorityScore;
    }

    candidates.sort((a, b) => b.priorityScore - a.priorityScore);

    const best = candidates[0];

    return {
      model: best.model,
      pricing: { ...best.pricing },
      reason: this.getRouteReason(strategy, best),
      estimatedCost: best.estimatedCost,
      priorityScore: best.priorityScore,
    };
  }

  /**
   * 获取符合条件的模型列表
   * @param inputTokens 输入 token
   * @param outputTokens 输出 token
   * @returns 模型列表
   */
  private getEligibleModels(
    inputTokens: number,
    outputTokens: number
  ): ModelPricingEntry[] {
    return Array.from(this.modelEntries.values()).filter(
      (e) => e.enabled && e.contextWindow >= inputTokens + outputTokens
    );
  }

  /**
   * 计算预估成本
   *
   * 注意：pricing 参数的类型为 ModelTokenUsage（字段语义为 token 计数），
   * 但本方法将其字段值作为每百万 token 价格使用（除以 1,000,000 后相乘）。
   * 调用方注册 ModelPricingEntry 时，必须确保 pricing 中的值为每百万 token 价格，
   * 而非实际 token 计数。当前类型系统无法保护此约定，重构时需留意。
   *
   * @param pricing 定价方案（传入的字段值必须是每百万 token 价格）
   * @param inputTokens 输入 token
   * @param outputTokens 输出 token
   * @returns 成本（USD）
   */
  private calculateCost(
    pricing: ModelTokenUsage,
    inputTokens: number,
    outputTokens: number
  ): number {
    const modelPricing: ModelPricing = {
      inputPricePerMillion: pricing.inputTokens,
      outputPricePerMillion: pricing.outputTokens,
      cacheReadPricePerMillion: pricing.cacheReadTokens || 0,
      cacheCreationPricePerMillion: pricing.cacheWriteTokens || 0,
      webSearchPricePerRequest: 0.01,
    };
    return calculateTotalCost(
      modelPricing,
      inputTokens,
      outputTokens,
      pricing.cacheWriteTokens || 0,
      pricing.cacheReadTokens || 0
    );
  }

  /**
   * 获取路由原因描述
   */
  private getRouteReason(
    strategy: BillingStrategy,
    entry: ModelPricingEntry
  ): string {
    switch (strategy) {
      case 'cheapest':
        return `选择最经济模型: ${entry.model}`;
      case 'fastest':
        return `选择最快模型: ${entry.model} (平均延迟 ${entry.averageLatencyMs}ms)`;
      case 'best_quality':
        return `选择最优质量模型: ${entry.model} (质量分 ${entry.quality})`;
      default:
        return `平衡选择: ${entry.model} (综合评分最优)`;
    }
  }

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<BillingRouteConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): BillingRouteConfig {
    return { ...this.config };
  }

  /**
   * 获取所有注册的模型
   */
  getRegisteredModels(): ModelPricingEntry[] {
    return Array.from(this.modelEntries.values());
  }
}
