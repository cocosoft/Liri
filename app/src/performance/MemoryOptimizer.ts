//
/**
 * 内存优化器
 * 用于主动优化应用的内存使用，防止内存泄漏和过度使用
 */

import { memoryManager, MemorySnapshot } from './MemoryManager';
import { logForDebugging } from '../utils/debug.js';
import { getPerformanceConfig } from './PerformanceConfig.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'performance:MemoryOptimizer',
  level: LogLevel.INFO,
});

/**
 * 内存优化配置
 */
export interface MemoryOptimizationConfig {
  /** 启用自动内存优化 */
  enabled: boolean;
  /** 优化检查间隔（毫秒） */
  checkIntervalMs: number;
  /** 内存阈值（MB） */
  thresholdMb: number;
  /** 堆使用百分比阈值（%） */
  heapUsageThreshold: number;
  /** 内存增长率阈值（%） */
  growthRateThreshold: number;
  /** 自动垃圾回收阈值（%） */
  gcThreshold: number;
  /** 最大快照数量 */
  maxSnapshots: number;
  /** 最大历史数据点数量 */
  maxHistorySize: number;
}

/**
 * 内存优化器
 */
export class MemoryOptimizer {
  private optimizationInterval: NodeJS.Timeout | null = null;
  private memoryUsagePeaks: Map<string, number> = new Map();
  private memoryUsageTrends: Map<string, number[]> = new Map();
  private cleanupTasks: Set<() => Promise<void>> = new Set();
  private lastOptimizationTime: number = 0;
  private minOptimizationInterval: number = 5000; // 最小优化间隔（毫秒）

  /**
   * 开始内存优化
   */
  startOptimization(): void {
    const config = getPerformanceConfig();
    if (!config.memoryManagement.enabled) {
      logForDebugging('内存优化已禁用');
      return;
    }

    this.optimizationInterval = setInterval(() => {
      this.optimize();
    }, config.memoryManagement.checkIntervalMs);
    logForDebugging('内存优化已启动', {
      interval: config.memoryManagement.checkIntervalMs,
    });
  }

  /**
   * 停止内存优化
   */
  stopOptimization(): void {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = null;
    }
    logForDebugging('内存优化已停止');
  }

  /**
   * 执行内存优化
   */
  async optimize(): Promise<void> {
    const now = Date.now();
    // 限制优化频率
    if (now - this.lastOptimizationTime < this.minOptimizationInterval) {
      return;
    }

    try {
      const config = getPerformanceConfig() as unknown as Record<
        string,
        unknown
      >;
      const cfg = config as unknown as Record<string, Record<string, number>>;
      const snapshots = memoryManager.getSnapshots();

      if (snapshots.length === 0) {
        return;
      }

      const latestSnapshot = snapshots[snapshots.length - 1];

      // 检查内存使用情况
      this.checkMemoryUsage(latestSnapshot, config);

      // 执行清理任务
      await this.executeCleanupTasks();

      // 检测内存泄漏
      this.detectMemoryLeak(snapshots);

      // 优化内存使用
      this.optimizeMemoryUsage(latestSnapshot, snapshots, config);

      this.lastOptimizationTime = now;
    } catch (error) {
      logForDebugging(
        `内存优化执行失败: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'error' }
      );
    }
  }

  /**
   * 检查内存使用情况
   */
  private checkMemoryUsage(
    snapshot: MemorySnapshot,
    config: Record<string, unknown>
  ): void {
    const cfg = config as unknown as Record<string, Record<string, number>>;
    // 更新内存使用峰值
    this.updateMemoryPeaks(snapshot);

    // 更新内存使用趋势
    this.updateMemoryTrends(snapshot);

    // 检查内存使用是否超过阈值
    if (snapshot.memory.rss > cfg.memoryManagement.thresholdMb) {
      logForDebugging(
        `内存使用超过阈值: ${snapshot.memory.rss.toFixed(2)}MB > ${cfg.memoryManagement.thresholdMb}MB`,
        { level: 'warn' }
      );
      this.performEmergencyCleanup();
    }

    // 检查堆使用百分比是否过高
    if (snapshot.heapUsagePercent > cfg.memoryManagement.heapUsageThreshold) {
      logForDebugging(
        `堆使用百分比过高: ${snapshot.heapUsagePercent.toFixed(2)}% > ${cfg.memoryManagement.heapUsageThreshold}%`,
        { level: 'warn' }
      );
      this.forceGarbageCollection();
    }

    // 检查内存增长率是否异常
    if (
      Math.abs(snapshot.growthRate) > cfg.memoryManagement.growthRateThreshold
    ) {
      logForDebugging(
        `内存增长率异常: ${snapshot.growthRate.toFixed(2)}% > ${cfg.memoryManagement.growthRateThreshold}%`,
        { level: 'warn' }
      );
      this.analyzeMemoryGrowth();
    }
  }

  /**
   * 更新内存使用峰值
   */
  private updateMemoryPeaks(snapshot: MemorySnapshot): void {
    const memory = snapshot.memory;

    // 更新RSS峰值
    const currentRssPeak = this.memoryUsagePeaks.get('rss') || 0;
    if (memory.rss > currentRssPeak) {
      this.memoryUsagePeaks.set('rss', memory.rss);
    }

    // 更新堆使用峰值
    const currentHeapUsedPeak = this.memoryUsagePeaks.get('heapUsed') || 0;
    if (memory.heapUsed > currentHeapUsedPeak) {
      this.memoryUsagePeaks.set('heapUsed', memory.heapUsed);
    }

    // 更新外部内存峰值
    const currentExternalPeak = this.memoryUsagePeaks.get('external') || 0;
    if (memory.external > currentExternalPeak) {
      this.memoryUsagePeaks.set('external', memory.external);
    }
  }

  /**
   * 更新内存使用趋势
   */
  private updateMemoryTrends(snapshot: MemorySnapshot): void {
    const memory = snapshot.memory;
    const maxTrendPoints = 100;

    // 更新RSS趋势
    this.updateTrend('rss', memory.rss, maxTrendPoints);

    // 更新堆使用趋势
    this.updateTrend('heapUsed', memory.heapUsed, maxTrendPoints);

    // 更新外部内存趋势
    this.updateTrend('external', memory.external, maxTrendPoints);
  }

  /**
   * 更新趋势数据
   */
  private updateTrend(key: string, value: number, maxPoints: number): void {
    if (!this.memoryUsageTrends.has(key)) {
      this.memoryUsageTrends.set(key, []);
    }

    const trend = this.memoryUsageTrends.get(key)!;
    trend.push(value);

    if (trend.length > maxPoints) {
      trend.shift();
    }
  }

  /**
   * 执行清理任务
   */
  private async executeCleanupTasks(): Promise<void> {
    const cleanupPromises = Array.from(this.cleanupTasks).map((task) => task());
    await Promise.allSettled(cleanupPromises);
  }

  /**
   * 注册清理任务
   */
  registerCleanupTask(task: () => Promise<void>): void {
    this.cleanupTasks.add(task);
  }

  /**
   * 移除清理任务
   */
  unregisterCleanupTask(task: () => Promise<void>): void {
    this.cleanupTasks.delete(task);
  }

  /**
   * 执行紧急清理
   */
  private performEmergencyCleanup(): void {
    logForDebugging('执行紧急内存清理', { level: 'warn' });

    // 强制垃圾回收
    this.forceGarbageCollection();

    // 清理历史数据
    memoryManager.cleanupHistory();

    // 清理内存使用趋势数据
    this.memoryUsageTrends.clear();
  }

  /**
   * 强制垃圾回收
   */
  private forceGarbageCollection(): void {
    if (global.gc) {
      logForDebugging('执行强制垃圾回收');
      global.gc();
      memoryManager.checkMemory();
      logForDebugging('强制垃圾回收完成');
    } else {
      logForDebugging('垃圾回收未启用，请使用 --expose-gc 标志启动应用', {
        level: 'warn',
      });
    }
  }

  /**
   * 分析内存增长
   */
  private analyzeMemoryGrowth(): void {
    logForDebugging('分析内存增长趋势');

    // 分析RSS趋势
    const rssTrend = this.memoryUsageTrends.get('rss');
    if (rssTrend && rssTrend.length > 10) {
      const recentRss = rssTrend.slice(-10);
      const averageRss =
        recentRss.reduce((sum, value) => sum + value, 0) / recentRss.length;
      const firstRss = recentRss[0];
      const lastRss = recentRss[recentRss.length - 1];
      const growthRate = ((lastRss - firstRss) / firstRss) * 100;

      if (growthRate > 20) {
        logForDebugging(`RSS内存持续增长: ${growthRate.toFixed(2)}%`, {
          level: 'warn',
        });
      }
    }

    // 分析堆使用趋势
    const heapUsedTrend = this.memoryUsageTrends.get('heapUsed');
    if (heapUsedTrend && heapUsedTrend.length > 10) {
      const recentHeapUsed = heapUsedTrend.slice(-10);
      const averageHeapUsed =
        recentHeapUsed.reduce((sum, value) => sum + value, 0) /
        recentHeapUsed.length;
      const firstHeapUsed = recentHeapUsed[0];
      const lastHeapUsed = recentHeapUsed[recentHeapUsed.length - 1];
      const growthRate = ((lastHeapUsed - firstHeapUsed) / firstHeapUsed) * 100;

      if (growthRate > 20) {
        logForDebugging(`堆内存持续增长: ${growthRate.toFixed(2)}%`, {
          level: 'warn',
        });
      }
    }
  }

  /**
   * 检测内存泄漏
   */
  private detectMemoryLeak(snapshots: MemorySnapshot[]): void {
    if (snapshots.length < 10) {
      return;
    }

    // 检查最近10个快照的内存使用趋势
    const recentSnapshots = snapshots.slice(-10);
    let isLeaking = true;
    let previousHeapUsed = recentSnapshots[0].memory.heapUsed;
    let totalGrowth = 0;

    for (let i = 1; i < recentSnapshots.length; i++) {
      const currentHeapUsed = recentSnapshots[i].memory.heapUsed;
      // 如果内存使用没有持续增长，则不是内存泄漏
      if (currentHeapUsed <= previousHeapUsed) {
        isLeaking = false;
        break;
      }
      totalGrowth += currentHeapUsed - previousHeapUsed;
      previousHeapUsed = currentHeapUsed;
    }

    if (isLeaking && totalGrowth > 10) {
      // 增长超过10MB
      logForDebugging(
        `检测到可能的内存泄漏，10个快照内内存增长了 ${totalGrowth.toFixed(2)}MB`,
        { level: 'error' }
      );
      this.performEmergencyCleanup();
    }
  }

  /**
   * 优化内存使用
   */
  private optimizeMemoryUsage(
    snapshot: MemorySnapshot,
    snapshots: MemorySnapshot[],
    config: Record<string, unknown>
  ): void {
    const mm = config.memoryManagement as Record<string, unknown>;
    // 检查是否需要执行垃圾回收
    if (snapshot.heapUsagePercent > (mm.gcThreshold as number)) {
      this.forceGarbageCollection();
    }

    // 清理历史数据
    if (snapshots.length > (mm.maxSnapshots as number)) {
      memoryManager.cleanupHistory();
    }

    // 清理内存使用趋势数据
    for (const [key, trend] of this.memoryUsageTrends.entries()) {
      if (trend.length > 50) {
        this.memoryUsageTrends.set(key, trend.slice(-50));
      }
    }
  }

  /**
   * 获取内存优化报告
   */
  generateOptimizationReport(): string {
    const snapshots = memoryManager.getSnapshots();
    if (snapshots.length === 0) {
      return '暂无内存数据，无法生成优化报告';
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const config = getPerformanceConfig();

    // 计算内存使用趋势
    const rssTrend = this.memoryUsageTrends.get('rss') || [];
    const heapUsedTrend = this.memoryUsageTrends.get('heapUsed') || [];
    const externalTrend = this.memoryUsageTrends.get('external') || [];

    // 计算平均值
    const avgRss =
      rssTrend.length > 0
        ? rssTrend.reduce((sum, value) => sum + value, 0) / rssTrend.length
        : 0;
    const avgHeapUsed =
      heapUsedTrend.length > 0
        ? heapUsedTrend.reduce((sum, value) => sum + value, 0) /
          heapUsedTrend.length
        : 0;
    const avgExternal =
      externalTrend.length > 0
        ? externalTrend.reduce((sum, value) => sum + value, 0) /
          externalTrend.length
        : 0;

    // 获取峰值
    const rssPeak = this.memoryUsagePeaks.get('rss') || 0;
    const heapUsedPeak = this.memoryUsagePeaks.get('heapUsed') || 0;
    const externalPeak = this.memoryUsagePeaks.get('external') || 0;

    let report = '\n=== 内存优化报告 ===\n';
    report += `时间: ${new Date(latestSnapshot.timestamp).toISOString()}\n`;
    report += `当前内存使用:\n`;
    report += `  RSS: ${latestSnapshot.memory.rss.toFixed(2)}MB (峰值: ${rssPeak.toFixed(2)}MB)\n`;
    report += `  Heap Total: ${latestSnapshot.memory.heapTotal.toFixed(2)}MB\n`;
    report += `  Heap Used: ${latestSnapshot.memory.heapUsed.toFixed(2)}MB (${latestSnapshot.heapUsagePercent.toFixed(1)}%) (峰值: ${heapUsedPeak.toFixed(2)}MB)\n`;
    report += `  External: ${latestSnapshot.memory.external.toFixed(2)}MB (峰值: ${externalPeak.toFixed(2)}MB)\n`;
    report += `内存增长率: ${latestSnapshot.growthRate.toFixed(2)}%\n`;
    report += `平均内存使用 (最近${rssTrend.length}个数据点):\n`;
    report += `  RSS: ${avgRss.toFixed(2)}MB\n`;
    report += `  Heap Used: ${avgHeapUsed.toFixed(2)}MB\n`;
    report += `  External: ${avgExternal.toFixed(2)}MB\n`;
    report += `内存优化配置:\n`;
    report += `  阈值: ${config.memoryManagement.thresholdMb}MB\n`;
    report += `  堆使用阈值: ${config.memoryManagement.heapUsageThreshold}%\n`;
    report += `  内存增长率阈值: ${config.memoryManagement.growthRateThreshold}%\n`;
    report += `  垃圾回收阈值: ${config.memoryManagement.gcThreshold}%\n`;
    report += `  检查间隔: ${config.memoryManagement.checkIntervalMs}ms\n`;
    report += `清理任务数量: ${this.cleanupTasks.size}\n`;
    report += `==================\n`;

    return report;
  }

  /**
   * 获取内存优化建议
   */
  getOptimizationSuggestions(): string[] {
    const snapshots = memoryManager.getSnapshots();
    if (snapshots.length === 0) {
      return ['暂无内存数据，无法提供建议'];
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const config = getPerformanceConfig();
    const suggestions: string[] = [];

    // 检查内存使用情况
    if (latestSnapshot.memory.rss > config.memoryManagement.thresholdMb) {
      suggestions.push('内存使用超过阈值，建议检查内存泄漏或增加内存限制');
    }

    if (
      latestSnapshot.heapUsagePercent >
      config.memoryManagement.heapUsageThreshold
    ) {
      suggestions.push('堆使用百分比过高，建议优化内存使用或增加堆大小');
    }

    if (
      Math.abs(latestSnapshot.growthRate) >
      config.memoryManagement.growthRateThreshold
    ) {
      suggestions.push('内存增长率异常，建议检查内存泄漏');
    }

    // 检查内存使用趋势
    const rssTrend = this.memoryUsageTrends.get('rss');
    if (rssTrend && rssTrend.length > 10) {
      const recentRss = rssTrend.slice(-10);
      const firstRss = recentRss[0];
      const lastRss = recentRss[recentRss.length - 1];
      const growthRate = ((lastRss - firstRss) / firstRss) * 100;

      if (growthRate > 20) {
        suggestions.push('RSS内存持续增长，可能存在内存泄漏');
      }
    }

    // 检查堆使用趋势
    const heapUsedTrend = this.memoryUsageTrends.get('heapUsed');
    if (heapUsedTrend && heapUsedTrend.length > 10) {
      const recentHeapUsed = heapUsedTrend.slice(-10);
      const firstHeapUsed = recentHeapUsed[0];
      const lastHeapUsed = recentHeapUsed[recentHeapUsed.length - 1];
      const growthRate = ((lastHeapUsed - firstHeapUsed) / firstHeapUsed) * 100;

      if (growthRate > 20) {
        suggestions.push('堆内存持续增长，可能存在内存泄漏');
      }
    }

    // 检查清理任务
    if (this.cleanupTasks.size === 0) {
      suggestions.push('建议注册清理任务，定期清理不再使用的资源');
    }

    if (suggestions.length === 0) {
      suggestions.push('内存使用正常，继续保持良好的内存管理实践');
    }

    return suggestions;
  }

  /**
   * 清理优化器资源
   */
  cleanup(): void {
    this.stopOptimization();
    this.memoryUsagePeaks.clear();
    this.memoryUsageTrends.clear();
    this.cleanupTasks.clear();
    logForDebugging('内存优化器资源清理完成');
  }
}

/**
 * 全局内存优化器实例
 */
export const memoryOptimizer = new MemoryOptimizer();

/**
 * 开始内存优化
 */
export function startMemoryOptimization(): void {
  memoryOptimizer.startOptimization();
}

/**
 * 停止内存优化
 */
export function stopMemoryOptimization(): void {
  memoryOptimizer.stopOptimization();
}

/**
 * 执行内存优化
 */
export async function optimizeMemory(): Promise<void> {
  await memoryOptimizer.optimize();
}

/**
 * 生成内存优化报告
 */
export function generateMemoryOptimizationReport(): string {
  return memoryOptimizer.generateOptimizationReport();
}

/**
 * 获取内存优化建议
 */
export function getMemoryOptimizationSuggestions(): string[] {
  return memoryOptimizer.getOptimizationSuggestions();
}

/**
 * 注册清理任务
 */
export function registerMemoryCleanupTask(task: () => Promise<void>): void {
  memoryOptimizer.registerCleanupTask(task);
}

/**
 * 移除清理任务
 */
export function unregisterMemoryCleanupTask(task: () => Promise<void>): void {
  memoryOptimizer.unregisterCleanupTask(task);
}

/**
 * 清理内存优化器资源
 */
export function cleanupMemoryOptimizer(): void {
  memoryOptimizer.cleanup();
}
