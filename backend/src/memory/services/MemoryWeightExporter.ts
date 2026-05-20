/**
 * 记忆权重导出器
 * 提供记忆权重/影响力的可解释性输出，展示记忆在决策中的贡献度
 * 对应实施方案 21.2：记忆可解释性（权重输出）
 */

import type {
  MemoryAnalysis,
  SmartRetrievalResult,
} from '../EnhancedMemoryManager.js';

/** 单条记忆的权重条目 */
export interface WeightEntry {
  /** 记忆 ID */
  memoryId: string;
  /** 各项权重 */
  weights: {
    /** 语义相似度权重（0-1） */
    semanticSimilarity: number;
    /** 上下文相关性权重（0-1） */
    contextualRelevance: number;
    /** 时间接近度权重（0-1） */
    temporalProximity: number;
    /** 关联强度权重（0-1） */
    associationStrength: number;
    /** 综合评分（0-1） */
    overallScore: number;
  };
  /** 关键主题 */
  keyTopics: string[];
  /** 情感分析 */
  sentiment: string;
  /** 复杂度 */
  complexity: string;
  /** 贡献度文字描述 */
  contributionDescription: string;
}

/** 权重分布统计 */
export interface WeightDistribution {
  /** 高权重记忆数（>0.7） */
  high: number;
  /** 中等权重记忆数（0.4-0.7） */
  medium: number;
  /** 低权重记忆数（<0.4） */
  low: number;
}

/** 权重报告摘要 */
export interface WeightReportSummary {
  /** 平均语义相似度 */
  averageSimilarity: number;
  /** 平均上下文相关性 */
  averageRelevance: number;
  /** 平均时间接近度 */
  averageProximity: number;
  /** 平均关联强度 */
  averageAssociation: number;
  /** 平均综合评分 */
  averageOverall: number;
  /** 最高贡献记忆 ID */
  topContributorId: string;
  /** 最高评分 */
  topScore: number;
  /** 权重分布 */
  weightDistribution: WeightDistribution;
}

/** 完整权重报告 */
export interface WeightReport {
  /** 生成时间戳 */
  generatedAt: number;
  /** 记忆总数 */
  totalMemories: number;
  /** 检索置信度 */
  confidence: number;
  /** 检索策略 */
  retrievalStrategy: string;
  /** 权重条目列表 */
  entries: WeightEntry[];
  /** 报告摘要 */
  summary: WeightReportSummary;
}

/**
 * 记忆权重导出器
 * 将 MemoryAnalysis 和 SmartRetrievalResult 转换为可解释的权重报告
 */
export class MemoryWeightExporter {
  /**
   * 从 SmartRetrievalResult 导出完整权重报告
   * @param result 智能检索结果
   * @returns 权重报告
   */
  static exportFromRetrieval(result: SmartRetrievalResult): WeightReport {
    const entries = result.analysis.map((a) =>
      MemoryWeightExporter.exportFromAnalysis(a)
    );

    const totalMemories = entries.length;

    const avgSimilarity =
      totalMemories > 0
        ? entries.reduce((s, e) => s + e.weights.semanticSimilarity, 0) /
          totalMemories
        : 0;
    const avgRelevance =
      totalMemories > 0
        ? entries.reduce((s, e) => s + e.weights.contextualRelevance, 0) /
          totalMemories
        : 0;
    const avgProximity =
      totalMemories > 0
        ? entries.reduce((s, e) => s + e.weights.temporalProximity, 0) /
          totalMemories
        : 0;
    const avgAssociation =
      totalMemories > 0
        ? entries.reduce((s, e) => s + e.weights.associationStrength, 0) /
          totalMemories
        : 0;
    const avgOverall =
      totalMemories > 0
        ? entries.reduce((s, e) => s + e.weights.overallScore, 0) /
          totalMemories
        : 0;

    let topContributorId = '';
    let topScore = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;

    for (const entry of entries) {
      if (entry.weights.overallScore > topScore) {
        topScore = entry.weights.overallScore;
        topContributorId = entry.memoryId;
      }
      if (entry.weights.overallScore > 0.7) {
        highCount++;
      } else if (entry.weights.overallScore > 0.4) {
        mediumCount++;
      } else {
        lowCount++;
      }
    }

    return {
      generatedAt: Date.now(),
      totalMemories,
      confidence: result.confidence,
      retrievalStrategy: result.retrievalStrategy,
      entries,
      summary: {
        averageSimilarity: avgSimilarity,
        averageRelevance: avgRelevance,
        averageProximity: avgProximity,
        averageAssociation: avgAssociation,
        averageOverall: avgOverall,
        topContributorId,
        topScore,
        weightDistribution: {
          high: highCount,
          medium: mediumCount,
          low: lowCount,
        },
      },
    };
  }

  /**
   * 从单条 MemoryAnalysis 导出权重条目
   * @param analysis 记忆分析结果
   * @returns 权重条目
   */
  static exportFromAnalysis(analysis: MemoryAnalysis): WeightEntry {
    const contributionParts: string[] = [];

    if (analysis.semanticSimilarity > 0.7) {
      contributionParts.push(
        `语义相似度高(${analysis.semanticSimilarity.toFixed(2)})`
      );
    } else if (analysis.semanticSimilarity > 0.4) {
      contributionParts.push(
        `语义相似度中等(${analysis.semanticSimilarity.toFixed(2)})`
      );
    } else {
      contributionParts.push(
        `语义相似度低(${analysis.semanticSimilarity.toFixed(2)})`
      );
    }

    if (analysis.contextualRelevance > 0.7) {
      contributionParts.push(
        `上下文相关性强(${analysis.contextualRelevance.toFixed(2)})`
      );
    } else if (analysis.contextualRelevance > 0.4) {
      contributionParts.push(
        `上下文相关性中等(${analysis.contextualRelevance.toFixed(2)})`
      );
    } else {
      contributionParts.push(
        `上下文相关性弱(${analysis.contextualRelevance.toFixed(2)})`
      );
    }

    if (analysis.temporalProximity > 0.7) {
      contributionParts.push(
        `时间接近度高(${analysis.temporalProximity.toFixed(2)})`
      );
    } else if (analysis.temporalProximity > 0.4) {
      contributionParts.push(
        `时间接近度中等(${analysis.temporalProximity.toFixed(2)})`
      );
    }
    if (analysis.temporalProximity <= 0.4) {
      contributionParts.push(
        `时间接近度低(${analysis.temporalProximity.toFixed(2)})`
      );
    }

    if (analysis.associationStrength > 0.7) {
      contributionParts.push(
        `关联强度高(${analysis.associationStrength.toFixed(2)})`
      );
    } else if (analysis.associationStrength > 0.4) {
      contributionParts.push(
        `关联强度中等(${analysis.associationStrength.toFixed(2)})`
      );
    }
    if (analysis.associationStrength <= 0.4) {
      contributionParts.push(
        `关联强度低(${analysis.associationStrength.toFixed(2)})`
      );
    }

    let overallDesc: string;
    if (analysis.overallScore > 0.7) {
      overallDesc = '作为核心参考记忆，对决策有重要影响';
    } else if (analysis.overallScore > 0.4) {
      overallDesc = '作为辅助参考记忆，对决策有一定影响';
    } else if (analysis.overallScore > 0.2) {
      overallDesc = '作为背景参考记忆，对决策影响较小';
    } else {
      overallDesc = '与当前决策相关性较低';
    }
    contributionParts.push(overallDesc);

    return {
      memoryId: analysis.memoryId,
      weights: {
        semanticSimilarity: analysis.semanticSimilarity,
        contextualRelevance: analysis.contextualRelevance,
        temporalProximity: analysis.temporalProximity,
        associationStrength: analysis.associationStrength,
        overallScore: analysis.overallScore,
      },
      keyTopics: analysis.keyTopics,
      sentiment: analysis.sentiment,
      complexity: analysis.complexity,
      contributionDescription: contributionParts.join('；'),
    };
  }

  /**
   * 格式化权重报告为人类可读文本
   * @param report 权重报告
   * @returns 格式化的文本
   */
  static formatReport(report: WeightReport): string {
    const lines: string[] = [];

    lines.push('记忆权重可解释性报告');
    lines.push('='.repeat(40));
    lines.push(`生成时间: ${new Date(report.generatedAt).toISOString()}`);
    lines.push(`记忆总数: ${report.totalMemories}`);
    lines.push(`检索置信度: ${(report.confidence * 100).toFixed(1)}%`);
    lines.push(`检索策略: ${report.retrievalStrategy}`);
    lines.push('');

    lines.push('--- 权重分布 ---');
    lines.push(`  高影响 (>0.7): ${report.summary.weightDistribution.high}`);
    lines.push(
      `  中等影响 (0.4-0.7): ${report.summary.weightDistribution.medium}`
    );
    lines.push(`  低影响 (<0.4): ${report.summary.weightDistribution.low}`);
    lines.push('');

    lines.push('--- 摘要统计 ---');
    lines.push(
      `  平均语义相似度: ${(report.summary.averageSimilarity * 100).toFixed(1)}%`
    );
    lines.push(
      `  平均上下文相关性: ${(report.summary.averageRelevance * 100).toFixed(1)}%`
    );
    lines.push(
      `  平均时间接近度: ${(report.summary.averageProximity * 100).toFixed(1)}%`
    );
    lines.push(
      `  平均关联强度: ${(report.summary.averageAssociation * 100).toFixed(1)}%`
    );
    lines.push(
      `  平均综合评分: ${(report.summary.averageOverall * 100).toFixed(1)}%`
    );
    lines.push(
      `  最高贡献记忆: ${report.summary.topContributorId} (${(report.summary.topScore * 100).toFixed(1)}%)`
    );
    lines.push('');

    if (report.entries.length > 0) {
      lines.push('--- 各记忆权重详情 ---');
      for (const entry of report.entries) {
        lines.push('');
        lines.push(`  记忆: ${entry.memoryId}`);
        lines.push(
          `    语义相似度:   ${(entry.weights.semanticSimilarity * 100).toFixed(1)}%`
        );
        lines.push(
          `    上下文相关性: ${(entry.weights.contextualRelevance * 100).toFixed(1)}%`
        );
        lines.push(
          `    时间接近度:   ${(entry.weights.temporalProximity * 100).toFixed(1)}%`
        );
        lines.push(
          `    关联强度:     ${(entry.weights.associationStrength * 100).toFixed(1)}%`
        );
        lines.push(
          `    综合评分:     ${(entry.weights.overallScore * 100).toFixed(1)}%`
        );
        lines.push(`    关键主题:     ${entry.keyTopics.join(', ') || '无'}`);
        lines.push(
          `    情感/复杂度:  ${entry.sentiment} / ${entry.complexity}`
        );
        lines.push(`    贡献说明:     ${entry.contributionDescription}`);
      }
    }

    lines.push('');
    lines.push('='.repeat(40));

    return lines.join('\n');
  }

  /**
   * 格式化权重报告为 JSON 字符串
   * @param report 权重报告
   * @returns 格式化的 JSON 字符串
   */
  static formatReportJson(report: WeightReport): string {
    return JSON.stringify(report, null, 2);
  }
}
