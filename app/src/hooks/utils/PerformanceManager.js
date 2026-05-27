/**
 * 性能管理器
 * 提供钩子执行的性能监控和优化功能
 */

import { EventEmitter } from 'events';

/**
 * 性能指标
 */
export interface PerformanceMetric {
  id: string;
  name: string;
  type: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
  memoryUsage?: number;
  cpuUsage?: number;
}

/**
 * 性能统计
 */
export interface PerformanceStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalDuration: number;
  recentMetrics: PerformanceMetric[];
  byType: Record<string, {
    count: number;
    averageDuration: number;
    successRate: number;
  }>;
}

/**
 * 性能管理器类
 */
class PerformanceManager extends EventEmitter {
  private static instance: PerformanceManager;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private executionQueue: Array<() => Promise<any>> = [];
  private maxConcurrent: number = 5;
  private runningCount: number = 0;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PerformanceManager {
    if (!PerformanceManager.instance) {
      PerformanceManager.instance = new PerformanceManager();
    }
    return PerformanceManager.instance;
  }

  /**
   * 开始执行跟踪
   */
  startExecution(id: string, name: string, type: string): void {
    const metric: PerformanceMetric = {
      id,
      name,
      type,
      startTime: Date.now(),
      success: true,
    };

    this.metrics.set(id, metric);

    this.emit('executionStarted', {
      id,
      name,
      type,
      startTime: metric.startTime,
    });
  }

  /**
   * 结束执行跟踪
   */
  endExecution(
    id: string,
    name: string,
    type: string,
    success: boolean,
    error?: string
  ): void {
    const metric = this.metrics.get(id);
    if (!metric) {
      return;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.success = success;
    metric.error = error;

    // 获取内存使用情况
    if (process.memoryUsage) {
      metric.memoryUsage = process.memoryUsage().heapUsed;
    }

    this.emit('executionEnded', {
      id,
      name,
      type,
      duration: metric.duration,
      success,
      error,
    });
  }

  /**
   * 获取指标
   */
  getMetric(id: string): PerformanceMetric | undefined {
    return this.metrics.get(id);
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * 获取性能统计
   */
  getStats(): PerformanceStats {
    const allMetrics = Array.from(this.metrics.values());

    if (allMetrics.length === 0) {
      return {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        totalDuration: 0,
        recentMetrics: [],
        byType: {},
      };
    }

    const completedMetrics = allMetrics.filter(m => m.duration !== undefined);
    const successfulMetrics = completedMetrics.filter(m => m.success);
    const failedMetrics = completedMetrics.filter(m => !m.success);

    const durations = completedMetrics.map(m => m.duration || 0);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    // 按类型分组统计
    const byType: Record<string, {
      count: number;
      totalDuration: number;
      successCount: number;
    }> = {};

    for (const metric of completedMetrics) {
      if (!byType[metric.type]) {
        byType[metric.type] = {
          count: 0,
          totalDuration: 0,
          successCount: 0,
        };
      }
      byType[metric.type].count++;
      byType[metric.type].totalDuration += metric.duration || 0;
      if (metric.success) {
        byType[metric.type].successCount++;
      }
    }

    // 计算每类型的平均值和成功率
    const byTypeStats: Record<string, {
      count: number;
      averageDuration: number;
      successRate: number;
    }> = {};

    for (const [type, stats] of Object.entries(byType)) {
      byTypeStats[type] = {
        count: stats.count,
        averageDuration: stats.totalDuration / stats.count,
        successRate: (stats.successCount / stats.count) * 100,
      };
    }

    return {
      totalExecutions: completedMetrics.length,
      successfulExecutions: successfulMetrics.length,
      failedExecutions: failedMetrics.length,
      averageDuration: completedMetrics.length > 0 ? totalDuration / completedMetrics.length : 0,
      minDuration: durations.length > 0 ? Math.min(...durations) : 0,
      maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
      totalDuration,
      recentMetrics: completedMetrics.slice(-10),
      byType: byTypeStats,
    };
  }

  /**
   * 获取慢执行
   */
  getSlowExecutions(thresholdMs: number = 30000): PerformanceMetric[] {
    return Array.from(this.metrics.values())
      .filter(m => m.duration && m.duration > thresholdMs)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }

  /**
   * 获取失败执行
   */
  getFailedExecutions(): PerformanceMetric[] {
    return Array.from(this.metrics.values())
      .filter(m => !m.success && m.duration !== undefined)
      .sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
  }

  /**
   * 并行执行任务
   */
  async executeParallel(
    tasks: Array<() => Promise<any>>,
    maxConcurrent?: number
  ): Promise<any[]> {
    const max = maxConcurrent || this.maxConcurrent;
    const results: any[] = [];
    const executing: Promise<any>[] = [];

    for (const task of tasks) {
      if (executing.length >= max) {
        const completed = await Promise.race(executing);
        const index = executing.findIndex(p => p === completed);
        if (index !== -1) {
          executing.splice(index, 1);
        }
      }

      const promise = task().then(result => {
        results.push(result);
        return promise;
      });

      executing.push(promise);
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * 批量执行任务
   */
  async executeBatch(
    tasks: Array<() => Promise<any>>,
    batchSize: number = 10
  ): Promise<any[]> {
    const results: any[] = [];

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(task => task()));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * 清理旧指标
   */
  cleanupOldMetrics(olderThanMs: number = 3600000): number {
    const cutoffTime = Date.now() - olderThanMs;
    let count = 0;

    for (const [id, metric] of this.metrics.entries()) {
      if (metric.startTime < cutoffTime) {
        this.metrics.delete(id);
        count++;
      }
    }

    return count;
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(): string {
    const stats = this.getStats();

    let report = '=== 钩子性能报告 ===\n\n';
    report += `总执行次数: ${stats.totalExecutions}\n`;
    report += `成功次数: ${stats.successfulExecutions}\n`;
    report += `失败次数: ${stats.failedExecutions}\n`;
    report += `成功率: ${stats.totalExecutions > 0 ? ((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(2) : 0}%\n\n`;

    report += `平均执行时间: ${(stats.averageDuration / 1000).toFixed(2)}秒\n`;
    report += `最短执行时间: ${(stats.minDuration / 1000).toFixed(2)}秒\n`;
    report += `最长执行时间: ${(stats.maxDuration / 1000).toFixed(2)}秒\n\n`;

    if (Object.keys(stats.byType).length > 0) {
      report += '=== 按类型统计 ===\n\n';
      for (const [type, typeStats] of Object.entries(stats.byType)) {
        report += `${type}:\n`;
        report += `  执行次数: ${typeStats.count}\n`;
        report += `  平均时间: ${(typeStats.averageDuration / 1000).toFixed(2)}秒\n`;
        report += `  成功率: ${typeStats.successRate.toFixed(2)}%\n\n`;
      }
    }

    // 检查慢执行
    const slowExecutions = this.getSlowExecutions();
    if (slowExecutions.length > 0) {
      report += '=== 慢执行 (>30秒) ===\n\n';
      for (const metric of slowExecutions.slice(0, 5)) {
        report += `${metric.name} (${metric.type}): ${((metric.duration || 0) / 1000).toFixed(2)}秒\n`;
      }
      report += '\n';
    }

    // 检查失败执行
    const failedExecutions = this.getFailedExecutions();
    if (failedExecutions.length > 0) {
      report += '=== 失败执行 ===\n\n';
      for (const metric of failedExecutions.slice(0, 5)) {
        report += `${metric.name} (${metric.type}): ${metric.error || 'Unknown error'}\n`;
      }
      report += '\n';
    }

    return report;
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.metrics.clear();
    this.executionQueue = [];
    this.runningCount = 0;
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
PerformanceManager.instance = new PerformanceManager();

export { PerformanceManager };
export const performanceManager = PerformanceManager.getInstance();
