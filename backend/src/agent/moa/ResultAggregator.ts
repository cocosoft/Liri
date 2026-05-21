/**
 * 多 Agent 输出聚合器
 * 支持投票聚合、加权聚合、最佳选择三种模式
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import type { ScheduledTaskResult } from './ParallelAgentScheduler';

const logger = new Logger();

/**
 * 聚合策略枚举
 */
export enum AggregationStrategy {
  /** 多数投票：选择出现次数最多的结果 */
  MAJORITY_VOTE = 'majority_vote',

  /** 加权聚合：按权重加权综合输出 */
  WEIGHTED = 'weighted',

  /** 最佳选择：选择评分最高的单个结果 */
  BEST_SELECTION = 'best_selection',
}

/**
 * 聚合配置
 */
export interface AggregationConfig {
  /** 聚合策略 */
  strategy: AggregationStrategy;

  /** 各 Agent 权重（加权模式必填） */
  weights?: Record<string, number>;

  /** 评分函数（最佳选择模式必填） */
  scorer?: (result: ScheduledTaskResult) => number;

  /** 最少有效结果数，不足时视为聚合失败 */
  minValidResults?: number;
}

/**
 * 聚合统计信息
 */
export interface AggregationStats {
  /** 参与聚合的结果总数 */
  totalResults: number;

  /** 有效结果数（成功的结果） */
  validResults: number;

  /** 共识率（0~1），表示各结果之间的一致程度 */
  consensusRate: number;

  /** 聚合耗时（毫秒） */
  aggregationDurationMs: number;
}

/**
 * 聚合结果
 */
export interface AggregatedResult {
  /** 聚合后的最终内容 */
  content: string;

  /** 使用的聚合策略 */
  strategy: AggregationStrategy;

  /** 聚合统计信息 */
  stats: AggregationStats;

  /** 各 Agent 的原始结果 */
  individualResults: ScheduledTaskResult[];

  /** 是否聚合成功（有效结果数 >= minValidResults） */
  success: boolean;
}

/**
 * 默认评分函数：按结果长度和成功率综合评分
 */
function defaultScorer(result: ScheduledTaskResult): number {
  if (!result.success) return 0;

  let score = 0.5;

  // 有内容加分
  if (result.content.length > 0) {
    score += 0.2;
  }

  // 按内容长度评分（中等长度最佳）
  const length = result.content.length;
  if (length > 50 && length < 5000) {
    score += 0.2;
  } else if (length >= 5000) {
    score += 0.1;
  }

  // 较短的执行时间加分
  if (result.durationMs < 10000) {
    score += 0.1;
  }

  return Math.min(score, 1.0);
}

/**
 * 多 Agent 输出聚合器
 */
export class ResultAggregator {
  private defaultConfig: AggregationConfig;

  constructor(config?: Partial<AggregationConfig>) {
    this.defaultConfig = {
      strategy: AggregationStrategy.WEIGHTED,
      minValidResults: 1,
      scorer: defaultScorer,
      ...config,
    };
  }

  /**
   * 聚合多个 Agent 的输出结果
   * @param results Agent 执行结果列表
   * @param config 聚合配置（可选，覆盖默认配置）
   * @returns 聚合结果
   */
  async aggregate(
    results: ScheduledTaskResult[],
    config?: Partial<AggregationConfig>
  ): Promise<AggregatedResult> {
    const startTime = Date.now();
    const cfg: AggregationConfig = { ...this.defaultConfig, ...config };

    const validResults = results.filter(
      (r) => r.success && r.content.length > 0
    );

    if (validResults.length < (cfg.minValidResults || 1)) {
      logger.warn('聚合失败：有效结果数不足', {
        required: cfg.minValidResults,
        actual: validResults.length,
      });

      return {
        content: '',
        strategy: cfg.strategy,
        stats: {
          totalResults: results.length,
          validResults: validResults.length,
          consensusRate: 0,
          aggregationDurationMs: Date.now() - startTime,
        },
        individualResults: results,
        success: false,
      };
    }

    let content: string;

    switch (cfg.strategy) {
      case AggregationStrategy.MAJORITY_VOTE:
        content = this.majorityVote(validResults);
        break;
      case AggregationStrategy.WEIGHTED:
        content = this.weightedAggregation(validResults, cfg.weights);
        break;
      case AggregationStrategy.BEST_SELECTION:
        content = this.bestSelection(validResults, cfg.scorer || defaultScorer);
        break;
    }

    const consensusRate = this.calculateConsensus(validResults);
    const duration = Date.now() - startTime;

    logger.info('结果聚合完成', {
      strategy: cfg.strategy,
      validResults: validResults.length,
      totalResults: results.length,
      consensusRate: consensusRate.toFixed(2),
    });

    return {
      content,
      strategy: cfg.strategy,
      stats: {
        totalResults: results.length,
        validResults: validResults.length,
        consensusRate,
        aggregationDurationMs: duration,
      },
      individualResults: results,
      success: true,
    };
  }

  /**
   * 多数投票聚合
   * 将结果按内容分块，选择出现频率最高的内容
   */
  private majorityVote(results: ScheduledTaskResult[]): string {
    if (results.length === 0) return '';
    if (results.length === 1) return results[0].content;

    // 按标准化内容分组计数
    const voteCount = new Map<string, { count: number; original: string }>();

    for (const r of results) {
      const normalized = this.normalizeContent(r.content);
      const existing = voteCount.get(normalized);
      if (existing) {
        existing.count++;
      } else {
        voteCount.set(normalized, { count: 1, original: r.content });
      }
    }

    // 选择得票最高的结果
    let bestContent = '';
    let bestCount = 0;

    for (const [, entry] of voteCount) {
      if (entry.count > bestCount) {
        bestCount = entry.count;
        bestContent = entry.original;
      }
    }

    return bestContent;
  }

  /**
   * 加权聚合
   * 按权重加权输出结果
   */
  private weightedAggregation(
    results: ScheduledTaskResult[],
    weights?: Record<string, number>
  ): string {
    if (results.length === 0) return '';
    if (results.length === 1) return results[0].content;

    // 如果没有权重或权重未覆盖所有 Agent，使用平均权重
    if (!weights || Object.keys(weights).length === 0) {
      return results.map((r) => r.content).join('\n\n---\n\n');
    }

    // 按权重排序降序排列
    const weighted = results
      .map((r) => ({
        result: r,
        weight: weights[r.agentId] || 0.1,
      }))
      .sort((a, b) => b.weight - a.weight);

    // 返回权重最高的结果
    return weighted[0].result.content;
  }

  /**
   * 最佳选择
   * 使用评分函数选择最佳结果
   */
  private bestSelection(
    results: ScheduledTaskResult[],
    scorer: (result: ScheduledTaskResult) => number
  ): string {
    if (results.length === 0) return '';

    let bestResult = results[0];
    let bestScore = scorer(results[0]);

    for (let i = 1; i < results.length; i++) {
      const score = scorer(results[i]);
      if (score > bestScore) {
        bestScore = score;
        bestResult = results[i];
      }
    }

    return bestResult.content;
  }

  /**
   * 计算共识率
   * 基于结果内容的相似度估算一致程度
   */
  private calculateConsensus(results: ScheduledTaskResult[]): number {
    if (results.length <= 1) return 1.0;

    const normalized = results.map((r) => this.normalizeContent(r.content));
    const unique = new Set(normalized);

    // 完全一致 = 1.0，全部不同 = 0.0
    return 1.0 - (unique.size - 1) / (normalized.length - 1);
  }

  /**
   * 标准化内容用于比较
   */
  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]/g, '')
      .trim();
  }
}
