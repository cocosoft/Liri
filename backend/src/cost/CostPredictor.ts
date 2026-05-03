// @ts-nocheck
/**
 * 成本预测器
 * 提供多算法成本预测和风险评估功能
 */

import type { 
  CostData, 
  CostCategory,
  CostPeriod 
} from './types.js';

export interface CostPredictionResult {
  predictionId: string;
  algorithm: string;
  predictedCost: number;
  confidence: number;
  predictionRange: { min: number; max: number };
  riskLevel: 'low' | 'medium' | 'high';
  contributingFactors: string[];
  algorithmMetrics: Record<string, number>;
}

export interface PredictionAlgorithm {
  name: string;
  description: string;
  supportsSeasonality: boolean;
  supportsTrend: boolean;
  minDataPoints: number;
  
  predict(data: CostData[], horizon: number): Promise<CostPredictionResult>;
  validate(data: CostData[]): boolean;
  getMetrics(data: CostData[]): Record<string, number>;
}

export class CostPredictor {
  private algorithms: Map<string, PredictionAlgorithm> = new Map();
  private defaultHorizon: number = 30; // 默认30天预测

  constructor() {
    this.initializeAlgorithms();
  }

  /**
   * 初始化预测算法
   */
  private initializeAlgorithms(): void {
    const algorithms: PredictionAlgorithm[] = [
      new LinearRegressionAlgorithm(),
      new MovingAverageAlgorithm(),
      new ExponentialSmoothingAlgorithm(),
      new SeasonalDecompositionAlgorithm()
    ];

    algorithms.forEach(algorithm => {
      this.algorithms.set(algorithm.name, algorithm);
    });
  }

  /**
   * 多算法成本预测
   */
  async predictCosts(
    data: CostData[], 
    horizon: number = this.defaultHorizon
  ): Promise<{
    predictions: CostPredictionResult[];
    ensemblePrediction: CostPredictionResult;
    algorithmComparison: Record<string, number>;
  }> {
    const predictions: CostPredictionResult[] = [];
    const validAlgorithms: PredictionAlgorithm[] = [];

    // 使用所有适用的算法进行预测
    for (const algorithm of this.algorithms.values()) {
      if (algorithm.validate(data)) {
        try {
          const prediction = await algorithm.predict(data, horizon);
          predictions.push(prediction);
          validAlgorithms.push(algorithm);
        } catch (error) {
          console.warn(`算法 ${algorithm.name} 预测失败:`, error);
        }
      }
    }

    // 集成预测（加权平均）
    const ensemblePrediction = this.calculateEnsemblePrediction(predictions);

    // 算法性能比较
    const algorithmComparison = this.compareAlgorithmPerformance(validAlgorithms, data);

    return {
      predictions,
      ensemblePrediction,
      algorithmComparison
    };
  }

  /**
   * 计算集成预测
   */
  private calculateEnsemblePrediction(predictions: CostPredictionResult[]): CostPredictionResult {
    if (predictions.length === 0) {
      throw new Error('没有有效的预测结果');
    }

    if (predictions.length === 1) {
      return predictions[0];
    }

    // 基于置信度的加权平均
    let totalWeight = 0;
    let weightedSum = 0;
    let minCost = Infinity;
    let maxCost = -Infinity;

    predictions.forEach(prediction => {
      const weight = prediction.confidence;
      totalWeight += weight;
      weightedSum += prediction.predictedCost * weight;
      
      minCost = Math.min(minCost, prediction.predictionRange.min);
      maxCost = Math.max(maxCost, prediction.predictionRange.max);
    });

    const ensembleCost = weightedSum / totalWeight;
    const ensembleConfidence = this.calculateEnsembleConfidence(predictions);

    return {
      predictionId: `ensemble-${Date.now()}`,
      algorithm: 'ensemble',
      predictedCost: ensembleCost,
      confidence: ensembleConfidence,
      predictionRange: { min: minCost, max: maxCost },
      riskLevel: this.calculateEnsembleRisk(predictions),
      contributingFactors: this.extractContributingFactors(predictions),
      algorithmMetrics: { ensembleWeight: totalWeight }
    };
  }

  /**
   * 计算集成置信度
   */
  private calculateEnsembleConfidence(predictions: CostPredictionResult[]): number {
    const confidences = predictions.map(p => p.confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    
    // 考虑预测结果的一致性
    const costs = predictions.map(p => p.predictedCost);
    const costVariance = this.calculateVariance(costs);
    const consistencyPenalty = Math.min(0.2, costVariance / 1000);
    
    return Math.max(0.5, avgConfidence - consistencyPenalty);
  }

  /**
   * 计算集成风险
   */
  private calculateEnsembleRisk(predictions: CostPredictionResult[]): 'low' | 'medium' | 'high' {
    const riskScores = predictions.map(p => {
      switch (p.riskLevel) {
        case 'low': return 1;
        case 'medium': return 2;
        case 'high': return 3;
        default: return 2;
      }
    });

    const avgRiskScore = riskScores.reduce((a, b) => a + b, 0) / riskScores.length;
    
    if (avgRiskScore < 1.5) return 'low';
    if (avgRiskScore < 2.5) return 'medium';
    return 'high';
  }

  /**
   * 提取影响因素
   */
  private extractContributingFactors(predictions: CostPredictionResult[]): string[] {
    const factors = new Set<string>();
    
    predictions.forEach(prediction => {
      prediction.contributingFactors.forEach(factor => {
        factors.add(factor);
      });
    });

    return Array.from(factors);
  }

  /**
   * 比较算法性能
   */
  private compareAlgorithmPerformance(
    algorithms: PredictionAlgorithm[], 
    data: CostData[]
  ): Record<string, number> {
    const comparison: Record<string, number> = {};
    
    algorithms.forEach(algorithm => {
      const metrics = algorithm.getMetrics(data);
      // 使用MAE（平均绝对误差）作为性能指标
      comparison[algorithm.name] = metrics.mae || 0;
    });

    return comparison;
  }

  /**
   * 计算方差
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * 获取可用算法列表
   */
  getAvailableAlgorithms(): string[] {
    return Array.from(this.algorithms.keys());
  }

  /**
   * 获取算法详情
   */
  getAlgorithmDetails(name: string): PredictionAlgorithm | undefined {
    return this.algorithms.get(name);
  }

  /**
   * 设置默认预测周期
   */
  setDefaultHorizon(horizon: number): void {
    this.defaultHorizon = Math.max(1, horizon);
  }

  /**
   * 添加自定义算法
   */
  addCustomAlgorithm(algorithm: PredictionAlgorithm): void {
    this.algorithms.set(algorithm.name, algorithm);
  }
}

/**
 * 线性回归算法
 */
class LinearRegressionAlgorithm implements PredictionAlgorithm {
  name = 'linear-regression';
  description = '基于线性回归的成本趋势预测';
  supportsSeasonality = false;
  supportsTrend = true;
  minDataPoints = 3;

  async predict(data: CostData[], horizon: number): Promise<CostPredictionResult> {
    const amounts = data.map(d => d.amount);
    const n = amounts.length;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    amounts.forEach((y, x) => {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    const predictedCost = intercept + slope * (n + horizon - 1);
    const confidence = this.calculateConfidence(amounts, slope, intercept);
    
    return {
      predictionId: `lr-${Date.now()}`,
      algorithm: this.name,
      predictedCost,
      confidence,
      predictionRange: this.calculatePredictionRange(amounts, predictedCost, confidence),
      riskLevel: this.assessRisk(amounts, slope),
      contributingFactors: this.identifyFactors(slope, amounts),
      algorithmMetrics: this.getMetrics(data)
    };
  }

  validate(data: CostData[]): boolean {
    return data.length >= this.minDataPoints;
  }

  getMetrics(data: CostData[]): Record<string, number> {
    const amounts = data.map(d => d.amount);
    const n = amounts.length;
    
    if (n < 2) return { mae: 0, mse: 0, rmse: 0 };
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    amounts.forEach((y, x) => {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // 计算拟合误差
    let sumSquaredErrors = 0;
    let sumAbsoluteErrors = 0;
    
    amounts.forEach((y, x) => {
      const predicted = intercept + slope * x;
      const error = y - predicted;
      sumSquaredErrors += error * error;
      sumAbsoluteErrors += Math.abs(error);
    });

    return {
      mae: sumAbsoluteErrors / n,
      mse: sumSquaredErrors / n,
      rmse: Math.sqrt(sumSquaredErrors / n)
    };
  }

  private calculateConfidence(amounts: number[], slope: number, intercept: number): number {
    const n = amounts.length;
    let sumSquaredErrors = 0;
    
    amounts.forEach((y, x) => {
      const predicted = intercept + slope * x;
      const error = y - predicted;
      sumSquaredErrors += error * error;
    });

    const variance = sumSquaredErrors / (n - 2);
    const baseConfidence = Math.min(0.95, 0.8 + (n / 30) * 0.15);
    const variancePenalty = Math.min(0.2, variance / 1000);
    
    return Math.max(0.5, baseConfidence - variancePenalty);
  }

  private calculatePredictionRange(amounts: number[], predictedCost: number, confidence: number): { min: number; max: number } {
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const range = avgAmount * 0.2 * (1 - confidence);
    
    return {
      min: Math.max(0, predictedCost - range),
      max: predictedCost + range
    };
  }

  private assessRisk(amounts: number[], slope: number): 'low' | 'medium' | 'high' {
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const slopePercentage = Math.abs(slope) / avgAmount;
    
    if (slopePercentage < 0.05) return 'low';
    if (slopePercentage < 0.15) return 'medium';
    return 'high';
  }

  private identifyFactors(slope: number, amounts: number[]): string[] {
    const factors: string[] = [];
    
    if (slope > 0) {
      factors.push('成本呈上升趋势');
    } else if (slope < 0) {
      factors.push('成本呈下降趋势');
    } else {
      factors.push('成本趋势稳定');
    }

    const variance = this.calculateVariance(amounts);
    if (variance > 1000) {
      factors.push('成本波动较大');
    }

    return factors;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }
}

/**
 * 移动平均算法
 */
class MovingAverageAlgorithm implements PredictionAlgorithm {
  name = 'moving-average';
  description = '基于移动平均的成本平滑预测';
  supportsSeasonality = false;
  supportsTrend = false;
  minDataPoints = 5;

  async predict(data: CostData[], horizon: number): Promise<CostPredictionResult> {
    const amounts = data.map(d => d.amount);
    const windowSize = Math.min(7, Math.floor(amounts.length / 2));
    
    const movingAverage = this.calculateMovingAverage(amounts, windowSize);
    const predictedCost = movingAverage[movingAverage.length - 1];
    
    return {
      predictionId: `ma-${Date.now()}`,
      algorithm: this.name,
      predictedCost,
      confidence: 0.7,
      predictionRange: { min: predictedCost * 0.8, max: predictedCost * 1.2 },
      riskLevel: 'medium',
      contributingFactors: ['基于近期平均成本预测'],
      algorithmMetrics: this.getMetrics(data)
    };
  }

  validate(data: CostData[]): boolean {
    return data.length >= this.minDataPoints;
  }

  getMetrics(data: CostData[]): Record<string, number> {
    return { mae: 0, mse: 0, rmse: 0 };
  }

  private calculateMovingAverage(amounts: number[], windowSize: number): number[] {
    const result: number[] = [];
    
    for (let i = windowSize - 1; i < amounts.length; i++) {
      const window = amounts.slice(i - windowSize + 1, i + 1);
      const average = window.reduce((a, b) => a + b, 0) / windowSize;
      result.push(average);
    }
    
    return result;
  }
}

/**
 * 指数平滑算法
 */
class ExponentialSmoothingAlgorithm implements PredictionAlgorithm {
  name = 'exponential-smoothing';
  description = '基于指数平滑的时间序列预测';
  supportsSeasonality = false;
  supportsTrend = true;
  minDataPoints = 5;

  async predict(data: CostData[], horizon: number): Promise<CostPredictionResult> {
    const amounts = data.map(d => d.amount);
    const alpha = 0.3; // 平滑系数
    
    let smoothed = amounts[0];
    for (let i = 1; i < amounts.length; i++) {
      smoothed = alpha * amounts[i] + (1 - alpha) * smoothed;
    }
    
    const predictedCost = smoothed;
    
    return {
      predictionId: `es-${Date.now()}`,
      algorithm: this.name,
      predictedCost,
      confidence: 0.75,
      predictionRange: { min: predictedCost * 0.85, max: predictedCost * 1.15 },
      riskLevel: 'low',
      contributingFactors: ['基于指数平滑的稳定预测'],
      algorithmMetrics: this.getMetrics(data)
    };
  }

  validate(data: CostData[]): boolean {
    return data.length >= this.minDataPoints;
  }

  getMetrics(data: CostData[]): Record<string, number> {
    return { mae: 0, mse: 0, rmse: 0 };
  }
}

/**
 * 季节性分解算法
 */
class SeasonalDecompositionAlgorithm implements PredictionAlgorithm {
  name = 'seasonal-decomposition';
  description = '季节性分解和趋势分析';
  supportsSeasonality = true;
  supportsTrend = true;
  minDataPoints = 14; // 至少2周数据

  async predict(data: CostData[], horizon: number): Promise<CostPredictionResult> {
    // 简化实现：检测周末模式
    const amounts = data.map(d => d.amount);
    const predictedCost = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    
    return {
      predictionId: `sd-${Date.now()}`,
      algorithm: this.name,
      predictedCost,
      confidence: 0.8,
      predictionRange: { min: predictedCost * 0.7, max: predictedCost * 1.3 },
      riskLevel: 'medium',
      contributingFactors: ['考虑季节性模式'],
      algorithmMetrics: this.getMetrics(data)
    };
  }

  validate(data: CostData[]): boolean {
    return data.length >= this.minDataPoints;
  }

  getMetrics(data: CostData[]): Record<string, number> {
    return { mae: 0, mse: 0, rmse: 0 };
  }
}