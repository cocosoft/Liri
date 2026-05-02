/**
 * 内存快照服务
 * 用于在应用启动和运行过程中捕获内存使用情况
 */

import path from 'path';
import fs from 'fs';

/**
 * 内存快照配置
 */
export interface MemorySnapshotConfig {
  enabled: boolean;
  captureInterval: number;
  maxSnapshots: number;
  snapshotPath: string;
  includeProcessInfo: boolean;
  includeSystemInfo: boolean;
  captureOnStartup: boolean;
  captureOnShutdown: boolean;
}

/**
 * 内存快照数据
 */
export interface MemorySnapshot {
  id: string;
  timestamp: number;
  memory: NodeJS.MemoryUsage;
  processInfo?: {
    pid: number;
    title: string;
    version: string;
    env: string;
  };
  systemInfo?: {
    platform: string;
    arch: string;
    totalMemory: number;
    freeMemory: number;
  };
  duration?: number;
  reason?: string;
}

/**
 * 内存快照统计
 */
export interface MemorySnapshotStats {
  totalSnapshots: number;
  averageHeapUsed: number;
  maxHeapUsed: number;
  minHeapUsed: number;
  averageHeapTotal: number;
  maxHeapTotal: number;
  minHeapTotal: number;
  averageRss: number;
  maxRss: number;
  minRss: number;
  growthRate: number; // 内存增长率
}

/**
 * 内存快照服务
 */
export class MemorySnapshotService {
  private static instance: MemorySnapshotService;
  private config: MemorySnapshotConfig;
  private snapshots: MemorySnapshot[] = [];
  private captureTimer: NodeJS.Timeout | null = null;
  private startTime: number;
  private initialMemory: NodeJS.MemoryUsage | null = null;

  private constructor() {
    this.config = {
      enabled: true,
      captureInterval: 60000, // 1分钟
      maxSnapshots: 100,
      snapshotPath: path.join(process.cwd(), 'snapshots'),
      includeProcessInfo: true,
      includeSystemInfo: true,
      captureOnStartup: true,
      captureOnShutdown: true,
    };
    this.startTime = Date.now();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): MemorySnapshotService {
    if (!MemorySnapshotService.instance) {
      MemorySnapshotService.instance = new MemorySnapshotService();
    }
    return MemorySnapshotService.instance;
  }

  /**
   * 启动服务
   */
  public start(): void {
    if (!this.config.enabled) {
      return;
    }

    if (this.config.captureOnStartup) {
      this.capture('startup');
      this.initialMemory = process.memoryUsage();
    }

    if (this.config.captureInterval > 0) {
      this.captureTimer = setInterval(() => {
        this.capture('interval');
      }, this.config.captureInterval);
    }

    if (this.config.captureOnShutdown) {
      process.on('exit', () => {
        this.capture('shutdown');
      });
    }
  }

  /**
   * 停止服务
   */
  public stop(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
  }

  /**
   * 捕获内存快照
   */
  public capture(reason?: string): MemorySnapshot {
    const memory = process.memoryUsage();
    const timestamp = Date.now();

    const snapshot: MemorySnapshot = {
      id: `snapshot_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      memory,
      reason,
    };

    if (this.config.includeProcessInfo) {
      snapshot.processInfo = {
        pid: process.pid,
        title: process.title,
        version: process.version,
        env: process.env.NODE_ENV || 'development',
      };
    }

    if (this.config.includeSystemInfo) {
      try {
        const os = require('os');
        snapshot.systemInfo = {
          platform: process.platform,
          arch: process.arch,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
        };
      } catch {
        // 忽略错误
      }
    }

    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    this.saveSnapshot(snapshot);
    this.logSnapshot(snapshot);

    return snapshot;
  }

  /**
   * 保存快照到文件
   */
  private saveSnapshot(snapshot: MemorySnapshot): void {
    try {
      if (!fs.existsSync(this.config.snapshotPath)) {
        fs.mkdirSync(this.config.snapshotPath, { recursive: true });
      }

      const filePath = path.join(this.config.snapshotPath, `${snapshot.id}.json`);
      const snapshotData = {
        ...snapshot,
        timestamp: new Date(snapshot.timestamp).toISOString(),
      };

      fs.writeFileSync(filePath, JSON.stringify(snapshotData, null, 2));
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 日志快照信息
   */
  private logSnapshot(snapshot: MemorySnapshot): void {
    const heapUsed = (snapshot.memory.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotal = (snapshot.memory.heapTotal / 1024 / 1024).toFixed(2);
    const rss = (snapshot.memory.rss / 1024 / 1024).toFixed(2);

    console.info(`[MEMORY SNAPSHOT] ${snapshot.reason || 'manual'} - Heap: ${heapUsed}MB / ${heapTotal}MB, RSS: ${rss}MB`);
  }

  /**
   * 获取所有快照
   */
  public getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * 获取最近的快照
   */
  public getLatestSnapshot(): MemorySnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * 获取快照统计
   */
  public getStatistics(): MemorySnapshotStats {
    if (this.snapshots.length === 0) {
      return {
        totalSnapshots: 0,
        averageHeapUsed: 0,
        maxHeapUsed: 0,
        minHeapUsed: 0,
        averageHeapTotal: 0,
        maxHeapTotal: 0,
        minHeapTotal: 0,
        averageRss: 0,
        maxRss: 0,
        minRss: 0,
        growthRate: 0,
      };
    }

    const heapUsedValues = this.snapshots.map(s => s.memory.heapUsed);
    const heapTotalValues = this.snapshots.map(s => s.memory.heapTotal);
    const rssValues = this.snapshots.map(s => s.memory.rss);

    const growthRate = this.initialMemory
      ? ((heapUsedValues[heapUsedValues.length - 1] - this.initialMemory.heapUsed) / this.initialMemory.heapUsed) * 100
      : 0;

    return {
      totalSnapshots: this.snapshots.length,
      averageHeapUsed: heapUsedValues.reduce((a, b) => a + b, 0) / heapUsedValues.length,
      maxHeapUsed: Math.max(...heapUsedValues),
      minHeapUsed: Math.min(...heapUsedValues),
      averageHeapTotal: heapTotalValues.reduce((a, b) => a + b, 0) / heapTotalValues.length,
      maxHeapTotal: Math.max(...heapTotalValues),
      minHeapTotal: Math.min(...heapTotalValues),
      averageRss: rssValues.reduce((a, b) => a + b, 0) / rssValues.length,
      maxRss: Math.max(...rssValues),
      minRss: Math.min(...rssValues),
      growthRate,
    };
  }

  /**
   * 生成内存报告
   */
  public generateReport(): string {
    const stats = this.getStatistics();
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('MEMORY SNAPSHOT REPORT');
    lines.push('='.repeat(80));
    lines.push('');

    lines.push('STATISTICS:');
    lines.push(`  Total snapshots: ${stats.totalSnapshots}`);
    lines.push(`  Average heap used: ${(stats.averageHeapUsed / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Max heap used: ${(stats.maxHeapUsed / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Min heap used: ${(stats.minHeapUsed / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Average heap total: ${(stats.averageHeapTotal / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Max heap total: ${(stats.maxHeapTotal / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Min heap total: ${(stats.minHeapTotal / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Average RSS: ${(stats.averageRss / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Max RSS: ${(stats.maxRss / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Min RSS: ${(stats.minRss / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`  Memory growth rate: ${stats.growthRate.toFixed(2)}%`);
    lines.push('');

    if (this.snapshots.length > 0) {
      lines.push('RECENT SNAPSHOTS:');
      this.snapshots.slice(-5).forEach(snapshot => {
        const heapUsed = (snapshot.memory.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotal = (snapshot.memory.heapTotal / 1024 / 1024).toFixed(2);
        const rss = (snapshot.memory.rss / 1024 / 1024).toFixed(2);
        
        lines.push(`  [${new Date(snapshot.timestamp).toISOString()}] ${snapshot.reason || 'unknown'}`);
        lines.push(`    Heap: ${heapUsed}MB / ${heapTotal}MB, RSS: ${rss}MB`);
      });
      lines.push('');
    }

    lines.push('='.repeat(80));
    return lines.join('\n');
  }

  /**
   * 显示内存报告
   */
  public displayReport(): void {
    console.log(this.generateReport());
  }

  /**
   * 设置配置
   */
  public setConfig(config: Partial<MemorySnapshotConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   */
  public getConfig(): MemorySnapshotConfig {
    return { ...this.config };
  }

  /**
   * 清空快照
   */
  public clear(): void {
    this.snapshots = [];
  }

  /**
   * 导出快照为JSON
   */
  public exportSnapshots(): string {
    return JSON.stringify(this.snapshots, null, 2);
  }

  /**
   * 分析内存趋势
   */
  public analyzeTrends(): {
    heapUsedTrend: 'increasing' | 'decreasing' | 'stable';
    heapTotalTrend: 'increasing' | 'decreasing' | 'stable';
    rssTrend: 'increasing' | 'decreasing' | 'stable';
    recommendations: string[];
  } {
    if (this.snapshots.length < 3) {
      return {
        heapUsedTrend: 'stable',
        heapTotalTrend: 'stable',
        rssTrend: 'stable',
        recommendations: ['Not enough data for analysis'],
      };
    }

    const heapUsedValues = this.snapshots.map(s => s.memory.heapUsed);
    const heapTotalValues = this.snapshots.map(s => s.memory.heapTotal);
    const rssValues = this.snapshots.map(s => s.memory.rss);

    const heapUsedTrend = this.calculateTrend(heapUsedValues);
    const heapTotalTrend = this.calculateTrend(heapTotalValues);
    const rssTrend = this.calculateTrend(rssValues);

    const recommendations: string[] = [];

    if (heapUsedTrend === 'increasing') {
      recommendations.push('Heap usage is increasing. Check for memory leaks.');
    }

    if (heapTotalTrend === 'increasing') {
      recommendations.push('Heap total is increasing. Consider memory limits.');
    }

    if (rssTrend === 'increasing') {
      recommendations.push('RSS is increasing. Check for external memory usage.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Memory usage is stable.');
    }

    return {
      heapUsedTrend,
      heapTotalTrend,
      rssTrend,
      recommendations,
    };
  }

  /**
   * 计算趋势
   */
  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    const first = values[0];
    const last = values[values.length - 1];
    const change = (last - first) / first * 100;

    if (change > 10) {
      return 'increasing';
    } else if (change < -10) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }
}

/**
 * 导出单例
 */
export const memorySnapshotService = MemorySnapshotService.getInstance();

/**
 * 捕获内存快照的便捷函数
 */
export function captureMemorySnapshot(reason?: string): MemorySnapshot {
  return memorySnapshotService.capture(reason);
}

/**
 * 获取内存统计
 */
export function getMemoryStatistics(): MemorySnapshotStats {
  return memorySnapshotService.getStatistics();
}

/**
 * 生成内存报告
 */
export function generateMemoryReport(): string {
  return memorySnapshotService.generateReport();
}
