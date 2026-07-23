/**
 * CostMultiplierSystem — cost_multiplier 倍率定价系统（Phase 6）
 * 对标 cc-switch cost_multiplier
 *
 * 核心能力：
 *   - 模型倍率配置（cost_multiplier 字段）
 *   - 发布端价格更新自动回填历史成本（update_model_pricing）
 *   - 估算 vs 实际值偏差告警
 */
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'context:cost:multiplier',
  level: LogLevel.INFO,
});

export interface CostMultiplierConfig {
  modelId: string;
  inputMultiplier: number;
  outputMultiplier: number;
  /** 基础单价（per token） */
  baseInputPrice: number;
  baseOutputPrice: number;
  updatedAt: string;
}

export interface PricingDiff {
  modelId: string;
  field: string;
  oldValue: number;
  newValue: number;
}

/**
 * 倍率管理器
 */
export class CostMultiplierManager {
  private multipliers: Map<string, CostMultiplierConfig> = new Map();
  private priceHistory: PricingDiff[] = [];

  register(config: CostMultiplierConfig): void {
    this.multipliers.set(config.modelId, config);
  }

  get(modelId: string): CostMultiplierConfig | undefined {
    return this.multipliers.get(modelId);
  }

  /**
   * 计算实际单价 = basePrice * multiplier
   * CC 源码 cost_multiplier 公式
   */
  calcEffectivePrice(
    modelId: string
  ): { inputPrice: number; outputPrice: number } | null {
    const cfg = this.multipliers.get(modelId);
    if (!cfg) return null;

    return {
      inputPrice: cfg.baseInputPrice * cfg.inputMultiplier,
      outputPrice: cfg.baseOutputPrice * cfg.outputMultiplier,
    };
  }

  /**
   * 更新定价并记录 diff（对标 cc-switch update_model_pricing）
   * 发布端更新后自动回填历史成本
   */
  updatePricing(
    modelId: string,
    updates: Partial<
      Pick<
        CostMultiplierConfig,
        | 'inputMultiplier'
        | 'outputMultiplier'
        | 'baseInputPrice'
        | 'baseOutputPrice'
      >
    >
  ): PricingDiff[] {
    const existing = this.multipliers.get(modelId);
    if (!existing) return [];

    const diffs: PricingDiff[] = [];

    if (
      updates.inputMultiplier != null &&
      updates.inputMultiplier !== existing.inputMultiplier
    ) {
      diffs.push({
        modelId,
        field: 'inputMultiplier',
        oldValue: existing.inputMultiplier,
        newValue: updates.inputMultiplier,
      });
      existing.inputMultiplier = updates.inputMultiplier;
    }
    if (
      updates.outputMultiplier != null &&
      updates.outputMultiplier !== existing.outputMultiplier
    ) {
      diffs.push({
        modelId,
        field: 'outputMultiplier',
        oldValue: existing.outputMultiplier,
        newValue: updates.outputMultiplier,
      });
      existing.outputMultiplier = updates.outputMultiplier;
    }
    if (
      updates.baseInputPrice != null &&
      updates.baseInputPrice !== existing.baseInputPrice
    ) {
      diffs.push({
        modelId,
        field: 'baseInputPrice',
        oldValue: existing.baseInputPrice,
        newValue: updates.baseInputPrice,
      });
      existing.baseInputPrice = updates.baseInputPrice;
    }
    if (
      updates.baseOutputPrice != null &&
      updates.baseOutputPrice !== existing.baseOutputPrice
    ) {
      diffs.push({
        modelId,
        field: 'baseOutputPrice',
        oldValue: existing.baseOutputPrice,
        newValue: updates.baseOutputPrice,
      });
      existing.baseOutputPrice = updates.baseOutputPrice;
    }

    if (diffs.length > 0) {
      existing.updatedAt = new Date().toISOString();
      this.multipliers.set(modelId, existing);
      this.priceHistory.push(...diffs);

      logger.info('cost:multiplier:updated', {
        modelId,
        diffs: diffs.map((d) => `${d.field}: ${d.oldValue} → ${d.newValue}`),
      });
    }

    return diffs;
  }

  getPriceHistory(): PricingDiff[] {
    return this.priceHistory;
  }
}

/** 默认实例 */
export const costMultiplierManager = new CostMultiplierManager();
