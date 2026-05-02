/**
 * 性能监控服务
 * 提供操作耗时统计和性能瓶颈分析功能
 * 参考CC源码: cc_code/backend/services/analytics/firstPartyEventLogger.ts
 */

import { EventEmitter } from 'events';

/**
 * 性能指标
 */
export interface PerformanceMetric {
  operationName: string;
  duration: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}

/**
 * 性能统计
 */
export interface PerformanceStats {
  operationName: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
}

/**
 * 性能监控服务类
 */
export class PerformanceMonitorService extends EventEmitter {
  private static instance: PerformanceMonitorService;
  private metrics: PerformanceMetric[] = [];
  private maxMetrics: number = 10000;
  private activeOperations: Map<string, number> = new Map();

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PerformanceMonitorService {
    if (!PerformanceMonitorService.instance) {
      PerformanceMonitorService.instance = new PerformanceMonitorService();
    }
    return PerformanceMonitorService.instance;
  }

  /**
   * 开始操作计时
   * @param operationId 操作ID
   * @returns 开始时间戳
   */
  startOperation(operationId: string): number {
    const startTime = Date.now();
    this.activeOperations.set(operationId, startTime);
    return startTime;
  }

  /**
   * 结束操作计时
   * @param operationId 操作ID
   * @param operationName 操作名称
   * @param metadata 元数据
   * @param success 是否成功
   * @param errorMessage 错误消息
   * @returns 性能指标
   */
  endOperation(
    operationId: string,
    operationName: string,
    metadata?: Record<string, unknown>,
    success: boolean = true,
    errorMessage?: string
  ): PerformanceMetric | null {
    const startTime = this.activeOperations.get(operationId);
    if (startTime === undefined) {
      return null;
    }

    this.activeOperations.delete(operationId);

    const endTime = Date.now();
    const duration = endTime - startTime;

    const metric: PerformanceMetric = {
      operationName,
      duration,
      startTime,
      endTime,
      metadata,
      success,
      errorMessage,
    };

    this.addMetric(metric);

    return metric;
  }

  /**
   * 测量同步操作
   * @param operationName 操作名称
   * @param fn 要测量的函数
   * @param metadata 元数据
   * @returns 函数结果
   */
  measureSync<T>(
    operationName: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const operationId = `${operationName}_${Date.now()}_${Math.random()}`;
    this.startOperation(operationId);

    try {
      const result = fn();
      this.endOperation(operationId, operationName, metadata, true);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.endOperation(operationId, operationName, metadata, false, errorMessage);
      throw error;
    }
  }

  /**
   * 测量异步操作
   * @param operationName 操作名称
   * @param fn 要测量的异步函数
   * @param metadata 元数据
   * @returns Promise结果
   */
  async measureAsync<T>(
    operationName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const operationId = `${operationName}_${Date.now()}_${Math.random()}`;
    this.startOperation(operationId);

    try {
      const result = await fn();
      this.endOperation(operationId, operationName, metadata, true);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.endOperation(operationId, operationName, metadata, false, errorMessage);
      throw error;
    }
  }

  /**
   * 添加性能指标
   */
  private addMetric(metric: PerformanceMetric): void {
    if (this.metrics.length >= this.maxMetrics) {
      this.metrics.shift();
    }
    this.metrics.push(metric);

    this.emit('metric', metric);
  }

  /**
   * 获取所有性能指标
   */
  getAllMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * 获取指定操作的性能指标
   */
  getMetricsByOperation(operationName: string): PerformanceMetric[] {
    return this.metrics.filter((m) => m.operationName === operationName);
  }

  /**
   * 获取性能统计
   */
  getStats(operationName: string): PerformanceStats | null {
    const operationMetrics = this.getMetricsByOperation(operationName);

    if (operationMetrics.length === 0) {
      return null;
    }

    const durations = operationMetrics.map((m) => m.duration).sort((a, b) => a - b);
    const successCalls = operationMetrics.filter((m) => m.success).length;
    const failedCalls = operationMetrics.filter((m) => !m.success).length;

    return {
      operationName,
      totalCalls: operationMetrics.length,
      successCalls,
      failedCalls,
      totalDuration: durations.reduce((sum, d) => sum + d, 0),
      avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p50Duration: this.percentile(durations, 50),
      p95Duration: this.percentile(durations, 95),
      p99Duration: this.percentile(durations, 99),
    };
  }

  /**
   * 获取所有操作的统计
   */
  getAllStats(): PerformanceStats[] {
    const operationNames = new Set(this.metrics.map((m) => m.operationName));
    const stats: PerformanceStats[] = [];

    for (const operationName of operationNames) {
      const operationStats = this.getStats(operationName);
      if (operationStats) {
        stats.push(operationStats);
      }
    }

    return stats;
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  /**
   * 清除所有指标
   */
  clearMetrics(): void {
    this.metrics = [];
    this.activeOperations.clear();
  }

  /**
   * 获取慢操作
   * @param thresholdMs 阈值（毫秒）
   * @returns 慢操作列表
   */
  getSlowOperations(thresholdMs: number): PerformanceMetric[] {
    return this.metrics.filter((m) => m.duration > thresholdMs);
  }

  /**
   * 获取失败操作
   * @returns 失败操作列表
   */
  getFailedOperations(): PerformanceMetric[] {
    return this.metrics.filter((m) => !m.success);
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.clearMetrics();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const performanceMonitorService = PerformanceMonitorService.getInstance();
