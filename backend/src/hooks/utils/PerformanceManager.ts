/**
 * 性能管理器
 * 提供钩子系统的性能监控和优化功能
 */

import { EventEmitter } from 'events';

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  hookExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  maxExecutionTime: number;
  minExecutionTime: number;
  memoryUsage: number;
  concurrencyLevel: number;
}

/**
 * 性能记录
 */
export interface PerformanceRecord {
  hookId: string;
  hookName: string;
  hookType: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
}

/**
 * 性能管理器类
 */
export class PerformanceManager extends EventEmitter {
  private static instance: PerformanceManager;
  private records: PerformanceRecord[] = [];
  private metrics: PerformanceMetrics = {
    hookExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalExecutionTime: 0,
    averageExecutionTime: 0,
    maxExecutionTime: 0,
    minExecutionTime: Infinity,
    memoryUsage: 0,
    concurrencyLevel: 0,
  };
  private activeExecutions: Set<string> = new Set();
  private maxConcurrency: number = 0;

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
   * 记录Hook开始执行
   */
  startExecution(hookId: string, hookName: string, hookType: string): void {
    // 更新并发计数
    this.activeExecutions.add(hookId);
    this.metrics.concurrencyLevel = this.activeExecutions.size;
    this.maxConcurrency = Math.max(this.maxConcurrency, this.metrics.concurrencyLevel);

    // 记录内存使用
    this.metrics.memoryUsage = process.memoryUsage().heapUsed;

    // 触发事件
    this.emit('executionStarted', {
      hookId,
      hookName,
      hookType,
      timestamp: Date.now(),
      concurrency: this.metrics.concurrencyLevel,
    });
  }

  /**
   * 记录Hook执行完成
   */
  endExecution(hookId: string, hookName: string, hookType: string, success: boolean, error?: string): void {
    const endTime = Date.now();
    const record = this.records.find(r => r.hookId === hookId && !r.endTime);

    if (record) {
      record.endTime = endTime;
      record.duration = endTime - record.startTime;
      record.success = success;
      record.error = error;

      // 更新指标
      this.metrics.hookExecutions++;
      if (success) {
        this.metrics.successfulExecutions++;
      } else {
        this.metrics.failedExecutions++;
      }

      this.metrics.totalExecutionTime += record.duration;
      this.metrics.averageExecutionTime = this.metrics.totalExecutionTime / this.metrics.hookExecutions;
      this.metrics.maxExecutionTime = Math.max(this.metrics.maxExecutionTime, record.duration);
      this.metrics.minExecutionTime = Math.min(this.metrics.minExecutionTime, record.duration);

      // 触发事件
      this.emit('executionEnded', {
        hookId,
        hookName,
        hookType,
        duration: record.duration,
        success,
        error,
        timestamp: endTime,
      });
    }

    // 更新并发计数
    this.activeExecutions.delete(hookId);
    this.metrics.concurrencyLevel = this.activeExecutions.size;
  }

  /**
   * 获取性能指标
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取性能记录
   */
  getRecords(limit?: number): PerformanceRecord[] {
    if (limit) {
      return this.records.slice(-limit);
    }
    return [...this.records];
  }

  /**
   * 清理性能记录
   */
  cleanupRecords(maxRecords: number = 1000): void {
    if (this.records.length > maxRecords) {
      this.records = this.records.slice(-maxRecords);
    }
  }

  /**
   * 并行执行Hook
   */
  async executeParallel<T>(tasks: Array<() => Promise<T>>, maxConcurrency: number = 5): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];
    const taskQueue = [...tasks];

    while (taskQueue.length > 0 || executing.length > 0) {
      // 启动新任务
      while (executing.length < maxConcurrency && taskQueue.length > 0) {
        const task = taskQueue.shift();
        if (task) {
          const promise = task()
            .then(result => {
              results.push(result);
            })
            .finally(() => {
              const index = executing.indexOf(promise);
              if (index > -1) {
                executing.splice(index, 1);
              }
            });
          executing.push(promise);
        }
      }

      // 等待至少一个任务完成
      if (executing.length > 0) {
        await Promise.race(executing);
      }
    }

    return results;
  }

  /**
   * 批量执行Hook
   */
  async executeBatch<T>(tasks: Array<() => Promise<T>>, batchSize: number = 10): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(task => task()));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.records = [];
    this.metrics = {
      hookExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      maxExecutionTime: 0,
      minExecutionTime: Infinity,
      memoryUsage: 0,
      concurrencyLevel: 0,
    };
    this.activeExecutions.clear();
    this.maxConcurrency = 0;
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const performanceManager = PerformanceManager.getInstance();
