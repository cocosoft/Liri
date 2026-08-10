/**
 * 多 Agent 输出聚合器
 * 支持投票聚合、加权聚合、最佳选择三种模式
 *
 * P2 可选增强：
 * - 当关键词重叠率在 0.3-0.6 模糊区间时，可配置 LLM 判断器做二次确认
 */

import { getLogger } from '@modules/monitoring';
import type { ScheduledTaskResult } from './ParallelAgentScheduler';

const logger = getLogger('agent:moa:resultAggregator');

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

// ========== P2 增强：LLM 共识判断类型（可选） ==========

/**
 * LLM 共识判断结果
 */
export interface LLMConsensusResult {
  /** LLM 判定是否达成共识 */
  hasConsensus: boolean;
  /** LLM 置信度（0~1） */
  confidence: number;
  /** LLM 简短解释（可选） */
  explanation?: string;
}

/**
 * LLM 共识判断回调
 * 当关键词重叠率在 0.3-0.6 模糊区间时，调用此回调做二次确认
 *
 * @param results 各 Agent 的有效输出结果
 * @returns 共识判断结果
 */
export type LLMConsensusJudge = (
  results: ScheduledTaskResult[]
) => Promise<LLMConsensusResult>;

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

  /**
   * LLM 共识判断器（P2 可选）
   * 当关键词重叠率在 0.3-0.6 模糊区间时调用，替代纯关键词判断
   * 不配置时纯用关键词重叠率
   */
  llmJudge?: LLMConsensusJudge;
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

    // P2 增强：当关键词重叠率在 0.3-0.6 模糊区间时，用 LLM 做二次判断
    let finalConsensusRate = consensusRate;
    if (consensusRate >= 0.3 && consensusRate < 0.6 && cfg.llmJudge) {
      try {
        logger.info('关键词重叠率模糊，触发 LLM 共识判断', {
          consensusRate: consensusRate.toFixed(2),
          validResults: validResults.length,
        });
        const llmResult = await cfg.llmJudge(validResults);
        if (llmResult.hasConsensus) {
          // LLM 确认有共识，上调置信度
          finalConsensusRate = Math.max(
            consensusRate,
            0.7 + llmResult.confidence * 0.2
          );
          logger.info('LLM 判定有共识', {
            from: consensusRate.toFixed(2),
            to: finalConsensusRate.toFixed(2),
            confidence: llmResult.confidence.toFixed(2),
            explanation: llmResult.explanation,
          });
        } else {
          // LLM 认为无共识，下调置信度
          finalConsensusRate = Math.min(consensusRate, 0.25);
          logger.info('LLM 判定无共识', {
            from: consensusRate.toFixed(2),
            to: finalConsensusRate.toFixed(2),
            confidence: llmResult.confidence.toFixed(2),
            explanation: llmResult.explanation,
          });
        }
      } catch (err) {
        // LLM 调用失败时，回退到关键词重叠率，不中断主流程
        logger.warn('LLM 共识判断失败，回退到关键词重叠率', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('结果聚合完成', {
      strategy: cfg.strategy,
      validResults: validResults.length,
      totalResults: results.length,
      consensusRate: finalConsensusRate.toFixed(2),
      llmEnhanced: consensusRate !== finalConsensusRate,
    });

    return {
      content,
      strategy: cfg.strategy,
      stats: {
        totalResults: results.length,
        validResults: validResults.length,
        consensusRate: finalConsensusRate,
        aggregationDurationMs: Date.now() - startTime,
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
      // 使用关键词集合作为标准化 key 进行比较
      const keyPoints = this.extractKeyPoints(r.content);
      const normalized = [...keyPoints].sort().join('|');
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
   * 计算共识率（关键词重叠率 / Jaccard 相似度）
   *
   * 将每个结果按标点/换行拆分为关键词块集合，
   * 计算所有集合的交集大小 / 并集大小。
   * 0.0 = 完全无共识，1.0 = 完全一致。
   *
   * 为什么不用 embedding 语义相似度：
   * - 需要额外 embedding API 调用（成本 + 延迟）
   * - 不同语言结果难以直接比较
   * - 短文本相似度计算不稳定
   * - 关键词重叠在 80% 场景下已足够实用
   */
  private calculateConsensus(results: ScheduledTaskResult[]): number {
    if (results.length <= 1) return 1.0;

    // 提取每个结果的关键词集合
    const allKeyPoints = results.map((r) => this.extractKeyPoints(r.content));

    // 计算交集 (Jaccard: intersection / union)
    const intersection = allKeyPoints.reduce(
      (acc, set) => new Set([...acc].filter((k) => set.has(k))),
      allKeyPoints[0]
    );
    const union = new Set(allKeyPoints.flatMap((set) => [...set]));

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * 从文本中提取关键词块集合
   * 按标点符号、换行、空格拆分，过滤停用词和短词
   */
  private extractKeyPoints(content: string): Set<string> {
    // 按中英文标点、换行、空格拆分
    const rawTokens = content
      .split(/[，,。.！!？?；;：:\n\r\s]+/)
      .filter(Boolean);

    // 过滤停用词（常见无意义词）和过短的词
    const stopWords = new Set([
      '的',
      '了',
      '是',
      '在',
      '我',
      '有',
      '和',
      '就',
      '不',
      '人',
      '都',
      '一',
      '一个',
      '上',
      '也',
      '很',
      '到',
      '说',
      '要',
      '去',
      '你',
      '会',
      '着',
      '没有',
      '看',
      '好',
      '自己',
      '这',
      '他',
      '她',
      '它',
      '们',
      '那',
      '什么',
      '怎么',
      '如何',
      '为',
      '对',
      '与',
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'shall',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'through',
      'during',
      'before',
      'after',
      'and',
      'or',
      'but',
      'not',
      'no',
      'if',
      'so',
      'than',
      'that',
      'this',
      'these',
      'those',
      'it',
      'its',
      'we',
      'our',
      'you',
      'your',
      'they',
      'them',
      'their',
      'he',
      'him',
      'his',
      'she',
      'her',
    ]);

    const keyPoints = rawTokens
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2 && !stopWords.has(t));

    return new Set(keyPoints);
  }
}
