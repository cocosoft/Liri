//
/**
 * 内存管理工具
 * 用于监控内存使用情况，识别内存泄漏，并提供内存优化建议
 */

import { logger } from './log.js';

/**
 * 内存使用阈值
 */
export const MEMORY_THRESHOLDS = {
  WARNING: 70, // 70% 内存使用率
  CRITICAL: 90, // 90% 内存使用率
};

/**
 * 内存快照
 */
export interface MemorySnapshot {
  timestamp: number;
  rss: number; // 常驻集大小
  heapTotal: number; // 堆总量
  heapUsed: number; // 已使用堆
  external: number; // 外部内存
  arrayBuffers: number; // ArrayBuffer内存
  heap使用率: number; // 堆使用率
}

/**
 * 内存监控配置
 */
export interface MemoryMonitorConfig {
  enabled: boolean;
  interval: number; // 监控间隔（毫秒）
  maxSnapshots: number; // 最大快照数量
  logLevel: 'info' | 'warn' | 'error';
}

/**
 * 内存管理器
 */
export class MemoryManager {
  private config: MemoryMonitorConfig;
  private snapshots: MemorySnapshot[] = [];
  private monitorInterval: NodeJS.Timeout | null = null;
  private memoryLeakDetected: boolean = false;

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    this.config = {
      enabled: true,
      interval: 5000, // 5秒
      maxSnapshots: 100,
      logLevel: 'info',
      ...config,
    };
  }

  /**
   * 开始内存监控
   */
  public startMonitoring(): void {
    if (!this.config.enabled) return;

    this.monitorInterval = setInterval(() => {
      this.takeSnapshot();
      this.checkMemoryUsage();
      this.detectMemoryLeak();
    }, this.config.interval);

    logger.info('Memory monitoring started');
  }

  /**
   * 停止内存监控
   */
  public stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logger.info('Memory monitoring stopped');
    }
  }

  /**
   * 手动获取内存快照
   */
  public takeSnapshot(): MemorySnapshot {
    const memoryUsage = process.memoryUsage();
    const heap使用率 = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers,
      heap使用率,
    };

    this.snapshots.push(snapshot);

    // 保持快照数量在限制范围内
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * 检查内存使用情况
   */
  private checkMemoryUsage(): void {
    const snapshot = this.takeSnapshot();
    const totalMemory = 16 * 1024 * 1024 * 1024;
    const memoryPercentage = (snapshot.rss / totalMemory) * 100;

    if (memoryPercentage >= MEMORY_THRESHOLDS.CRITICAL) {
      logger.error(
        'Critical memory usage detected: memoryPercentage=' +
          `${memoryPercentage.toFixed(2)}%, rss=${(snapshot.rss / 1024 / 1024).toFixed(2)} MB, ` +
          `heapUsed=${(snapshot.heapUsed / 1024 / 1024).toFixed(2)} MB, ` +
          `heapTotal=${(snapshot.heapTotal / 1024 / 1024).toFixed(2)} MB`
      );
    } else if (memoryPercentage >= MEMORY_THRESHOLDS.WARNING) {
      logger.warn(
        'Warning: High memory usage detected: memoryPercentage=' +
          `${memoryPercentage.toFixed(2)}%, rss=${(snapshot.rss / 1024 / 1024).toFixed(2)} MB, ` +
          `heapUsed=${(snapshot.heapUsed / 1024 / 1024).toFixed(2)} MB, ` +
          `heapTotal=${(snapshot.heapTotal / 1024 / 1024).toFixed(2)} MB`
      );
    } else if (this.config.logLevel === 'info') {
      logger.debug(
        'Memory usage: memoryPercentage=' +
          `${memoryPercentage.toFixed(2)}%, rss=${(snapshot.rss / 1024 / 1024).toFixed(2)} MB, ` +
          `heapUsed=${(snapshot.heapUsed / 1024 / 1024).toFixed(2)} MB, ` +
          `heapTotal=${(snapshot.heapTotal / 1024 / 1024).toFixed(2)} MB`
      );
    }
  }

  /**
   * 检测内存泄漏
   */
  private detectMemoryLeak(): void {
    if (this.snapshots.length < 5) return;

    // 计算最近5个快照的内存增长趋势
    const recentSnapshots = this.snapshots.slice(-5);
    const memoryGrowth =
      recentSnapshots[recentSnapshots.length - 1].heapUsed -
      recentSnapshots[0].heapUsed;
    const timeElapsed =
      recentSnapshots[recentSnapshots.length - 1].timestamp -
      recentSnapshots[0].timestamp;

    // 如果内存持续增长且增长速度超过阈值，可能存在内存泄漏
    if (memoryGrowth > 10 * 1024 * 1024 && timeElapsed > 10000) {
      const growthRate = (memoryGrowth / timeElapsed) * 1000;
      const lastSnapshot = recentSnapshots[recentSnapshots.length - 1];

      if (growthRate > 1024 * 1024) {
        if (!this.memoryLeakDetected) {
          this.memoryLeakDetected = true;
          logger.error(
            'Possible memory leak detected: growthRate=' +
              `${(growthRate / 1024 / 1024).toFixed(2)} MB/s, currentHeapUsed=` +
              `${(lastSnapshot.heapUsed / 1024 / 1024).toFixed(2)} MB, timeElapsed=` +
              `${(timeElapsed / 1000).toFixed(2)} seconds`
          );
        }
      }
    } else {
      this.memoryLeakDetected = false;
    }
  }

  /**
   * 获取内存使用趋势
   */
  public getMemoryTrend(): MemorySnapshot[] {
    return this.snapshots;
  }

  /**
   * 生成内存使用报告
   */
  public generateReport(): string {
    if (this.snapshots.length === 0) {
      return 'No memory snapshots recorded';
    }

    const lines: string[] = [];
    lines.push('='.repeat(80));
    lines.push('MEMORY USAGE REPORT');
    lines.push('='.repeat(80));
    lines.push('');

    // 最新快照
    const latestSnapshot = this.snapshots[this.snapshots.length - 1];
    lines.push('Latest Snapshot:');
    lines.push(
      `Timestamp: ${new Date(latestSnapshot.timestamp).toISOString()}`
    );
    lines.push(`RSS: ${(latestSnapshot.rss / 1024 / 1024).toFixed(2)} MB`);
    lines.push(
      `Heap Total: ${(latestSnapshot.heapTotal / 1024 / 1024).toFixed(2)} MB`
    );
    lines.push(
      `Heap Used: ${(latestSnapshot.heapUsed / 1024 / 1024).toFixed(2)} MB`
    );
    lines.push(`Heap Usage: ${latestSnapshot.heap使用率.toFixed(2)}%`);
    lines.push(
      `External: ${(latestSnapshot.external / 1024 / 1024).toFixed(2)} MB`
    );
    lines.push(
      `Array Buffers: ${(latestSnapshot.arrayBuffers / 1024 / 1024).toFixed(2)} MB`
    );
    lines.push('');

    // 内存趋势
    if (this.snapshots.length > 1) {
      lines.push('Memory Trend (last 10 snapshots):');
      const trendSnapshots = this.snapshots.slice(-10);
      trendSnapshots.forEach((snapshot, index) => {
        const time = new Date(snapshot.timestamp).toLocaleTimeString();
        lines.push(
          `${time}: ${(snapshot.heapUsed / 1024 / 1024).toFixed(2)} MB (${snapshot.heap使用率.toFixed(1)}%)`
        );
      });
      lines.push('');
    }

    // 内存泄漏检测
    lines.push('Memory Leak Detection:');
    lines.push(
      this.memoryLeakDetected
        ? 'WARNING: Possible memory leak detected!'
        : 'No memory leak detected.'
    );
    lines.push('');

    // 优化建议
    lines.push('Optimization Suggestions:');
    if (latestSnapshot.heap使用率 > 70) {
      lines.push('- Consider using streaming for large data processing');
      lines.push('- Check for unclosed resources (files, connections)');
      lines.push('- Use weak references for cache when possible');
      lines.push('- Avoid storing large objects in memory unnecessarily');
    } else {
      lines.push('- Memory usage is within acceptable limits');
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * 清理内存
   */
  public cleanupMemory(): void {
    // 手动触发垃圾回收（如果可用）
    if (global.gc) {
      try {
        const before = process.memoryUsage();
        global.gc();
        const after = process.memoryUsage();
        const freed = before.heapUsed - after.heapUsed;
        logger.info(
          `Garbage collection freed ${(freed / 1024 / 1024).toFixed(2)} MB`
        );
      } catch (error) {
        logger.warn(
          'Garbage collection failed:',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } else {
      logger.warn(
        'Garbage collection is not enabled. Run with --expose-gc flag.'
      );
    }
  }
}

/**
 * 全局内存管理器实例
 */
export const memoryManager = new MemoryManager();

/**
 * 内存使用装饰器
 * 用于监控函数的内存使用情况
 */
export function monitorMemory() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startMemory = process.memoryUsage();
      const startTime = performance.now();

      try {
        return await originalMethod.apply(this, args);
      } finally {
        const endMemory = process.memoryUsage();
        const endTime = performance.now();
        const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
        const timeTaken = endTime - startTime;

        logger.debug(`Memory usage for ${propertyKey}:`, {
          memoryUsed: `${(memoryUsed / 1024 / 1024).toFixed(2)} MB`,
          timeTaken: `${timeTaken.toFixed(2)} ms`,
        });
      }
    };
  };
}
