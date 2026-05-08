/**
 * 高级错误分析器
 * 提供深度错误分析、模式识别和预测功能
 */

import { 
  ErrorCategory,
  ErrorSeverity
} from './types.js';

import type { 
  TrackedError, 
  ErrorContext 
} from './types.js';

export interface ErrorPattern {
  id: string;
  name: string;
  description: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  frequency: number;
  impact: number;
  patterns: string[];
  mitigation: string;
}

export interface ErrorPrediction {
  predictionId: string;
  predictedCategory: ErrorCategory;
  predictedSeverity: ErrorSeverity;
  confidence: number;
  expectedTimeframe: string;
  riskFactors: string[];
  preventionRecommendations: string[];
}

export interface ErrorCluster {
  clusterId: string;
  centroid: TrackedError;
  members: TrackedError[];
  size: number;
  averageSeverity: number;
  dominantCategory: ErrorCategory;
  cohesion: number;
}

export class AdvancedErrorAnalyzer {
  private errorPatterns: Map<string, ErrorPattern> = new Map();
  private analysisWindow: number = 24 * 60 * 60 * 1000; // 24小时

  constructor() {
    this.initializeDefaultPatterns();
  }

  /**
   * 初始化默认错误模式
   */
  private initializeDefaultPatterns(): void {
    const defaultPatterns: ErrorPattern[] = [
      {
        id: 'pattern-001',
        name: '资源耗尽',
        description: '系统资源（内存、CPU、磁盘）达到极限',
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.FILESYSTEM,
        frequency: 0.8,
        impact: 0.9,
        patterns: ['内存不足', 'CPU使用率过高', '磁盘空间不足'],
        mitigation: '增加系统资源或优化资源使用'
      },
      {
        id: 'pattern-002',
        name: '网络连接问题',
        description: '网络连接失败或超时',
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.NETWORK,
        frequency: 0.6,
        impact: 0.7,
        patterns: ['连接超时', '网络不可达', 'DNS解析失败'],
        mitigation: '检查网络连接和配置'
      },
      {
        id: 'pattern-003',
        name: '数据一致性错误',
        description: '数据不一致或损坏',
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.DATABASE,
        frequency: 0.4,
        impact: 0.8,
        patterns: ['数据校验失败', '引用完整性错误', '数据格式错误'],
        mitigation: '实施数据验证和恢复机制'
      }
    ];

    defaultPatterns.forEach(pattern => {
      this.errorPatterns.set(pattern.id, pattern);
    });
  }

  /**
   * 分析错误模式匹配
   */
  analyzePatternMatching(errors: TrackedError[]): {
    matchedPatterns: Array<{
      pattern: ErrorPattern;
      matchedErrors: TrackedError[];
      matchScore: number;
    }>;
    unmatchedErrors: TrackedError[];
  } {
    const matchedPatterns: Array<{
      pattern: ErrorPattern;
      matchedErrors: TrackedError[];
      matchScore: number;
    }> = [];
    
    const unmatchedErrors = [...errors];

    // 检查每个模式
    for (const pattern of this.errorPatterns.values()) {
      const matchedErrors: TrackedError[] = [];
      
      for (const error of errors) {
        if (this.doesErrorMatchPattern(error, pattern)) {
          matchedErrors.push(error);
        }
      }

      if (matchedErrors.length > 0) {
        const matchScore = this.calculatePatternMatchScore(matchedErrors, pattern);
        matchedPatterns.push({
          pattern,
          matchedErrors,
          matchScore
        });

        // 从未匹配错误中移除已匹配的错误
        unmatchedErrors.splice(0, unmatchedErrors.length, ...unmatchedErrors.filter(
          error => !matchedErrors.includes(error)
        ));
      }
    }

    return {
      matchedPatterns,
      unmatchedErrors
    };
  }

  /**
   * 检查错误是否匹配模式
   */
  private doesErrorMatchPattern(error: TrackedError, pattern: ErrorPattern): boolean {
    // 检查类别和严重程度
    if (error.error.category !== pattern.category || error.error.severity !== pattern.severity) {
      return false;
    }

    // 检查错误消息模式
    const errorMessage = error.error.message.toLowerCase();
    return pattern.patterns.some(patternText => 
      errorMessage.includes(patternText.toLowerCase())
    );
  }

  /**
   * 计算模式匹配分数
   */
  private calculatePatternMatchScore(
    matchedErrors: TrackedError[], 
    pattern: ErrorPattern
  ): number {
    const totalErrors = matchedErrors.length;
    const severityWeight = this.getSeverityWeight(pattern.severity);
    const frequencyWeight = pattern.frequency;
    
    return (totalErrors * severityWeight * frequencyWeight) / 100;
  }

  /**
   * 获取严重程度权重
   */
  private getSeverityWeight(severity: ErrorSeverity): number {
    const weights: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0.3,
      [ErrorSeverity.MEDIUM]: 0.6,
      [ErrorSeverity.HIGH]: 0.8,
      [ErrorSeverity.CRITICAL]: 1.0
    };
    
    return weights[severity];
  }

  /**
   * 错误聚类分析
   */
  clusterErrors(errors: TrackedError[], maxClusters: number = 5): ErrorCluster[] {
    if (errors.length === 0) return [];
    
    const clusters: ErrorCluster[] = [];
    
    // 简单实现：按类别和严重程度聚类
    const categoryGroups = this.groupByCategory(errors);
    
    for (const [category, categoryErrors] of categoryGroups) {
      const severityGroups = this.groupBySeverity(categoryErrors);
      
      for (const [severity, severityErrors] of severityGroups) {
        if (severityErrors.length > 0) {
          const centroid = this.calculateCentroid(severityErrors);
          const cohesion = this.calculateCohesion(severityErrors, centroid);
          
          clusters.push({
            clusterId: `cluster-${category}-${severity}`,
            centroid,
            members: severityErrors,
            size: severityErrors.length,
            averageSeverity: this.calculateAverageSeverity(severityErrors),
            dominantCategory: category,
            cohesion
          });
        }
      }
    }

    // 限制聚类数量
    return clusters.slice(0, maxClusters).sort((a, b) => b.size - a.size);
  }

  /**
   * 按类别分组
   */
  private groupByCategory(errors: TrackedError[]): Map<ErrorCategory, TrackedError[]> {
    const groups = new Map<ErrorCategory, TrackedError[]>();
    
    errors.forEach(error => {
      if (!groups.has(error.error.category)) {
        groups.set(error.error.category, []);
      }
      groups.get(error.error.category)!.push(error);
    });
    
    return groups;
  }

  /**
   * 按严重程度分组
   */
  private groupBySeverity(errors: TrackedError[]): Map<ErrorSeverity, TrackedError[]> {
    const groups = new Map<ErrorSeverity, TrackedError[]>();
    
    errors.forEach(error => {
      if (!groups.has(error.error.severity)) {
        groups.set(error.error.severity, []);
      }
      groups.get(error.error.severity)!.push(error);
    });
    
    return groups;
  }

  /**
   * 计算聚类中心
   */
  private calculateCentroid(errors: TrackedError[]): TrackedError {
    // 简化实现：返回第一个错误作为中心
    return errors[0];
  }

  /**
   * 计算聚类内聚性
   */
  private calculateCohesion(errors: TrackedError[], centroid: TrackedError): number {
    if (errors.length <= 1) return 1.0;
    
    let totalSimilarity = 0;
    
    for (const error of errors) {
      totalSimilarity += this.calculateErrorSimilarity(error, centroid);
    }
    
    return totalSimilarity / errors.length;
  }

  /**
   * 计算错误相似度
   */
  private calculateErrorSimilarity(error1: TrackedError, error2: TrackedError): number {
    let similarity = 0;
    
    // 类别相似度
    if (error1.error.category === error2.error.category) similarity += 0.4;
    
    // 严重程度相似度
    if (error1.error.severity === error2.error.severity) similarity += 0.3;
    
    // 消息相似度（简化实现）
    const message1 = error1.error.message.toLowerCase();
    const message2 = error2.error.message.toLowerCase();
    
    if (message1 === message2) {
      similarity += 0.3;
    } else if (message1.includes(message2) || message2.includes(message1)) {
      similarity += 0.2;
    }
    
    return Math.min(similarity, 1.0);
  }

  /**
   * 计算平均严重程度
   */
  private calculateAverageSeverity(errors: TrackedError[]): number {
    const severityValues: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 1,
      [ErrorSeverity.MEDIUM]: 2,
      [ErrorSeverity.HIGH]: 3,
      [ErrorSeverity.CRITICAL]: 4
    };
    
    const total = errors.reduce((sum, error) => {
      return sum + severityValues[error.error.severity];
    }, 0);
    
    return errors.length > 0 ? total / errors.length : 0;
  }

  /**
   * 错误趋势预测
   */
  predictErrorTrends(
    historicalErrors: TrackedError[], 
    forecastPeriod: number = 7 * 24 * 60 * 60 * 1000 // 7天
  ): ErrorPrediction[] {
    const predictions: ErrorPrediction[] = [];
    
    if (historicalErrors.length === 0) return predictions;
    
    // 分析历史趋势
    const recentErrors = historicalErrors.filter(
      error => error.timestamp > Date.now() - this.analysisWindow
    );
    
    const categoryTrends = this.analyzeCategoryTrends(recentErrors);
    const severityTrends = this.analyzeSeverityTrends(recentErrors);
    
    // 生成预测
    for (const [category, trend] of categoryTrends) {
      if (trend.trendDirection === 'increasing' && trend.trendStrength > 0.3) {
        predictions.push({
          predictionId: `pred-${category}-${Date.now()}`,
          predictedCategory: category,
          predictedSeverity: this.predictSeverity(category, severityTrends),
          confidence: Math.min(trend.trendStrength * 100, 85),
          expectedTimeframe: '未来24-48小时内',
          riskFactors: this.identifyRiskFactors(category, recentErrors),
          preventionRecommendations: this.generatePreventionRecommendations(category)
        });
      }
    }
    
    return predictions;
  }

  /**
   * 分析类别趋势
   */
  private analyzeCategoryTrends(errors: TrackedError[]): Map<ErrorCategory, { trendDirection: string; trendStrength: number }> {
    const trends = new Map<ErrorCategory, { trendDirection: string; trendStrength: number }>();
    
    // 简化实现：随机生成趋势
    const categories = [...new Set(errors.map(e => e.error.category))];
    
    categories.forEach(category => {
      const categoryErrors = errors.filter(e => e.error.category === category);
      const halfWindow = this.analysisWindow / 2;
      
      const firstHalf = categoryErrors.filter(e => 
        e.timestamp > Date.now() - this.analysisWindow && 
        e.timestamp <= Date.now() - halfWindow
      ).length;
      
      const secondHalf = categoryErrors.filter(e => 
        e.timestamp > Date.now() - halfWindow
      ).length;
      
      const trendDirection = secondHalf > firstHalf ? 'increasing' : 
                           secondHalf < firstHalf ? 'decreasing' : 'stable';
      
      const trendStrength = Math.abs(secondHalf - firstHalf) / Math.max(firstHalf, 1);
      
      trends.set(category, { trendDirection, trendStrength });
    });
    
    return trends;
  }

  /**
   * 分析严重程度趋势
   */
  private analyzeSeverityTrends(errors: TrackedError[]): Map<ErrorSeverity, number> {
    const trends = new Map<ErrorSeverity, number>();
    
    const allSeverities: ErrorSeverity[] = [
      ErrorSeverity.LOW,
      ErrorSeverity.MEDIUM,
      ErrorSeverity.HIGH,
      ErrorSeverity.CRITICAL
    ];
    
    allSeverities.forEach(severity => {
      const count = errors.filter(e => e.error.severity === severity).length;
      trends.set(severity, count);
    });
    
    return trends;
  }

  /**
   * 预测严重程度
   */
  private predictSeverity(
    category: ErrorCategory, 
    severityTrends: Map<ErrorSeverity, number>
  ): ErrorSeverity {
    // 简化实现：返回最常见的严重程度
    let maxSeverity: ErrorSeverity = ErrorSeverity.MEDIUM;
    let maxCount = 0;
    
    severityTrends.forEach((count, severity) => {
      if (count > maxCount) {
        maxCount = count;
        maxSeverity = severity;
      }
    });
    
    return maxSeverity;
  }

  /**
   * 识别风险因素
   */
  private identifyRiskFactors(category: ErrorCategory, errors: TrackedError[]): string[] {
    const factors: string[] = [];
    
    switch (category) {
      case ErrorCategory.RESOURCE:
        factors.push('系统资源使用率持续上升');
        factors.push('内存泄漏迹象');
        break;
      case ErrorCategory.NETWORK:
        factors.push('网络连接稳定性下降');
        factors.push('DNS解析延迟增加');
        break;
      case ErrorCategory.DATA:
        factors.push('数据写入失败率上升');
        factors.push('数据校验错误增多');
        break;
      default:
        factors.push('系统稳定性指标下降');
    }
    
    return factors;
  }

  /**
   * 生成预防建议
   */
  private generatePreventionRecommendations(category: ErrorCategory): string[] {
    const recommendations: string[] = [];
    
    switch (category) {
      case ErrorCategory.RESOURCE:
        recommendations.push('监控系统资源使用情况');
        recommendations.push('优化内存使用和垃圾回收');
        recommendations.push('考虑增加系统资源');
        break;
      case ErrorCategory.NETWORK:
        recommendations.push('检查网络连接配置');
        recommendations.push('实施连接重试机制');
        recommendations.push('监控网络延迟和丢包率');
        break;
      case ErrorCategory.DATA:
        recommendations.push('加强数据验证机制');
        recommendations.push('实施数据备份策略');
        recommendations.push('优化数据库性能');
        break;
      default:
        recommendations.push('加强系统监控和日志记录');
        recommendations.push('定期进行系统健康检查');
    }
    
    return recommendations;
  }

  /**
   * 添加自定义错误模式
   */
  addCustomPattern(pattern: ErrorPattern): void {
    this.errorPatterns.set(pattern.id, pattern);
  }

  /**
   * 获取所有错误模式
   */
  getAllPatterns(): ErrorPattern[] {
    return Array.from(this.errorPatterns.values());
  }

  /**
   * 设置分析窗口
   */
  setAnalysisWindow(windowMs: number): void {
    this.analysisWindow = windowMs;
  }

  /**
   * 清空分析数据
   */
  clearAnalysis(): void {
    this.errorPatterns.clear();
    this.initializeDefaultPatterns();
  }
}