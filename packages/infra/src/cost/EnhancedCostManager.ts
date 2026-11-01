//
/**
 * 增强成本管理器
 * 提供高级成本分析、预测和优化建议功能
 */

import type {
  CostData,
  CostAnalysis,
  CostRecord,
  CostCategory,
  CostPeriod,
} from './types.js';

import { CostTracker } from './CostTracker.js';
import { CostReporter } from './CostReporter.js';
import { CostMonitor } from './CostMonitor.js';
import { PricingManager } from './PricingManager.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('cost:enhancedCostManager');

export interface EnhancedCostManagerConfig {
  enableAdvancedAnalysis: boolean;
  enableCostPrediction: boolean;
  enableOptimizationSuggestions: boolean;
  predictionHorizon: number; // 预测周期（天）
  analysisWindow: number; // 分析窗口（天）
  optimizationThreshold: number; // 优化阈值（百分比）
}

export interface CostPrediction {
  predictionId: string;
  predictedCost: number;
  confidence: number;
  predictionDate: Date;
  trendDirection: 'increasing' | 'decreasing' | 'stable';
  riskFactors: string[];
  optimizationOpportunities: string[];
}

export interface CostOptimization {
  optimizationId: string;
  category: CostCategory;
  currentCost: number;
  potentialSavings: number;
  savingsPercentage: number;
  recommendations: string[];
  implementationEffort: 'low' | 'medium' | 'high';
  estimatedTimeframe: string;
}

export interface CostTrendAnalysis {
  period: CostPeriod;
  totalCost: number;
  costByCategory: Record<CostCategory, number>;
  costTrend: 'increasing' | 'decreasing' | 'stable';
  trendStrength: number;
  anomalyDetections: string[];
  seasonalPatterns: string[];
}

export class EnhancedCostManager {
  private config: EnhancedCostManagerConfig;
  private costTracker: CostTracker;
  private costReporter: CostReporter;
  private costMonitor: CostMonitor;
  private pricingManager: PricingManager;
  private costHistory: CostData[] = [];

  constructor(config?: Partial<EnhancedCostManagerConfig>) {
    this.config = {
      enableAdvancedAnalysis: true,
      enableCostPrediction: true,
      enableOptimizationSuggestions: true,
      predictionHorizon: 30, // 30天预测
      analysisWindow: 90, // 90天分析窗口
      optimizationThreshold: 10, // 10%优化阈值
      ...config,
    };

    this.costTracker = new CostTracker();
    this.costReporter = new CostReporter();
    this.costMonitor = new CostMonitor();
    this.pricingManager = new PricingManager();
  }

  /**
   * 增强的成本分析方法
   */
  async analyzeCostsEnhanced(period: CostPeriod): Promise<{
    basicAnalysis: CostAnalysis;
    trendAnalysis: CostTrendAnalysis;
    predictions: CostPrediction[];
    optimizations: CostOptimization[];
  }> {
    // 获取基础成本数据
    const costData = await (
      this.costTracker as unknown as {
        getCostData(period: CostPeriod): Promise<CostData[]>;
      }
    ).getCostData(period);
    this.addToHistory(costData);

    // 基础分析
    const basicAnalysis = (await (
      this.costReporter as unknown as {
        generateReport(period: CostPeriod): Promise<CostAnalysis>;
      }
    ).generateReport(period)) as unknown as CostAnalysis;

    // 高级分析
    const trendAnalysis = this.analyzeTrends(period);

    // 预测
    const predictions = this.config.enableCostPrediction
      ? await this.predictCosts(period)
      : [];

    // 优化建议
    const optimizations = this.config.enableOptimizationSuggestions
      ? await this.identifyOptimizations(basicAnalysis)
      : [];

    return {
      basicAnalysis,
      trendAnalysis,
      predictions,
      optimizations,
    };
  }

  /**
   * 成本趋势分析
   */
  private analyzeTrends(period: CostPeriod): CostTrendAnalysis {
    const historicalData = this.getHistoricalData(period);

    const trendAnalysis: CostTrendAnalysis = {
      period,
      totalCost: this.calculateTotalCost(historicalData),
      costByCategory: this.calculateCostByCategory(historicalData),
      costTrend: 'stable',
      trendStrength: 0,
      anomalyDetections: [],
      seasonalPatterns: [],
    };

    // 计算趋势
    this.calculateTrend(trendAnalysis, historicalData);

    // 检测异常
    trendAnalysis.anomalyDetections = this.detectAnomalies(historicalData);

    // 识别季节性模式
    trendAnalysis.seasonalPatterns =
      this.identifySeasonalPatterns(historicalData);

    return trendAnalysis;
  }

  /**
   * 成本预测
   */
  private async predictCosts(period: CostPeriod): Promise<CostPrediction[]> {
    const predictions: CostPrediction[] = [];
    const historicalData = this.getHistoricalData(period);

    if (historicalData.length === 0) {
      return predictions;
    }

    // 按类别预测
    const categories = this.getUniqueCategories(historicalData);

    for (const category of categories) {
      const categoryData = historicalData.filter(
        (data) => data.category === category
      );

      if (categoryData.length >= 7) {
        // 至少7天数据
        const prediction = await this.predictCategoryCost(
          category,
          categoryData
        );
        if (prediction) {
          predictions.push(prediction);
        }
      }
    }

    return predictions;
  }

  /**
   * 按类别预测成本
   */
  private async predictCategoryCost(
    category: CostCategory,
    data: CostData[]
  ): Promise<CostPrediction | null> {
    try {
      // 简化实现：基于历史数据的线性趋势预测
      const trend = this.calculateLinearTrend(data);
      const lastCost = data[data.length - 1].amount;

      const predictedCost =
        lastCost + trend.slope * this.config.predictionHorizon;
      const confidence = this.calculatePredictionConfidence(data, trend);

      return {
        predictionId: `pred-${category}-${Date.now()}`,
        predictedCost,
        confidence,
        predictionDate: new Date(
          Date.now() + this.config.predictionHorizon * 24 * 60 * 60 * 1000
        ),
        trendDirection:
          trend.slope > 0
            ? 'increasing'
            : trend.slope < 0
              ? 'decreasing'
              : 'stable',
        riskFactors: this.identifyRiskFactors(category, data),
        optimizationOpportunities: this.identifyOptimizationOpportunities(
          category,
          data
        ),
      };
    } catch (error) {
      await handleError(error, {
        module: 'cost:enhanced',
        action: 'predict_category',
      });
      return null;
    }
  }

  /**
   * 识别优化机会
   */
  private async identifyOptimizations(
    analysis: CostAnalysis
  ): Promise<CostOptimization[]> {
    const optimizations: CostOptimization[] = [];

    // 分析每个类别的优化潜力
    for (const [category, cost] of Object.entries(
      analysis.costByCategory || {}
    )) {
      const optimization = await this.analyzeCategoryOptimization(
        category as CostCategory,
        cost as number
      );

      if (
        optimization &&
        optimization.savingsPercentage >= this.config.optimizationThreshold
      ) {
        optimizations.push(optimization);
      }
    }

    return optimizations.sort(
      (a, b) => b.savingsPercentage - a.savingsPercentage
    );
  }

  /**
   * 分析类别优化潜力
   */
  private async analyzeCategoryOptimization(
    category: CostCategory,
    currentCost: number
  ): Promise<CostOptimization | null> {
    if (currentCost <= 0) return null;

    // 基于类别和成本的简化优化分析
    const potentialSavings = this.calculatePotentialSavings(
      category,
      currentCost
    );
    const savingsPercentage = (potentialSavings / currentCost) * 100;

    if (savingsPercentage < 1) return null; // 忽略小于1%的优化

    return {
      optimizationId: `opt-${category}-${Date.now()}`,
      category,
      currentCost,
      potentialSavings,
      savingsPercentage,
      recommendations: this.generateRecommendations(category, currentCost),
      implementationEffort: this.estimateImplementationEffort(category),
      estimatedTimeframe: this.estimateTimeframe(category),
    };
  }

  /**
   * 计算潜在节省
   */
  private calculatePotentialSavings(
    category: CostCategory,
    currentCost: number
  ): number {
    // 基于类别的简化节省计算
    const savingsRates: Partial<Record<CostCategory, number>> = {
      compute: 0.15, // 计算资源通常有15%优化空间
      storage: 0.2, // 存储资源通常有20%优化空间
      network: 0.1, // 网络资源通常有10%优化空间
      ai: 0.25, // AI资源通常有25%优化空间
      other: 0.05, // 其他资源通常有5%优化空间
    };

    return currentCost * (savingsRates[category] || 0.05);
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(
    category: CostCategory,
    currentCost: number
  ): string[] {
    const recommendations: string[] = [];

    switch (category) {
      case 'compute':
        recommendations.push('优化实例类型选择');
        recommendations.push('实施自动缩放策略');
        recommendations.push('使用预留实例节省成本');
        break;
      case 'storage':
        recommendations.push('实施数据生命周期管理');
        recommendations.push('使用冷存储归档不常用数据');
        recommendations.push('优化存储类型选择');
        break;
      case 'network':
        recommendations.push('优化数据传输策略');
        recommendations.push('使用CDN减少带宽成本');
        recommendations.push('实施流量压缩');
        break;
      case 'ai':
        recommendations.push('优化模型推理配置');
        recommendations.push('使用批处理减少API调用');
        recommendations.push('实施缓存策略');
        break;
      default:
        recommendations.push('审查资源使用情况');
        recommendations.push('优化资源配置');
    }

    return recommendations;
  }

  /**
   * 估算实施难度
   */
  private estimateImplementationEffort(
    category: CostCategory
  ): 'low' | 'medium' | 'high' {
    const effortMap: Partial<Record<CostCategory, 'low' | 'medium' | 'high'>> =
      {
        compute: 'medium',
        storage: 'low',
        network: 'high',
        ai: 'medium',
        other: 'low',
      };

    return effortMap[category] || 'medium';
  }

  /**
   * 估算时间框架
   */
  private estimateTimeframe(category: CostCategory): string {
    const timeframeMap: Partial<Record<CostCategory, string>> = {
      compute: '2-4周',
      storage: '1-2周',
      network: '4-8周',
      ai: '2-6周',
      other: '1-3周',
    };

    return timeframeMap[category] || '2-4周';
  }

  /**
   * 计算线性趋势
   */
  private calculateLinearTrend(data: CostData[]): {
    slope: number;
    intercept: number;
  } {
    const n = data.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    data.forEach((point, index) => {
      const x = index;
      const y = point.amount;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  /**
   * 计算预测置信度
   */
  private calculatePredictionConfidence(
    data: CostData[],
    trend: { slope: number; intercept: number }
  ): number {
    // 基于数据点数量和趋势稳定性的简化置信度计算
    const n = data.length;
    const variance = this.calculateVariance(data, trend);

    // 数据点越多，方差越小，置信度越高
    const baseConfidence = Math.min(0.95, 0.7 + (n / 30) * 0.25);
    const variancePenalty = Math.max(0, variance / 1000) * 0.1;

    return Math.max(0.5, baseConfidence - variancePenalty);
  }

  /**
   * 计算方差
   */
  private calculateVariance(
    data: CostData[],
    trend: { slope: number; intercept: number }
  ): number {
    let sumSquaredErrors = 0;

    data.forEach((point, index) => {
      const predicted = trend.intercept + trend.slope * index;
      const error = point.amount - predicted;
      sumSquaredErrors += error * error;
    });

    return sumSquaredErrors / data.length;
  }

  /**
   * 识别风险因素
   */
  private identifyRiskFactors(
    category: CostCategory,
    data: CostData[]
  ): string[] {
    const factors: string[] = [];

    // 基于数据特征识别风险
    if (data.length > 0) {
      const lastCost = data[data.length - 1].amount;
      const avgCost = this.calculateAverageCost(data);

      if (lastCost > avgCost * 1.5) {
        factors.push('近期成本显著上升');
      }

      if (
        this.calculateVariance(data, this.calculateLinearTrend(data)) > 1000
      ) {
        factors.push('成本波动较大');
      }
    }

    // 基于类别的特定风险
    switch (category) {
      case 'compute':
        factors.push('实例使用率可能不足');
        break;
      case 'storage':
        factors.push('存储生命周期管理可能不完善');
        break;
      case 'network':
        factors.push('数据传输模式可能不稳定');
        break;
    }

    return factors;
  }

  /**
   * 识别优化机会
   */
  private identifyOptimizationOpportunities(
    category: CostCategory,
    data: CostData[]
  ): string[] {
    const opportunities: string[] = [];

    switch (category) {
      case 'compute':
        opportunities.push('考虑使用spot实例');
        opportunities.push('优化实例大小配置');
        break;
      case 'storage':
        opportunities.push('实施数据压缩');
        opportunities.push('使用分层存储');
        break;
      case 'network':
        opportunities.push('优化CDN配置');
        opportunities.push('实施数据压缩传输');
        break;
      case 'ai':
        opportunities.push('优化模型批处理');
        opportunities.push('使用更高效的模型');
        break;
    }

    return opportunities;
  }

  /**
   * 计算总成本
   */
  private calculateTotalCost(data: CostData[]): number {
    return data.reduce((sum, item) => sum + item.amount, 0);
  }

  /**
   * 按类别计算成本
   */
  private calculateCostByCategory(
    data: CostData[]
  ): Record<CostCategory, number> {
    const result: Partial<Record<CostCategory, number>> = {};

    data.forEach((item) => {
      const cat = item.category as CostCategory;
      result[cat] = (result[cat] || 0) + item.amount;
    });

    return result as Record<CostCategory, number>;
  }

  /**
   * 计算趋势
   */
  private calculateTrend(analysis: CostTrendAnalysis, data: CostData[]): void {
    if (data.length < 2) return;

    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));

    const firstCost = this.calculateTotalCost(firstHalf);
    const secondCost = this.calculateTotalCost(secondHalf);

    const avgFirst = firstCost / firstHalf.length;
    const avgSecond = secondCost / secondHalf.length;

    if (avgSecond > avgFirst * 1.1) {
      analysis.costTrend = 'increasing';
      analysis.trendStrength = (avgSecond - avgFirst) / avgFirst;
    } else if (avgSecond < avgFirst * 0.9) {
      analysis.costTrend = 'decreasing';
      analysis.trendStrength = (avgFirst - avgSecond) / avgFirst;
    } else {
      analysis.costTrend = 'stable';
      analysis.trendStrength = 0;
    }
  }

  /**
   * 检测异常
   */
  private detectAnomalies(data: CostData[]): string[] {
    const anomalies: string[] = [];

    if (data.length >= 3) {
      const amounts = data.map((d) => d.amount);
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const std = Math.sqrt(
        amounts.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / amounts.length
      );

      data.forEach((item, index) => {
        if (Math.abs(item.amount - avg) > 2 * std) {
          anomalies.push(`第${index + 1}天成本异常: ${item.amount}`);
        }
      });
    }

    return anomalies;
  }

  /**
   * 识别季节性模式
   */
  private identifySeasonalPatterns(data: CostData[]): string[] {
    const patterns: string[] = [];

    // 简化实现：检测周末模式
    if (data.length >= 7) {
      const weekdayCosts: number[] = [];
      const weekendCosts: number[] = [];

      data.forEach((item, index) => {
        const dayOfWeek = new Date(item.timestamp).getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          weekendCosts.push(item.amount);
        } else {
          weekdayCosts.push(item.amount);
        }
      });

      if (weekendCosts.length > 0 && weekdayCosts.length > 0) {
        const avgWeekday =
          weekdayCosts.reduce((a, b) => a + b, 0) / weekdayCosts.length;
        const avgWeekend =
          weekendCosts.reduce((a, b) => a + b, 0) / weekendCosts.length;

        if (Math.abs(avgWeekday - avgWeekend) / avgWeekday > 0.2) {
          patterns.push('检测到周末/工作日成本差异模式');
        }
      }
    }

    return patterns;
  }

  /**
   * 获取历史数据
   */
  private getHistoricalData(period: CostPeriod): CostData[] {
    const endDate = Date.now();
    const startDate =
      endDate - this.config.analysisWindow * 24 * 60 * 60 * 1000;

    return this.costHistory.filter((data) => {
      return data.timestamp >= startDate && data.timestamp <= endDate;
    });
  }

  /**
   * 获取唯一类别
   */
  private getUniqueCategories(data: CostData[]): CostCategory[] {
    return [...new Set(data.map((item) => item.category as CostCategory))];
  }

  /**
   * 计算平均成本
   */
  private calculateAverageCost(data: CostData[]): number {
    if (data.length === 0) return 0;
    return this.calculateTotalCost(data) / data.length;
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(data: CostData[]): void {
    this.costHistory.push(...data);

    // 限制历史记录大小（保留最近1年的数据）
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    this.costHistory = this.costHistory.filter(
      (item) => item.timestamp >= oneYearAgo
    );
  }

  /**
   * 获取配置
   */
  getConfig(): EnhancedCostManagerConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<EnhancedCostManagerConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.costHistory = [];
  }
}
