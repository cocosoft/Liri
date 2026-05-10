/**
 * 启动性能分析器
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import fs from 'fs';
import path from 'path';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 性能指标
 */
export interface PerformanceMetric {
  /** 指标名称 */
  name: string;
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime: number;
  /** 持续时间（毫秒） */
  duration: number;
  /** 额外数据 */
  data?: Record<string, any>;
}

/**
 * 内存快照
 */
export interface MemorySnapshot {
  /** 快照时间戳 */
  timestamp: number;
  /** 堆内存使用情况 */
  heapUsed: number;
  /** 堆内存总量 */
  heapTotal: number;
  /** 外部内存使用情况 */
  external: number;
  /** RSS内存使用情况 */
  rss: number;
  /** 快照标签 */
  label?: string;
  /** 模块信息 */
  modules?: Array<{
    name: string;
    size: number;
  }>;
}

/**
 * 启动性能报告
 */
export interface StartupPerformanceReport {
  /** 启动开始时间 */
  startTime: number;
  /** 启动结束时间 */
  endTime: number;
  /** 总启动时间 */
  totalTime: number;
  /** 性能指标 */
  metrics: PerformanceMetric[];
  /** 内存快照 */
  memorySnapshots: MemorySnapshot[];
  /** 模块加载信息 */
  moduleLoadInfo: Array<{
    name: string;
    loadTime: number;
    size: number;
  }>;
  /** 环境信息 */
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: number;
    totalMemory: number;
  };
}

/**
 * 启动性能分析器
 */
export class StartupPerformanceAnalyzer {
  private metrics: PerformanceMetric[];
  private memorySnapshots: MemorySnapshot[];
  private moduleLoadTimes: Map<string, number>;
  private startTime: number;
  private endTime: number | null;
  private isRunning: boolean;

  constructor() {
    this.metrics = [];
    this.memorySnapshots = [];
    this.moduleLoadTimes = new Map();
    this.startTime = Date.now();
    this.endTime = null;
    this.isRunning = true;

    // 记录初始内存快照
    this.takeMemorySnapshot('initial');
  }

  /**
   * 开始性能指标计时
   */
  startMetric(name: string): () => void {
    if (!this.isRunning) {
      return () => {};
    }

    const startTime = Date.now();

    return () => {
      if (!this.isRunning) return;

      const endTime = Date.now();
      this.metrics.push({
        name,
        startTime,
        endTime,
        duration: endTime - startTime,
      });
    };
  }

  /**
   * 记录性能指标
   */
  recordMetric(
    name: string,
    duration: number,
    data?: Record<string, any>
  ): void {
    if (!this.isRunning) return;

    const now = Date.now();
    this.metrics.push({
      name,
      startTime: now - duration,
      endTime: now,
      duration,
      data,
    });
  }

  /**
   * 记录模块加载时间
   */
  recordModuleLoad(name: string, loadTime: number, size?: number): void {
    if (!this.isRunning) return;

    this.moduleLoadTimes.set(name, loadTime);
  }

  /**
   * 拍摄内存快照
   */
  takeMemorySnapshot(label?: string): void {
    if (!this.isRunning) return;

    try {
      const memoryUsage = process.memoryUsage();
      const snapshot: MemorySnapshot = {
        timestamp: Date.now(),
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      };

      if (label) {
        snapshot.label = label;
      }

      this.memorySnapshots.push(snapshot);
    } catch (error) {
      logger.error('Error taking memory snapshot:', error);
    }
  }

  /**
   * 结束分析
   */
  end(): void {
    if (!this.isRunning) return;

    this.endTime = Date.now();
    this.isRunning = false;

    // 记录最终内存快照
    this.takeMemorySnapshot('final');
  }

  /**
   * 生成报告
   */
  generateReport(): StartupPerformanceReport {
    const endTime = this.endTime || Date.now();
    const totalTime = endTime - this.startTime;

    // 构建模块加载信息
    const moduleLoadInfo = Array.from(this.moduleLoadTimes.entries()).map(
      ([name, loadTime]) => ({
        name,
        loadTime,
        size: 0, // 暂时设为0，实际应用中可以获取模块大小
      })
    );

    return {
      startTime: this.startTime,
      endTime,
      totalTime,
      metrics: this.metrics.sort((a, b) => a.startTime - b.startTime),
      memorySnapshots: this.memorySnapshots,
      moduleLoadInfo,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: require('os').cpus().length,
        totalMemory: require('os').totalmem(),
      },
    };
  }

  /**
   * 保存报告到文件
   */
  saveReport(outputDir: string = './performance'): string {
    const report = this.generateReport();

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `startup-performance-${timestamp}.json`;
    const filePath = path.join(outputDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    return filePath;
  }

  /**
   * 打印摘要
   */
  printSummary(): void {
    const report = this.generateReport();

    const lines: string[] = [
      '=== Startup Performance Summary ===',
      `Total startup time: ${report.totalTime.toFixed(2)}ms`,
      '',
      'Top metrics:',
    ];

    const topMetrics = [...report.metrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);
    topMetrics.forEach((metric, index) => {
      lines.push(
        `${index + 1}. ${metric.name}: ${metric.duration.toFixed(2)}ms`
      );
    });

    lines.push('');
    lines.push('Memory usage:');
    const finalSnapshot =
      report.memorySnapshots[report.memorySnapshots.length - 1];
    if (finalSnapshot) {
      lines.push(
        `  Heap used: ${(finalSnapshot.heapUsed / 1024 / 1024).toFixed(2)}MB`
      );
      lines.push(
        `  Heap total: ${(finalSnapshot.heapTotal / 1024 / 1024).toFixed(2)}MB`
      );
      lines.push(`  RSS: ${(finalSnapshot.rss / 1024 / 1024).toFixed(2)}MB`);
    }

    lines.push('');
    lines.push(`Module count: ${report.moduleLoadInfo.length}`);

    logger.info(lines.join('\n'));
  }
}

/**
 * 全局启动性能分析器实例
 */
let globalAnalyzer: StartupPerformanceAnalyzer | null = null;

/**
 * 获取全局启动性能分析器
 */
export function getStartupAnalyzer(): StartupPerformanceAnalyzer {
  if (!globalAnalyzer) {
    globalAnalyzer = new StartupPerformanceAnalyzer();
  }
  return globalAnalyzer;
}

/**
 * 重置全局启动性能分析器
 */
export function resetStartupAnalyzer(): StartupPerformanceAnalyzer {
  globalAnalyzer = new StartupPerformanceAnalyzer();
  return globalAnalyzer;
}

/**
 * 便捷函数：记录模块加载时间
 */
export function recordModuleLoad(
  name: string,
  loadTime: number,
  size?: number
): void {
  getStartupAnalyzer().recordModuleLoad(name, loadTime, size);
}

/**
 * 便捷函数：开始性能指标计时
 */
export function startMetric(name: string): () => void {
  return getStartupAnalyzer().startMetric(name);
}

/**
 * 便捷函数：记录性能指标
 */
export function recordMetric(
  name: string,
  duration: number,
  data?: Record<string, any>
): void {
  getStartupAnalyzer().recordMetric(name, duration, data);
}

/**
 * 便捷函数：拍摄内存快照
 */
export function takeMemorySnapshot(label?: string): void {
  getStartupAnalyzer().takeMemorySnapshot(label);
}

/**
 * 便捷函数：结束分析并生成报告
 */
export function endStartupAnalysis(): StartupPerformanceReport {
  const analyzer = getStartupAnalyzer();
  analyzer.end();
  return analyzer.generateReport();
}

/**
 * 便捷函数：保存启动分析报告
 */
export function saveStartupReport(outputDir?: string): string {
  const analyzer = getStartupAnalyzer();
  if (analyzer['isRunning']) {
    analyzer.end();
  }
  return analyzer.saveReport(outputDir);
}

/**
 * 便捷函数：打印启动分析摘要
 */
export function printStartupSummary(): void {
  const analyzer = getStartupAnalyzer();
  if (analyzer['isRunning']) {
    analyzer.end();
  }
  analyzer.printSummary();
}
