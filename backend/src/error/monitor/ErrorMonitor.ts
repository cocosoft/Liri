/**
 * 错误监控器
 * 提供错误统计、报告和告警功能
 */

import { AppError, ErrorCategory, ErrorSeverity } from '../types';
import { logger } from '@modules/utils/log';

/**
 * 错误统计信息接口
 */
export interface ErrorStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorsByType: Record<string, number>;
  recentErrors: Array<{
    timestamp: number;
    error: AppError;
  }>;
  errorTrends: Array<{
    timestamp: number;
    count: number;
  }>;
}

/**
 * 错误监控器类
 */
export class ErrorMonitor {
  private stats: ErrorStats;
  private maxRecentErrors: number = 100;
  private maxTrendPoints: number = 100;

  /**
   * 构造函数
   */
  constructor() {
    this.stats = {
      totalErrors: 0,
      errorsByCategory: Object.values(ErrorCategory).reduce((acc, category) => {
        acc[category] = 0;
        return acc;
      }, {} as Record<ErrorCategory, number>),
      errorsBySeverity: Object.values(ErrorSeverity).reduce((acc, severity) => {
        acc[severity] = 0;
        return acc;
      }, {} as Record<ErrorSeverity, number>),
      errorsByType: {},
      recentErrors: [],
      errorTrends: []
    };
  }

  /**
   * 记录错误
   * @param error 错误对象
   */
  recordError(error: AppError): void {
    // 更新统计信息
    this.stats.totalErrors++;
    this.stats.errorsByCategory[error.category]++;
    this.stats.errorsBySeverity[error.severity]++;
    
    // 更新错误类型统计
    if (!this.stats.errorsByType[error.name]) {
      this.stats.errorsByType[error.name] = 0;
    }
    this.stats.errorsByType[error.name]++;
    
    // 添加到最近错误列表
    this.stats.recentErrors.unshift({
      timestamp: Date.now(),
      error
    });
    
    // 限制最近错误列表大小
    if (this.stats.recentErrors.length > this.maxRecentErrors) {
      this.stats.recentErrors = this.stats.recentErrors.slice(0, this.maxRecentErrors);
    }
    
    // 更新错误趋势
    this.updateErrorTrend();

    // 记录严重错误
    if (error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.HIGH) {
      logger.warn(`High severity error detected: ${error.name}`, {
        category: error.category,
        severity: error.severity,
        code: error.code,
        message: error.message
      });
    }
  }

  /**
   * 更新错误趋势
   */
  private updateErrorTrend(): void {
    const now = Date.now();
    
    // 检查是否需要添加新的趋势点
    const lastTrend = this.stats.errorTrends[this.stats.errorTrends.length - 1];
    if (!lastTrend || now - lastTrend.timestamp >= 60000) { // 每分钟一个点
      this.stats.errorTrends.push({
        timestamp: now,
        count: 1
      });
    } else {
      // 更新最后一个趋势点
      lastTrend.count++;
    }
    
    // 限制趋势点数量
    if (this.stats.errorTrends.length > this.maxTrendPoints) {
      this.stats.errorTrends = this.stats.errorTrends.slice(-this.maxTrendPoints);
    }
  }

  /**
   * 获取错误统计信息
   * @returns 错误统计信息
   */
  getStats(): ErrorStats {
    return JSON.parse(JSON.stringify(this.stats));
  }

  /**
   * 获取错误统计摘要
   * @returns 错误统计摘要
   */
  getSummary(): {
    totalErrors: number;
    topCategories: Array<{ category: string; count: number }>;
    topSeverities: Array<{ severity: string; count: number }>;
    topTypes: Array<{ type: string; count: number }>;
    recentCount: number;
  } {
    const stats = this.getStats();
    
    const topCategories = Object.entries(stats.errorsByCategory)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));
    
    const topSeverities = Object.entries(stats.errorsBySeverity)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([severity, count]) => ({ severity, count }));
    
    const topTypes = Object.entries(stats.errorsByType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));
    
    return {
      totalErrors: stats.totalErrors,
      topCategories,
      topSeverities,
      topTypes,
      recentCount: stats.recentErrors.length
    };
  }

  /**
   * 生成错误报告
   * @returns 错误报告
   */
  generateReport(): string {
    const stats = this.getStats();
    let report = `=== 错误监控报告 ===\n`;
    
    report += `总错误数: ${stats.totalErrors}\n\n`;
    
    report += `按分类统计:\n`;
    for (const [category, count] of Object.entries(stats.errorsByCategory)) {
      if (count > 0) {
        report += `  - ${category}: ${count}\n`;
      }
    }
    
    report += `\n按严重程度统计:\n`;
    for (const [severity, count] of Object.entries(stats.errorsBySeverity)) {
      if (count > 0) {
        report += `  - ${severity}: ${count}\n`;
      }
    }
    
    report += `\n按错误类型统计:\n`;
    const sortedTypes = Object.entries(stats.errorsByType)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10); // 只显示前10种错误类型
    
    for (const [type, count] of sortedTypes) {
      report += `  - ${type}: ${count}\n`;
    }
    
    report += `\n最近错误:\n`;
    const recentErrors = stats.recentErrors.slice(0, 5); // 只显示最近5个错误
    for (const { timestamp, error } of recentErrors) {
      const time = new Date(timestamp).toISOString();
      report += `  - ${time}: ${error.name} - ${error.message}\n`;
    }
    
    report += `================`;
    
    return report;
  }

  /**
   * 检查错误阈值
   * @param thresholds 阈值配置
   * @returns 超出阈值的错误类型
   */
  checkThresholds(thresholds: {
    totalErrors?: number;
    criticalErrors?: number;
    highSeverityErrors?: number;
  }): Array<{
    type: string;
    current: number;
    threshold: number;
  }> {
    const alerts: Array<{
      type: string;
      current: number;
      threshold: number;
    }> = [];
    
    // 检查总错误数
    if (thresholds.totalErrors !== undefined && this.stats.totalErrors > thresholds.totalErrors) {
      alerts.push({
        type: 'totalErrors',
        current: this.stats.totalErrors,
        threshold: thresholds.totalErrors
      });
    }
    
    // 检查严重错误数
    if (thresholds.criticalErrors !== undefined && this.stats.errorsBySeverity[ErrorSeverity.CRITICAL] > thresholds.criticalErrors) {
      alerts.push({
        type: 'criticalErrors',
        current: this.stats.errorsBySeverity[ErrorSeverity.CRITICAL],
        threshold: thresholds.criticalErrors
      });
    }
    
    // 检查高严重程度错误数
    if (thresholds.highSeverityErrors !== undefined && this.stats.errorsBySeverity[ErrorSeverity.HIGH] > thresholds.highSeverityErrors) {
      alerts.push({
        type: 'highSeverityErrors',
        current: this.stats.errorsBySeverity[ErrorSeverity.HIGH],
        threshold: thresholds.highSeverityErrors
      });
    }
    
    return alerts;
  }

  /**
   * 获取错误率（每分钟）
   * @param minutes 时间窗口（分钟）
   * @returns 错误率
   */
  getErrorRate(minutes: number = 5): number {
    const now = Date.now();
    const windowStart = now - (minutes * 60 * 1000);
    
    const recentCount = this.stats.recentErrors.filter(
      ({ timestamp }) => timestamp >= windowStart
    ).length;
    
    return recentCount / minutes;
  }

  /**
   * 获取特定分类的错误数
   * @param category 错误分类
   * @returns 错误数
   */
  getErrorsByCategory(category: ErrorCategory): number {
    return this.stats.errorsByCategory[category] || 0;
  }

  /**
   * 获取特定严重程度的错误数
   * @param severity 错误严重程度
   * @returns 错误数
   */
  getErrorsBySeverity(severity: ErrorSeverity): number {
    return this.stats.errorsBySeverity[severity] || 0;
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalErrors: 0,
      errorsByCategory: Object.values(ErrorCategory).reduce((acc, category) => {
        acc[category] = 0;
        return acc;
      }, {} as Record<ErrorCategory, number>),
      errorsBySeverity: Object.values(ErrorSeverity).reduce((acc, severity) => {
        acc[severity] = 0;
        return acc;
      }, {} as Record<ErrorSeverity, number>),
      errorsByType: {},
      recentErrors: [],
      errorTrends: []
    };
  }
}

// 导出单例实例
export const errorMonitor = new ErrorMonitor();
