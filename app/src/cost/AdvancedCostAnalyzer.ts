/**
 * 高级成本分析器
 * 提供深度成本分析、趋势识别和异常检测功能
 */

import type { ModelUsage } from './CostTracker';
import { costTracker } from './CostTracker';

/**
 * 成本趋势方向
 */
export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

/**
 * 趋势分析结果
 */
export interface TrendAnalysis {
  direction: TrendDirection;
  rate: number; // 变化率（百分比）
  confidence: number; // 置信度 0-1
  period: string;
}

/**
 * 成本异常检测结果
 */
export interface AnomalyDetection {
  isAnomaly: boolean;
  severity: 'low' | 'medium' | 'high';
  description: string;
  expectedRange: { min: number; max: number };
  actualValue: number;
  timestamp?: Date;
}

/**
 * 成本分布统计
 */
export interface CostDistribution {
  model: string;
  percentage: number;
  costUSD: number;
  tokenUsage: { input: number; output: number };
  requestCount: number;
}

/**
 * 成本效率指标
 */
export interface EfficiencyMetrics {
  costPerToken: number; // 每令牌成本（美元）
  costPerRequest: number; // 每请求成本（美元）
  tokensPerDollar: number; // 每美元令牌数
  cacheHitRate: number; // 缓存命中率
  optimalModel: string; // 最经济的模型
  worstModel: string; // 成本最高的模型
}

/**
 * 高级成本分析器
 */
export class AdvancedCostAnalyzer {
  /** 每次访问时从 CostTracker 实时获取最新成本快照 */
  private get state() {
    return {
      totalCostUSD: costTracker.getTotalCostUSD(),
      totalInputTokens: costTracker.getTotalInputTokens(),
      totalOutputTokens: costTracker.getTotalOutputTokens(),
      totalCacheReadInputTokens: costTracker.getTotalCacheReadInputTokens(),
      totalCacheCreationInputTokens: costTracker.getTotalCacheCreationInputTokens(),
      totalWebSearchRequests: costTracker.getTotalWebSearchRequests(),
      totalReasoningTokens: costTracker.getTotalReasoningTokens(),
      modelUsage: costTracker.getModelUsage(),
    };
  }

  /**
   * 更新状态（无操作，state 为实时 getter）
   */
  updateState(): void {
    // 无需操作，state 每次访问实时获取 CostTracker 最新数据
  }

  /**
   * 分析成本趋势
   */
  analyzeTrend(): TrendAnalysis {
    const modelUsage = this.state.modelUsage;
    const models = Object.keys(modelUsage);

    if (models.length === 0) {
      return {
        direction: 'stable',
        rate: 0,
        confidence: 1,
        period: '当前会话',
      };
    }

    // 计算总令牌数变化（简化实现）
    const totalTokens =
      this.state.totalInputTokens + this.state.totalOutputTokens;

    // 基于成本增长率判断趋势
    const avgCostPerToken = this.state.totalCostUSD / Math.max(1, totalTokens);
    const baselineCostPerToken = 0.00002; // 假设基准成本

    const rate =
      ((avgCostPerToken - baselineCostPerToken) / baselineCostPerToken) * 100;

    let direction: TrendDirection = 'stable';
    if (rate > 10) direction = 'increasing';
    else if (rate < -10) direction = 'decreasing';

    return {
      direction,
      rate: Math.abs(rate),
      confidence: Math.min(0.95, 0.7 + models.length * 0.05),
      period: '当前会话',
    };
  }

  /**
   * 检测成本异常
   */
  detectAnomalies(): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    const modelUsage = this.state.modelUsage;

    // 检测高成本模型
    for (const [model, usage] of Object.entries(modelUsage)) {
      if (usage.costUSD > 10) {
        anomalies.push({
          isAnomaly: true,
          severity: usage.costUSD > 50 ? 'high' : 'medium',
          description: `${model} 成本异常高: ${usage.costUSD.toFixed(2)} USD`,
          expectedRange: { min: 0, max: 10 },
          actualValue: usage.costUSD,
        });
      }
    }

    // 检测令牌使用异常
    const totalTokens =
      this.state.totalInputTokens + this.state.totalOutputTokens;
    if (totalTokens > 1000000) {
      anomalies.push({
        isAnomaly: true,
        severity: 'high',
        description: `令牌使用超过100万: ${totalTokens.toLocaleString()}`,
        expectedRange: { min: 0, max: 1000000 },
        actualValue: totalTokens,
      });
    }

    // 检测缓存使用异常
    const cacheRatio =
      this.state.totalCacheReadInputTokens /
      Math.max(1, this.state.totalInputTokens);
    if (cacheRatio < 0.1 && this.state.totalInputTokens > 1000) {
      anomalies.push({
        isAnomaly: true,
        severity: 'medium',
        description: `缓存命中率低: ${(cacheRatio * 100).toFixed(1)}%`,
        expectedRange: { min: 0.1, max: 1 },
        actualValue: cacheRatio,
      });
    }

    return anomalies;
  }

  /**
   * 获取成本分布
   */
  getCostDistribution(): CostDistribution[] {
    const modelUsage = this.state.modelUsage;
    const totalCost = this.state.totalCostUSD;

    return Object.entries(modelUsage)
      .map(([model, usage]) => ({
        model,
        percentage: totalCost > 0 ? (usage.costUSD / totalCost) * 100 : 0,
        costUSD: usage.costUSD,
        tokenUsage: {
          input: usage.inputTokens,
          output: usage.outputTokens,
        },
        requestCount: 0, // 需要从其他数据源获取
      }))
      .sort((a, b) => b.costUSD - a.costUSD);
  }

  /**
   * 计算效率指标
   */
  calculateEfficiency(): EfficiencyMetrics {
    const modelUsage = this.state.modelUsage;
    const totalTokens =
      this.state.totalInputTokens + this.state.totalOutputTokens;
    const totalRequests = Object.values(modelUsage).reduce(
      (sum, usage) => sum + Math.max(1, Math.floor(usage.inputTokens / 100)),
      0
    );

    // 计算每个模型的成本效率
    let optimalModel = '';
    let worstModel = '';
    let bestEfficiency = Infinity;
    let worstEfficiency = 0;

    for (const [model, usage] of Object.entries(modelUsage)) {
      const modelTokens = usage.inputTokens + usage.outputTokens;
      if (modelTokens > 0) {
        const efficiency = usage.costUSD / modelTokens;
        if (efficiency < bestEfficiency) {
          bestEfficiency = efficiency;
          optimalModel = model;
        }
        if (efficiency > worstEfficiency) {
          worstEfficiency = efficiency;
          worstModel = model;
        }
      }
    }

    const cacheHitRate =
      this.state.totalInputTokens > 0
        ? this.state.totalCacheReadInputTokens / this.state.totalInputTokens
        : 0;

    return {
      costPerToken: totalTokens > 0 ? this.state.totalCostUSD / totalTokens : 0,
      costPerRequest:
        totalRequests > 0 ? this.state.totalCostUSD / totalRequests : 0,
      tokensPerDollar:
        this.state.totalCostUSD > 0 ? totalTokens / this.state.totalCostUSD : 0,
      cacheHitRate,
      optimalModel: optimalModel || 'N/A',
      worstModel: worstModel || 'N/A',
    };
  }

  /**
   * 获取成本分析报告
   */
  generateAnalysisReport(): string {
    const trend = this.analyzeTrend();
    const anomalies = this.detectAnomalies();
    const distribution = this.getCostDistribution();
    const efficiency = this.calculateEfficiency();

    let report = '\n========================================\n';
    report += '          高级成本分析报告\n';
    report += '========================================\n\n';

    // 趋势分析
    report += '【趋势分析】\n';
    report += `  趋势方向: ${this.getTrendLabel(trend.direction)}\n`;
    report += `  变化率: ${trend.rate.toFixed(2)}%\n`;
    report += `  置信度: ${(trend.confidence * 100).toFixed(0)}%\n\n`;

    // 效率指标
    report += '【效率指标】\n';
    report += `  每令牌成本: $${efficiency.costPerToken.toExponential(6)}\n`;
    report += `  每请求成本: $${efficiency.costPerRequest.toFixed(4)}\n`;
    report += `  每美元令牌数: ${efficiency.tokensPerDollar.toLocaleString()}\n`;
    report += `  缓存命中率: ${(efficiency.cacheHitRate * 100).toFixed(1)}%\n`;
    report += `  最经济模型: ${efficiency.optimalModel}\n`;
    report += `  成本最高模型: ${efficiency.worstModel}\n\n`;

    // 成本分布
    report += '【成本分布】\n';
    for (const item of distribution) {
      report += `  ${item.model}: $${item.costUSD.toFixed(2)} (${item.percentage.toFixed(1)}%)\n`;
    }

    // 异常检测
    if (anomalies.length > 0) {
      report += '\n【异常检测】\n';
      for (const anomaly of anomalies) {
        report += `  ⚠️ ${this.getSeverityLabel(anomaly.severity)}: ${anomaly.description}\n`;
      }
    }

    report += '\n========================================\n';

    return report;
  }

  private getTrendLabel(direction: TrendDirection): string {
    switch (direction) {
      case 'increasing':
        return '📈 上升';
      case 'decreasing':
        return '📉 下降';
      case 'stable':
        return '➡️ 稳定';
    }
  }

  private getSeverityLabel(severity: AnomalyDetection['severity']): string {
    switch (severity) {
      case 'high':
        return '严重';
      case 'medium':
        return '警告';
      case 'low':
        return '信息';
    }
  }

  /**
   * 获取节省建议
   */
  getSavingsRecommendations(): string[] {
    const recommendations: string[] = [];
    const efficiency = this.calculateEfficiency();
    const anomalies = this.detectAnomalies();

    // 基于缓存命中率的建议
    if (efficiency.cacheHitRate < 0.2) {
      recommendations.push('💡 建议增加缓存使用，当前缓存命中率较低');
    }

    // 基于模型效率的建议
    if (
      efficiency.optimalModel &&
      efficiency.worstModel &&
      efficiency.optimalModel !== efficiency.worstModel
    ) {
      recommendations.push(
        `💡 考虑将 ${efficiency.worstModel} 替换为 ${efficiency.optimalModel}，可降低成本`
      );
    }

    // 基于异常检测的建议
    const highCostAnomaly = anomalies.find((a) => a.severity === 'high');
    if (highCostAnomaly) {
      recommendations.push('🚨 当前存在高成本异常，请检查相关模型使用');
    }

    // 默认建议
    if (recommendations.length === 0) {
      recommendations.push('✅ 当前成本使用正常，继续保持');
    }

    return recommendations;
  }
}

/**
 * 全局高级成本分析器实例
 */
export const advancedCostAnalyzer = new AdvancedCostAnalyzer();

/**
 * 获取成本分析报告
 */
export function getCostAnalysisReport(): string {
  advancedCostAnalyzer.updateState();
  return advancedCostAnalyzer.generateAnalysisReport();
}

/**
 * 获取成本趋势分析
 */
export function analyzeCostTrend(): TrendAnalysis {
  advancedCostAnalyzer.updateState();
  return advancedCostAnalyzer.analyzeTrend();
}

/**
 * 检测成本异常
 */
export function detectCostAnomalies(): AnomalyDetection[] {
  advancedCostAnalyzer.updateState();
  return advancedCostAnalyzer.detectAnomalies();
}

/**
 * 获取成本分布
 */
export function getCostDistribution(): CostDistribution[] {
  advancedCostAnalyzer.updateState();
  return advancedCostAnalyzer.getCostDistribution();
}

/**
 * 获取效率指标
 */
export function calculateCostEfficiency(): EfficiencyMetrics {
  advancedCostAnalyzer.updateState();
  return advancedCostAnalyzer.calculateEfficiency();
}

/**
 * 获取节省建议
 */
export function getSavingsRecommendations(): string[] {
  advancedCostAnalyzer.updateState();
  return advancedCostAnalyzer.getSavingsRecommendations();
}
