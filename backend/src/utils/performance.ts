/**
 * 性能优化工具和监控模块
 * 提供性能监控、分析和优化工具
 */

import { logger } from './log';

/**
 * 性能指标
 */
interface PerformanceMetrics {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * 性能统计
 */
interface PerformanceStats {
  count: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
}

/**
 * 性能监控器类
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceMetrics[]> = new Map();
  private stats: Map<string, PerformanceStats> = new Map();
  private enabled: boolean = true;

  /**
   * 私有构造函数
   */
  private constructor() {}

  /**
   * 获取性能监控器实例
   * @returns 性能监控器实例
   */
  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * 启用性能监控
   */
  enable(): void {
    this.enabled = true;
    logger.info('Performance monitor enabled');
  }

  /**
   * 禁用性能监控
   */
  disable(): void {
    this.enabled = false;
    logger.info('Performance monitor disabled');
  }

  /**
   * 记录性能指标
   * @param name 名称
   * @param duration 持续时间（毫秒）
   * @param metadata 元数据
   */
  recordMetric(
    name: string,
    duration: number,
    metadata?: Record<string, any>
  ): void {
    if (!this.enabled) {
      return;
    }

    const metric: PerformanceMetrics = {
      name,
      duration,
      timestamp: Date.now(),
      metadata,
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name)!;
    metrics.push(metric);

    // 限制存储的指标数量
    if (metrics.length > 1000) {
      metrics.shift();
    }

    // 更新统计信息
    this.updateStats(name, duration);

    logger.debug('Performance metric recorded', {
      name,
      duration: `${duration.toFixed(2)} ms`,
    });
  }

  /**
   * 更新统计信息
   * @param name 名称
   * @param duration 持续时间
   */
  private updateStats(name: string, duration: number): void {
    let stats = this.stats.get(name);

    if (!stats) {
      stats = {
        count: 0,
        totalDuration: 0,
        minDuration: duration,
        maxDuration: duration,
        avgDuration: 0,
      };
      this.stats.set(name, stats);
    }

    stats.count++;
    stats.totalDuration += duration;
    stats.minDuration = Math.min(stats.minDuration, duration);
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.avgDuration = stats.totalDuration / stats.count;
  }

  /**
   * 获取统计信息
   * @param name 名称
   * @returns 统计信息
   */
  getStats(name: string): PerformanceStats | undefined {
    return this.stats.get(name);
  }

  /**
   * 获取所有统计信息
   * @returns 所有统计信息
   */
  getAllStats(): Map<string, PerformanceStats> {
    return new Map(this.stats);
  }

  /**
   * 清除指标
   * @param name 名称
   */
  clearMetrics(name?: string): void {
    if (name) {
      this.metrics.delete(name);
      this.stats.delete(name);
      logger.debug('Performance metrics cleared', { name });
    } else {
      this.metrics.clear();
      this.stats.clear();
      logger.debug('All performance metrics cleared');
    }
  }

  /**
   * 获取性能报告
   * @returns 性能报告
   */
  getReport(): string {
    const lines: string[] = ['Performance Report:', ''];

    for (const [name, stats] of this.stats.entries()) {
      lines.push(`  ${name}:`);
      lines.push(`    Count: ${stats.count}`);
      lines.push(`    Total: ${stats.totalDuration.toFixed(2)} ms`);
      lines.push(`    Average: ${stats.avgDuration.toFixed(2)} ms`);
      lines.push(`    Min: ${stats.minDuration.toFixed(2)} ms`);
      lines.push(`    Max: ${stats.maxDuration.toFixed(2)} ms`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * 性能计时器类
 */
export class PerformanceTimer {
  private name: string;
  private startTime: number;
  private metadata?: Record<string, any>;
  private monitor: PerformanceMonitor;

  /**
   * 构造函数
   * @param name 名称
   * @param metadata 元数据
   */
  constructor(name: string, metadata?: Record<string, any>) {
    this.name = name;
    this.startTime = Date.now();
    this.metadata = metadata;
    this.monitor = PerformanceMonitor.getInstance();
  }

  /**
   * 停止计时并记录
   * @returns 持续时间（毫秒）
   */
  stop(): number {
    const duration = Date.now() - this.startTime;
    this.monitor.recordMetric(this.name, duration, this.metadata);
    return duration;
  }

  /**
   * 获取当前持续时间
   * @returns 当前持续时间（毫秒）
   */
  getElapsed(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * 性能分析器类
 */
export class PerformanceAnalyzer {
  private monitor: PerformanceMonitor;

  /**
   * 构造函数
   */
  constructor() {
    this.monitor = PerformanceMonitor.getInstance();
  }

  /**
   * 分析性能瓶颈
   * @param name 名称
   * @returns 分析结果
   */
  analyzeBottleneck(name: string): {
    isBottleneck: boolean;
    reason: string;
    suggestions: string[];
  } {
    const stats = this.monitor.getStats(name);

    if (!stats) {
      return {
        isBottleneck: false,
        reason: 'No metrics available',
        suggestions: [],
      };
    }

    const suggestions: string[] = [];
    let isBottleneck = false;
    let reason = '';

    // 检查平均持续时间
    if (stats.avgDuration > 1000) {
      isBottleneck = true;
      reason = 'Average duration exceeds 1000ms';
      suggestions.push('Consider caching results');
      suggestions.push('Optimize algorithm or data structure');
    }

    // 检查最大持续时间
    if (stats.maxDuration > 5000) {
      isBottleneck = true;
      reason = reason || 'Maximum duration exceeds 5000ms';
      suggestions.push('Investigate outliers');
      suggestions.push('Consider async processing');
    }

    // 检查持续时间波动
    const variance = stats.maxDuration - stats.minDuration;
    if (variance > stats.avgDuration) {
      isBottleneck = true;
      reason = reason || 'High variance in duration';
      suggestions.push('Check for inconsistent data sizes');
      suggestions.push('Monitor resource usage');
    }

    return {
      isBottleneck,
      reason,
      suggestions,
    };
  }

  /**
   * 生成优化建议
   * @returns 优化建议
   */
  generateOptimizationSuggestions(): string[] {
    const suggestions: string[] = [];
    const allStats = this.monitor.getAllStats();

    for (const [name, stats] of allStats.entries()) {
      const analysis = this.analyzeBottleneck(name);

      if (analysis.isBottleneck) {
        suggestions.push(`\n${name}:`);
        suggestions.push(`  Issue: ${analysis.reason}`);
        analysis.suggestions.forEach((suggestion) => {
          suggestions.push(`  - ${suggestion}`);
        });
      }
    }

    return suggestions;
  }
}

/**
 * 性能装饰器
 */
export function measurePerformance(name?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const methodName = name || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const timer = new PerformanceTimer(methodName);

      try {
        const result = await originalMethod.apply(this, args);
        timer.stop();
        return result;
      } catch (error) {
        timer.stop();
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 性能工具函数
 */
export const performanceUtils = {
  /**
   * 创建性能计时器
   * @param name 名称
   * @param metadata 元数据
   * @returns 性能计时器
   */
  startTimer: (name: string, metadata?: Record<string, any>) => {
    return new PerformanceTimer(name, metadata);
  },

  /**
   * 记录性能指标
   * @param name 名称
   * @param duration 持续时间
   * @param metadata 元数据
   */
  recordMetric: (
    name: string,
    duration: number,
    metadata?: Record<string, any>
  ) => {
    const monitor = PerformanceMonitor.getInstance();
    monitor.recordMetric(name, duration, metadata);
  },

  /**
   * 获取性能统计
   * @param name 名称
   * @returns 性能统计
   */
  getStats: (name: string) => {
    const monitor = PerformanceMonitor.getInstance();
    return monitor.getStats(name);
  },

  /**
   * 获取性能报告
   * @returns 性能报告
   */
  getReport: () => {
    const monitor = PerformanceMonitor.getInstance();
    return monitor.getReport();
  },

  /**
   * 分析性能瓶颈
   * @param name 名称
   * @returns 分析结果
   */
  analyzeBottleneck: (name: string) => {
    const analyzer = new PerformanceAnalyzer();
    return analyzer.analyzeBottleneck(name);
  },

  /**
   * 生成优化建议
   * @returns 优化建议
   */
  generateOptimizationSuggestions: () => {
    const analyzer = new PerformanceAnalyzer();
    return analyzer.generateOptimizationSuggestions();
  },
};

// 导出全局实例
export const performanceMonitor = PerformanceMonitor.getInstance();
