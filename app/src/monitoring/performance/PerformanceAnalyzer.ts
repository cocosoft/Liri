/**
 * 性能分析器
 * 提供详细的性能分析和报告功能
 *
 * @deprecated 请使用 @modules/performance/PerformanceAnalyzer 替代。
 * 此文件为完全冗余的实现（零外部引用），与 performance/PerformanceAnalyzer.ts 功能重叠。
 * 此文件将在未来版本中移除。
 */

import chalk from 'chalk';
import { getMetricsService, MetricsService } from '../metrics/MetricsService';
import { getLogger, Logger } from '../logs/Logger';

export interface PerformanceMetrics {
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryUsage?: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  metadata?: Record<string, unknown>;
}

export interface PerformanceSnapshot {
  timestamp: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  activeOperations: number;
  completedOperations: number;
  failedOperations: number;
  averageDuration: number;
}

export interface PerformanceReport {
  generatedAt: number;
  period: {
    start: number;
    end: number;
  };
  summary: {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    averageDuration: number;
    totalDuration: number;
  };
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  slowOperations: Array<{
    operation: string;
    duration: number;
    timestamp: number;
  }>;
  recommendations: string[];
}

export class PerformanceAnalyzer {
  private metricsService: MetricsService;
  private logger: Logger;
  private activeOperations: Map<string, PerformanceMetrics>;
  private completedOperations: PerformanceMetrics[];
  private slowOperationThreshold: number;
  private maxHistorySize: number;
  private snapshots: PerformanceSnapshot[];

  constructor(metricsService?: MetricsService, logger?: Logger) {
    this.metricsService = metricsService || getMetricsService();
    this.logger = logger || getLogger();
    this.activeOperations = new Map();
    this.completedOperations = [];
    this.slowOperationThreshold = 1000;
    this.maxHistorySize = 1000;
    this.snapshots = [];
  }

  /**
   * 开始性能跟踪
   */
  startTracking(
    operationName: string,
    metadata?: Record<string, unknown>
  ): string {
    const operationId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const metrics: PerformanceMetrics = {
      operationName,
      startTime: Date.now(),
      metadata,
    };

    this.activeOperations.set(operationId, metrics);

    const counter = this.metricsService.createCounter({
      name: `performance_active_operations_${operationName}`,
      description: `Active operations for ${operationName}`,
    });
    counter.inc();

    this.logger.debug(`Started tracking operation: ${operationId}`);

    return operationId;
  }

  /**
   * 结束性能跟踪
   */
  endTracking(
    operationId: string,
    success: boolean = true
  ): PerformanceMetrics | null {
    const metrics = this.activeOperations.get(operationId);

    if (!metrics) {
      this.logger.warning(`Operation not found: ${operationId}`);
      return null;
    }

    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;

    if (metrics.duration > this.slowOperationThreshold) {
      this.logger.warning(
        `Slow operation detected: ${metrics.operationName} took ${metrics.duration}ms`
      );
    }

    this.activeOperations.delete(operationId);
    this.completedOperations.push(metrics);

    if (this.completedOperations.length > this.maxHistorySize) {
      this.completedOperations.shift();
    }

    const duration = this.metricsService.createHistogram({
      name: `performance_duration_${metrics.operationName}`,
      description: `Duration of ${metrics.operationName} operations`,
    });
    duration.observe(metrics.duration);

    if (success) {
      const successCounter = this.metricsService.createCounter({
        name: `performance_successful_${metrics.operationName}`,
        description: `Successful operations for ${metrics.operationName}`,
      });
      successCounter.inc();
    } else {
      const failCounter = this.metricsService.createCounter({
        name: `performance_failed_${metrics.operationName}`,
        description: `Failed operations for ${metrics.operationName}`,
      });
      failCounter.inc();
    }

    this.logger.debug(
      `Ended tracking operation: ${operationId}, duration: ${metrics.duration}ms`
    );

    return metrics;
  }

  /**
   * 记录内存使用
   */
  recordMemoryUsage(label: string): void {
    const memory = process.memoryUsage();

    const heapUsed = this.metricsService.createGauge({
      name: 'performance_memory_heap_used_bytes',
      description: 'Heap memory used in bytes',
    });
    heapUsed.set(memory.heapUsed);

    const heapTotal = this.metricsService.createGauge({
      name: 'performance_memory_heap_total_bytes',
      description: 'Heap memory total in bytes',
    });
    heapTotal.set(memory.heapTotal);

    const rss = this.metricsService.createGauge({
      name: 'performance_memory_rss_bytes',
      description: 'Resident set size in bytes',
    });
    rss.set(memory.rss);

    this.logger.debug(
      `[${label}] Memory - RSS: ${Math.round(memory.rss / 1024 / 1024)}MB, Heap: ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB`
    );
  }

  /**
   * 获取性能快照
   */
  getSnapshot(): PerformanceSnapshot {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();

    const completedOps = this.completedOperations.slice(-100);
    const totalDuration = completedOps.reduce(
      (sum, op) => sum + (op.duration || 0),
      0
    );
    const averageDuration =
      completedOps.length > 0 ? totalDuration / completedOps.length : 0;

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      memory,
      cpu,
      activeOperations: this.activeOperations.size,
      completedOperations: this.completedOperations.length,
      failedOperations: 0,
      averageDuration,
    };

    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxHistorySize) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * 生成性能报告
   */
  generateReport(periodMs: number = 60000): PerformanceReport {
    const now = Date.now();
    const start = now - periodMs;

    const relevantOps = this.completedOperations.filter(
      (op) => op.startTime >= start
    );

    const successfulOps = relevantOps.filter((op) => op.duration !== undefined);
    const failedOps = relevantOps.filter((op) => op.endTime === undefined);

    const totalDuration = successfulOps.reduce(
      (sum, op) => sum + (op.duration || 0),
      0
    );
    const averageDuration =
      successfulOps.length > 0 ? totalDuration / successfulOps.length : 0;

    const slowOps = successfulOps
      .filter((op) => (op.duration || 0) > this.slowOperationThreshold)
      .map((op) => ({
        operation: op.operationName,
        duration: op.duration || 0,
        timestamp: op.startTime,
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();

    const recommendations: string[] = [];

    if (memory.heapUsed / memory.heapTotal > 0.9) {
      recommendations.push(
        '内存使用率超过90%，建议检查内存泄漏或增加堆内存大小'
      );
    }

    if (slowOps.length > 5) {
      recommendations.push('检测到多个慢操作，建议进行性能优化');
    }

    if (this.activeOperations.size > 10) {
      recommendations.push('活跃操作数量过多，可能存在资源竞争问题');
    }

    if (averageDuration > 1000) {
      recommendations.push('平均操作时间过长，建议优化关键路径');
    }

    if (recommendations.length === 0) {
      recommendations.push('系统性能正常，未检测到明显问题');
    }

    return {
      generatedAt: now,
      period: { start, end: now },
      summary: {
        totalOperations: relevantOps.length,
        successfulOperations: successfulOps.length,
        failedOperations: failedOps.length,
        averageDuration,
        totalDuration,
      },
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers || 0,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
      },
      slowOperations: slowOps,
      recommendations,
    };
  }

  /**
   * 显示性能报告
   */
  displayReport(report: PerformanceReport): void {
    console.log(chalk.cyan('═'.repeat(70)));
    console.log(chalk.bold('  性能分析报告'));
    console.log(chalk.cyan('═'.repeat(70)));
    console.log();

    console.log(
      chalk.green('生成时间:'),
      new Date(report.generatedAt).toLocaleString()
    );
    console.log(
      chalk.green('统计周期:'),
      `${Math.round((report.period.end - report.period.start) / 1000)}秒`
    );
    console.log();

    console.log(chalk.yellow('─'.repeat(70)));
    console.log(chalk.bold('  操作摘要'));
    console.log(chalk.yellow('─'.repeat(70)));
    console.log(
      `  总操作数:     ${chalk.white(report.summary.totalOperations.toString())}`
    );
    console.log(
      `  成功操作:     ${chalk.green(report.summary.successfulOperations.toString())}`
    );
    console.log(
      `  失败操作:     ${chalk.red(report.summary.failedOperations.toString())}`
    );
    console.log(
      `  平均耗时:     ${chalk.cyan(Math.round(report.summary.averageDuration).toString() + 'ms')}`
    );
    console.log(
      `  总耗时:       ${chalk.cyan(Math.round(report.summary.totalDuration).toString() + 'ms')}`
    );
    console.log();

    console.log(chalk.yellow('─'.repeat(70)));
    console.log(chalk.bold('  内存使用'));
    console.log(chalk.yellow('─'.repeat(70)));
    console.log(
      `  RSS:          ${chalk.white(Math.round(report.memory.rss / 1024 / 1024).toString() + ' MB')}`
    );
    console.log(
      `  堆内存总计:   ${chalk.white(Math.round(report.memory.heapTotal / 1024 / 1024).toString() + ' MB')}`
    );
    console.log(
      `  堆内存使用:   ${chalk.cyan(Math.round(report.memory.heapUsed / 1024 / 1024).toString() + ' MB')}`
    );
    console.log(
      `  外部内存:     ${chalk.gray(Math.round(report.memory.external / 1024 / 1024).toString() + ' MB')}`
    );
    console.log();

    console.log(chalk.yellow('─'.repeat(70)));
    console.log(chalk.bold('  CPU使用'));
    console.log(chalk.yellow('─'.repeat(70)));
    console.log(
      `  用户态:       ${chalk.white(Math.round(report.cpu.user / 1000 / 1000).toString() + ' ms')}`
    );
    console.log(
      `  系统态:       ${chalk.white(Math.round(report.cpu.system / 1000 / 1000).toString() + ' ms')}`
    );
    console.log();

    if (report.slowOperations.length > 0) {
      console.log(chalk.yellow('─'.repeat(70)));
      console.log(chalk.bold('  慢操作 TOP 10'));
      console.log(chalk.yellow('─'.repeat(70)));
      report.slowOperations.forEach((op, index) => {
        console.log(
          `  ${chalk.yellow((index + 1).toString().padStart(2) + '.')} ${op.operation.padEnd(30)} ${chalk.red(op.duration.toString() + 'ms')}`
        );
      });
      console.log();
    }

    console.log(chalk.yellow('─'.repeat(70)));
    console.log(chalk.bold('  优化建议'));
    console.log(chalk.yellow('─'.repeat(70)));
    report.recommendations.forEach((rec, index) => {
      const color = rec.includes('正常') ? chalk.green : chalk.yellow;
      console.log(`  ${color('⚠')} ${rec}`);
    });
    console.log();

    console.log(chalk.cyan('═'.repeat(70)));
  }

  /**
   * 设置慢操作阈值
   */
  setSlowOperationThreshold(thresholdMs: number): void {
    this.slowOperationThreshold = thresholdMs;
    this.logger.info(`Slow operation threshold set to ${thresholdMs}ms`);
  }

  /**
   * 获取当前跟踪的操作数
   */
  getActiveOperationCount(): number {
    return this.activeOperations.size;
  }

  /**
   * 获取已完成的操作数
   */
  getCompletedOperationCount(): number {
    return this.completedOperations.length;
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.completedOperations = [];
    this.snapshots = [];
    this.logger.info('Performance history cleared');
  }
}

let performanceAnalyzerInstance: PerformanceAnalyzer | undefined;

export function getPerformanceAnalyzer(): PerformanceAnalyzer {
  if (!performanceAnalyzerInstance) {
    performanceAnalyzerInstance = new PerformanceAnalyzer();
  }
  return performanceAnalyzerInstance;
}

export function createPerformanceAnalyzer(
  metricsService?: MetricsService,
  logger?: Logger
): PerformanceAnalyzer {
  return new PerformanceAnalyzer(metricsService, logger);
}
