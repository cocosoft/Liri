/**
 * 增强错误管理器
 * 提供高级错误处理、分析和生命周期管理功能
 */

import type { AppError, ErrorCategory, ErrorContext } from './types.js';

import { ErrorSeverity } from './types.js';

import {
  ErrorManager,
  ErrorManagerConfig,
  ErrorManagerStats,
} from './ErrorManager.js';

import { errorMonitor, ErrorStats } from './monitor/ErrorMonitor.js';

import {
  errorTracker,
  ErrorSearchQuery,
  ErrorAnalysis,
  TrackedError,
} from './tracker/ErrorTracker.js';

import type { RecoveryResult } from './recovery/ErrorRecoverer';

import type { AlertEvent } from './warning/ErrorWarner';

export interface EnhancedErrorManagerConfig extends ErrorManagerConfig {
  enableAdvancedAnalysis: boolean;
  enableErrorCorrelation: boolean;
  enableTrendAnalysis: boolean;
  maxErrorHistory: number;
  analysisWindow: number; // 分析窗口（毫秒）
}

export interface ErrorCorrelation {
  correlatedErrors: TrackedError[];
  correlationScore: number;
  commonPatterns: string[];
  rootCauseAnalysis: string;
}

export interface ErrorTrend {
  period: string;
  errorCount: number;
  severityDistribution: Record<ErrorSeverity, number>;
  categoryDistribution: Record<ErrorCategory, number>;
  trendDirection: 'increasing' | 'decreasing' | 'stable';
  trendStrength: number;
}

export interface ErrorLifecycle {
  errorId: string;
  createdAt: number;
  handledAt?: number;
  recoveredAt?: number;
  resolvedAt?: number;
  status: 'active' | 'handled' | 'recovered' | 'resolved';
  lifecycleDuration?: number;
}

export class EnhancedErrorManager {
  private baseManager: ErrorManager;
  private config: EnhancedErrorManagerConfig;
  private errorHistory: TrackedError[] = [];
  private errorLifecycles: Map<string, ErrorLifecycle> = new Map();

  constructor(config?: Partial<EnhancedErrorManagerConfig>) {
    this.config = {
      autoTrack: true,
      autoRecover: true,
      autoWarn: true,
      enableAdvancedAnalysis: true,
      enableErrorCorrelation: true,
      enableTrendAnalysis: true,
      maxErrorHistory: 1000,
      analysisWindow: 24 * 60 * 60 * 1000, // 24小时
      ...config,
    };

    this.baseManager = new ErrorManager(config);
  }

  /**
   * 增强的错误处理方法
   */
  async handleErrorEnhanced(
    error: Error,
    context?: ErrorContext
  ): Promise<{
    trackedId: string;
    recoveryResult?: any;
    alert?: any;
    correlation?: ErrorCorrelation;
    lifecycle: ErrorLifecycle;
  }> {
    // 使用基础管理器处理错误
    const baseResult = await this.baseManager.handleError(error, context);

    if (!baseResult.trackedId) {
      throw new Error('错误追踪失败');
    }

    // 获取追踪的错误信息
    const trackedError = errorTracker.get(baseResult.trackedId);
    if (trackedError) {
      this.addToHistory(trackedError);
    }

    // 创建错误生命周期
    const lifecycle = this.createLifecycle(baseResult.trackedId);

    // 高级分析
    let correlation: ErrorCorrelation | undefined;
    if (this.config.enableAdvancedAnalysis && trackedError) {
      correlation = await this.analyzeCorrelation(trackedError);
    }

    return {
      ...baseResult,
      trackedId: baseResult.trackedId!,
      correlation,
      lifecycle,
    };
  }

  /**
   * 批量错误处理
   */
  async handleErrorsBatch(
    errors: Error[],
    context?: ErrorContext
  ): Promise<{
    results: Array<{
      error: Error;
      result: {
        trackedId: string;
        recoveryResult?: RecoveryResult;
        alert?: AlertEvent;
        correlation?: ErrorCorrelation;
        lifecycle: ErrorLifecycle;
      };
    }>;
    batchAnalysis: {
      totalErrors: number;
      successCount: number;
      failureCount: number;
      averageHandlingTime: number;
    };
  }> {
    const startTime = Date.now();
    const results = [];
    let successCount = 0;

    for (const error of errors) {
      try {
        const result = await this.handleErrorEnhanced(error, context);
        results.push({ error, result });
        successCount++;
      } catch (handleError) {
        results.push({
          error,
          result: {
            trackedId: `batch_fail_${Date.now()}`,
            lifecycle: this.createLifecycle(`batch_fail_${Date.now()}`),
          },
        });
      }
    }

    const endTime = Date.now();
    const averageHandlingTime =
      results.length > 0 ? (endTime - startTime) / results.length : 0;

    return {
      results,
      batchAnalysis: {
        totalErrors: errors.length,
        successCount,
        failureCount: errors.length - successCount,
        averageHandlingTime,
      },
    };
  }

  /**
   * 错误趋势分析
   */
  analyzeTrends(period: number = this.config.analysisWindow): ErrorTrend[] {
    const now = Date.now();
    const startTime = now - period;

    const recentErrors = this.errorHistory.filter(
      (error) => error.timestamp >= startTime
    );

    // 按时间段分组分析
    const trends: ErrorTrend[] = [];
    const hourMs = 60 * 60 * 1000;

    for (let i = 0; i < 24; i++) {
      const periodStart = startTime + i * hourMs;
      const periodEnd = periodStart + hourMs;

      const periodErrors = recentErrors.filter(
        (error) => error.timestamp >= periodStart && error.timestamp < periodEnd
      );

      const trend: ErrorTrend = {
        period: new Date(periodStart).toLocaleTimeString(),
        errorCount: periodErrors.length,
        severityDistribution: this.calculateSeverityDistribution(periodErrors),
        categoryDistribution: this.calculateCategoryDistribution(periodErrors),
        trendDirection: 'stable',
        trendStrength: 0,
      };

      trends.push(trend);
    }

    // 计算趋势方向
    this.calculateTrendDirections(trends);

    return trends;
  }

  /**
   * 错误关联分析
   */
  private async analyzeCorrelation(
    error: TrackedError
  ): Promise<ErrorCorrelation> {
    const correlatedErrors = this.findCorrelatedErrors(error);

    return {
      correlatedErrors,
      correlationScore: this.calculateCorrelationScore(error, correlatedErrors),
      commonPatterns: this.extractCommonPatterns([error, ...correlatedErrors]),
      rootCauseAnalysis: await this.analyzeRootCause(error, correlatedErrors),
    };
  }

  /**
   * 查找关联错误
   */
  private findCorrelatedErrors(targetError: TrackedError): TrackedError[] {
    const windowStart = targetError.timestamp - this.config.analysisWindow;

    return this.errorHistory.filter((error) => {
      // 排除自身
      if (error.id === targetError.id) return false;

      // 时间窗口内
      if (error.timestamp < windowStart) return false;

      // 相似性检查
      return this.calculateErrorSimilarity(targetError, error) > 0.7;
    });
  }

  /**
   * 计算错误相似度
   */
  private calculateErrorSimilarity(
    error1: TrackedError,
    error2: TrackedError
  ): number {
    let similarity = 0;

    // 错误类型相似度
    if (error1.error.category === error2.error.category) similarity += 0.3;
    if (error1.error.severity === error2.error.severity) similarity += 0.2;

    // 错误消息相似度（简化实现）
    const message1 = error1.error.message.toLowerCase();
    const message2 = error2.error.message.toLowerCase();
    if (message1.includes(message2) || message2.includes(message1)) {
      similarity += 0.5;
    }

    return Math.min(similarity, 1);
  }

  /**
   * 计算关联分数
   */
  private calculateCorrelationScore(
    targetError: TrackedError,
    correlatedErrors: TrackedError[]
  ): number {
    if (correlatedErrors.length === 0) return 0;

    const totalSimilarity = correlatedErrors.reduce((sum, error) => {
      return sum + this.calculateErrorSimilarity(targetError, error);
    }, 0);

    return totalSimilarity / correlatedErrors.length;
  }

  /**
   * 提取共同模式
   */
  private extractCommonPatterns(errors: TrackedError[]): string[] {
    const patterns: string[] = [];

    if (errors.length > 0) {
      // 提取错误类别模式
      const categories = [...new Set(errors.map((e) => e.error.category))];
      if (categories.length === 1) {
        patterns.push(`统一错误类别: ${categories[0]}`);
      }

      // 提取时间模式
      const timeDiff =
        errors[errors.length - 1].timestamp - errors[0].timestamp;
      if (timeDiff < 60000) {
        // 1分钟内
        patterns.push('短时间内集中发生');
      }
    }

    return patterns;
  }

  /**
   * 分析根本原因
   */
  private async analyzeRootCause(
    targetError: TrackedError,
    correlatedErrors: TrackedError[]
  ): Promise<string> {
    if (correlatedErrors.length === 0) {
      return '独立发生的错误，需要单独分析根本原因';
    }

    // 简化实现：基于错误类别和严重程度分析
    const commonCategory = correlatedErrors.every(
      (e) => e.error.category === targetError.error.category
    );
    const highSeverityCount = correlatedErrors.filter(
      (e) =>
        e.error.severity === ErrorSeverity.HIGH ||
        e.error.severity === ErrorSeverity.CRITICAL
    ).length;

    if (commonCategory && highSeverityCount > 0) {
      return `系统性问题，可能与${targetError.error.category}相关的组件故障有关`;
    }

    return '需要进一步调查错误关联性';
  }

  /**
   * 计算严重程度分布
   */
  private calculateSeverityDistribution(
    errors: TrackedError[]
  ): Record<ErrorSeverity, number> {
    const distribution: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0,
    };

    errors.forEach((error) => {
      distribution[error.error.severity]++;
    });

    return distribution;
  }

  /**
   * 计算错误类别分布
   */
  private calculateCategoryDistribution(
    errors: TrackedError[]
  ): Record<ErrorCategory, number> {
    const distribution: Partial<Record<ErrorCategory, number>> = {};

    errors.forEach((error) => {
      distribution[error.error.category] =
        (distribution[error.error.category] || 0) + 1;
    });

    return distribution as Record<ErrorCategory, number>;
  }

  /**
   * 计算趋势方向
   */
  private calculateTrendDirections(trends: ErrorTrend[]): void {
    if (trends.length < 2) return;

    for (let i = 1; i < trends.length; i++) {
      const current = trends[i];
      const previous = trends[i - 1];

      if (current.errorCount > previous.errorCount) {
        current.trendDirection = 'increasing';
        current.trendStrength =
          (current.errorCount - previous.errorCount) / previous.errorCount;
      } else if (current.errorCount < previous.errorCount) {
        current.trendDirection = 'decreasing';
        current.trendStrength =
          (previous.errorCount - current.errorCount) / previous.errorCount;
      } else {
        current.trendDirection = 'stable';
        current.trendStrength = 0;
      }
    }
  }

  /**
   * 添加错误到历史记录
   */
  private addToHistory(error: TrackedError): void {
    this.errorHistory.push(error);

    // 限制历史记录大小
    if (this.errorHistory.length > this.config.maxErrorHistory) {
      this.errorHistory = this.errorHistory.slice(-this.config.maxErrorHistory);
    }
  }

  /**
   * 创建错误生命周期
   */
  private createLifecycle(errorId: string): ErrorLifecycle {
    const lifecycle: ErrorLifecycle = {
      errorId,
      createdAt: Date.now(),
      status: 'active',
    };

    this.errorLifecycles.set(errorId, lifecycle);
    return lifecycle;
  }

  /**
   * 更新错误生命周期状态
   */
  updateLifecycleStatus(
    errorId: string,
    status: ErrorLifecycle['status']
  ): void {
    const lifecycle = this.errorLifecycles.get(errorId);
    if (lifecycle) {
      lifecycle.status = status;

      switch (status) {
        case 'handled':
          lifecycle.handledAt = Date.now();
          break;
        case 'recovered':
          lifecycle.recoveredAt = Date.now();
          break;
        case 'resolved':
          lifecycle.resolvedAt = Date.now();
          lifecycle.lifecycleDuration =
            lifecycle.resolvedAt - lifecycle.createdAt;
          break;
      }
    }
  }

  /**
   * 获取错误统计信息
   */
  getEnhancedStats(): {
    baseStats: ErrorManagerStats;
    trendAnalysis: ErrorTrend[];
    lifecycleStats: {
      totalLifecycles: number;
      active: number;
      handled: number;
      recovered: number;
      resolved: number;
      averageResolutionTime: number;
    };
  } {
    const baseStats =
      this.baseManager.getStats?.() || ({} as ErrorManagerStats);
    const trends = this.analyzeTrends();

    const lifecycleStats = {
      totalLifecycles: this.errorLifecycles.size,
      active: Array.from(this.errorLifecycles.values()).filter(
        (l) => l.status === 'active'
      ).length,
      handled: Array.from(this.errorLifecycles.values()).filter(
        (l) => l.status === 'handled'
      ).length,
      recovered: Array.from(this.errorLifecycles.values()).filter(
        (l) => l.status === 'recovered'
      ).length,
      resolved: Array.from(this.errorLifecycles.values()).filter(
        (l) => l.status === 'resolved'
      ).length,
      averageResolutionTime: this.calculateAverageResolutionTime(),
    };

    return {
      baseStats,
      trendAnalysis: trends,
      lifecycleStats,
    };
  }

  /**
   * 计算平均解决时间
   */
  private calculateAverageResolutionTime(): number {
    const resolvedLifecycles = Array.from(this.errorLifecycles.values()).filter(
      (l) => l.status === 'resolved' && l.lifecycleDuration
    );

    if (resolvedLifecycles.length === 0) return 0;

    const totalTime = resolvedLifecycles.reduce(
      (sum, l) => sum + (l.lifecycleDuration || 0),
      0
    );

    return totalTime / resolvedLifecycles.length;
  }

  /**
   * 获取基础管理器
   */
  getBaseManager(): ErrorManager {
    return this.baseManager;
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.errorHistory = [];
    this.errorLifecycles.clear();
  }
}
