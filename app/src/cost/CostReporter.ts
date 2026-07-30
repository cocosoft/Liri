/**
 * 成本报告生成器
 * 提供更丰富的成本报告格式和分析功能
 */

import { logForDebugging } from '../utils/debug.js';
import { formatCost } from './ModelPricing.js';
import { ModelUsage } from './CostTracker.js';
import { canViewBillingCosts } from './BillingAccessControl.js';

/**
 * 成本趋势数据
 */
export interface CostTrend {
  /** 时间戳 */
  timestamp: number;
  /** 成本 */
  cost: number;
  /** 输入令牌数 */
  inputTokens: number;
  /** 输出令牌数 */
  outputTokens: number;
}

/**
 * 成本预测结果
 */
export interface CostPrediction {
  /** 预测成本 */
  predictedCost: number;
  /** 置信区间 */
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  /** 预测方法 */
  method: string;
}

/**
 * 成本报告选项
 */
export interface CostReportOptions {
  /** 是否包含趋势分析 */
  includeTrendAnalysis: boolean;
  /** 是否包含预测 */
  includePrediction: boolean;
  /** 是否包含模型详情 */
  includeModelDetails: boolean;
  /** 报告格式 */
  format: 'text' | 'json' | 'csv';
}

/**
 * 成本报告生成器
 */
export class CostReporter {
  private costTrends: CostTrend[] = [];
  private maxTrendSize: number = 1000;

  /**
   * 添加成本趋势数据
   */
  addCostTrend(trend: CostTrend): void {
    this.costTrends.push(trend);
    if (this.costTrends.length > this.maxTrendSize) {
      this.costTrends = this.costTrends.slice(-this.maxTrendSize);
    }
  }

  /**
   * 获取成本趋势数据
   */
  getCostTrends(): CostTrend[] {
    return [...this.costTrends];
  }

  /**
   * 分析成本趋势
   */
  analyzeTrend(): {
    averageCost: number;
    growthRate: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  } {
    if (this.costTrends.length < 2) {
      return {
        averageCost: 0,
        growthRate: 0,
        trend: 'stable',
      };
    }

    const recentTrends = this.costTrends.slice(-30); // 最近30个数据点
    const totalCost = recentTrends.reduce((sum, trend) => sum + trend.cost, 0);
    const averageCost = totalCost / recentTrends.length;

    const firstCost = recentTrends[0].cost;
    const lastCost = recentTrends[recentTrends.length - 1].cost;
    const growthRate = ((lastCost - firstCost) / firstCost) * 100;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (growthRate > 5) {
      trend = 'increasing';
    } else if (growthRate < -5) {
      trend = 'decreasing';
    } else {
      trend = 'stable';
    }

    return {
      averageCost,
      growthRate,
      trend,
    };
  }

  /**
   * 预测成本
   */
  predictCost(periods: number = 1): CostPrediction {
    const trends = this.costTrends.slice(-30); // 使用最近30个数据点
    if (trends.length < 5) {
      return {
        predictedCost: 0,
        confidenceInterval: { lower: 0, upper: 0 },
        method: 'insufficient_data',
      };
    }

    // 使用线性回归预测
    const n = trends.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += trends[i].cost;
      sumXY += i * trends[i].cost;
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const predictedCost = slope * (n + periods - 1) + intercept;

    // 计算置信区间
    const residuals = trends.map(
      (trend, i) => trend.cost - (slope * i + intercept)
    );
    const variance = residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2);
    const stdError = Math.sqrt(variance);
    const margin = 1.96 * stdError; // 95% 置信区间

    return {
      predictedCost: Math.max(0, predictedCost),
      confidenceInterval: {
        lower: Math.max(0, predictedCost - margin),
        upper: predictedCost + margin,
      },
      method: 'linear_regression',
    };
  }

  /**
   * 生成成本报告
   */
  generateReport(
    totalCost: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    totalCacheReadTokens: number,
    totalCacheCreationTokens: number,
    totalWebSearchRequests: number,
    modelUsage: Record<string, ModelUsage>,
    options: Partial<CostReportOptions> = {}
  ): string {
    // 检查访问权限 - 使用默认用户ID进行权限检查
    const defaultUserId = 'system';
    if (!canViewBillingCosts(defaultUserId)) {
      return '无权访问成本报告';
    }

    const opts: CostReportOptions = {
      includeTrendAnalysis: options.includeTrendAnalysis ?? true,
      includePrediction: options.includePrediction ?? true,
      includeModelDetails: options.includeModelDetails ?? true,
      format: options.format ?? 'text',
    };

    if (opts.format === 'json') {
      return this.generateJsonReport(
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        totalWebSearchRequests,
        modelUsage,
        opts
      );
    }

    if (opts.format === 'csv') {
      return this.generateCsvReport(
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        totalWebSearchRequests,
        modelUsage,
        opts
      );
    }

    return this.generateTextReport(
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      totalWebSearchRequests,
      modelUsage,
      opts
    );
  }

  /**
   * 生成文本格式的成本报告
   */
  private generateTextReport(
    totalCost: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    totalCacheReadTokens: number,
    totalCacheCreationTokens: number,
    totalWebSearchRequests: number,
    modelUsage: Record<string, ModelUsage>,
    options: CostReportOptions
  ): string {
    let report = '\n==========================================\n';
    report += '            成本报告\n';
    report += '==========================================\n';
    report += `总成本: ${formatCost(totalCost)}\n`;
    report += `总输入令牌: ${totalInputTokens.toLocaleString()}\n`;
    report += `总输出令牌: ${totalOutputTokens.toLocaleString()}\n`;
    report += `总缓存读取令牌: ${totalCacheReadTokens.toLocaleString()}\n`;
    report += `总缓存创建令牌: ${totalCacheCreationTokens.toLocaleString()}\n`;
    report += `总网络搜索请求: ${totalWebSearchRequests.toLocaleString()}\n`;

    // 趋势分析
    if (options.includeTrendAnalysis && this.costTrends.length >= 2) {
      const trendAnalysis = this.analyzeTrend();
      report += '\n趋势分析:\n';
      report += `  平均成本: ${formatCost(trendAnalysis.averageCost)}\n`;
      report += `  增长率: ${trendAnalysis.growthRate.toFixed(2)}%\n`;
      report += `  趋势: ${this.getTrendDescription(trendAnalysis.trend)}\n`;
    }

    // 成本预测
    if (options.includePrediction && this.costTrends.length >= 5) {
      const prediction = this.predictCost();
      report += '\n成本预测:\n';
      report += `  预测成本: ${formatCost(prediction.predictedCost)}\n`;
      report += `  置信区间: ${formatCost(prediction.confidenceInterval.lower)} - ${formatCost(prediction.confidenceInterval.upper)}\n`;
      report += `  预测方法: ${prediction.method}\n`;
    }

    // 模型详情
    if (options.includeModelDetails && Object.keys(modelUsage).length > 0) {
      report += '\n模型使用详情:\n';
      for (const [modelName, usage] of Object.entries(modelUsage)) {
        report += `\n${modelName}:\n`;
        report += `  输入令牌: ${usage.inputTokens.toLocaleString()}\n`;
        report += `  输出令牌: ${usage.outputTokens.toLocaleString()}\n`;
        report += `  缓存读取令牌: ${usage.cacheReadInputTokens.toLocaleString()}\n`;
        report += `  缓存创建令牌: ${usage.cacheCreationInputTokens.toLocaleString()}\n`;
        report += `  网络搜索请求: ${usage.webSearchRequests.toLocaleString()}\n`;
        report += `  成本: ${formatCost(usage.costUSD)}\n`;
        if (usage.isFastMode) {
          report += `  模式: 快速模式\n`;
        }
      }
    }

    report += '==========================================\n';

    return report;
  }

  /**
   * 生成JSON格式的成本报告
   */
  private generateJsonReport(
    totalCost: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    totalCacheReadTokens: number,
    totalCacheCreationTokens: number,
    totalWebSearchRequests: number,
    modelUsage: Record<string, ModelUsage>,
    options: CostReportOptions
  ): string {
    const report: Record<string, unknown> = {
      timestamp: Date.now(),
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      totalWebSearchRequests,
    };

    if (options.includeTrendAnalysis && this.costTrends.length >= 2) {
      report.trendAnalysis = this.analyzeTrend();
    }

    if (options.includePrediction && this.costTrends.length >= 5) {
      report.prediction = this.predictCost();
    }

    if (options.includeModelDetails) {
      report.modelUsage = modelUsage;
    }

    return JSON.stringify(report, null, 2);
  }

  /**
   * 生成CSV格式的成本报告
   */
  private generateCsvReport(
    totalCost: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    totalCacheReadTokens: number,
    totalCacheCreationTokens: number,
    totalWebSearchRequests: number,
    modelUsage: Record<string, ModelUsage>,
    options: CostReportOptions
  ): string {
    let csv = 'metric,value\n';
    csv += `totalCost,${totalCost}\n`;
    csv += `totalInputTokens,${totalInputTokens}\n`;
    csv += `totalOutputTokens,${totalOutputTokens}\n`;
    csv += `totalCacheReadTokens,${totalCacheReadTokens}\n`;
    csv += `totalCacheCreationTokens,${totalCacheCreationTokens}\n`;
    csv += `totalWebSearchRequests,${totalWebSearchRequests}\n`;

    if (options.includeModelDetails) {
      csv +=
        '\nmodel,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,webSearchRequests,costUSD\n';
      for (const [modelName, usage] of Object.entries(modelUsage)) {
        csv += `${modelName},${usage.inputTokens},${usage.outputTokens},${usage.cacheReadInputTokens},${usage.cacheCreationInputTokens},${usage.webSearchRequests},${usage.costUSD}\n`;
      }
    }

    return csv;
  }

  /**
   * 获取趋势描述
   */
  private getTrendDescription(
    trend: 'increasing' | 'decreasing' | 'stable'
  ): string {
    switch (trend) {
      case 'increasing':
        return '上升';
      case 'decreasing':
        return '下降';
      case 'stable':
        return '稳定';
    }
  }

  /**
   * 清空成本趋势数据
   */
  clearTrends(): void {
    this.costTrends = [];
    logForDebugging('成本趋势数据已清空');
  }
}

/**
 * 全局成本报告生成器实例
 */
export const costReporter = new CostReporter();

/**
 * 添加成本趋势数据
 */
export function addCostTrend(trend: CostTrend): void {
  costReporter.addCostTrend(trend);
}

/**
 * 获取成本趋势数据
 */
export function getCostTrends(): CostTrend[] {
  return costReporter.getCostTrends();
}

/**
 * 分析成本趋势
 */
export function analyzeCostTrend(): {
  averageCost: number;
  growthRate: number;
  trend: 'increasing' | 'decreasing' | 'stable';
} {
  return costReporter.analyzeTrend();
}

/**
 * 预测成本
 */
export function predictCost(periods: number = 1): CostPrediction {
  return costReporter.predictCost(periods);
}

/**
 * 生成成本报告
 */
export function generateCostReport(
  totalCost: number,
  totalInputTokens: number,
  totalOutputTokens: number,
  totalCacheReadTokens: number,
  totalCacheCreationTokens: number,
  totalWebSearchRequests: number,
  modelUsage: Record<string, ModelUsage>,
  options?: Partial<CostReportOptions>
): string {
  return costReporter.generateReport(
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    totalWebSearchRequests,
    modelUsage,
    options
  );
}
