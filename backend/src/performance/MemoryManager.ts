/**
 * 内存管理器
 * 用于监控和优化应用的内存使用
 */

import { logForDebugging } from '../utils/debug.js';
import { getPerformanceConfig, performanceConfigManager } from './PerformanceConfig.js';

/**
 * 内存快照
 */
export interface MemorySnapshot {
  /** 时间戳 */
  timestamp: number;
  /** 内存使用情况（MB） */
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  /** 内存增长率（%） */
  growthRate: number;
  /** 堆使用百分比（%） */
  heapUsagePercent: number;
}

/**
 * 内存趋势
 */
export interface MemoryTrend {
  /** 时间戳数组 */
  timestamps: number[];
  /** RSS内存使用数组（MB） */
  rss: number[];
  /** 堆使用数组（MB） */
  heapUsed: number[];
  /** 堆总大小数组（MB） */
  heapTotal: number[];
  /** 外部内存使用数组（MB） */
  external: number[];
}

/**
 * 内存管理器
 */
export class MemoryManager {
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots: number = 100;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastMemory: NodeJS.MemoryUsage | null = null;
  private listeners: Set<() => void> = new Set();
  private memoryUsageHistory: Map<string, number[]> = new Map();
  private maxHistorySize: number = 1000;

  /**
   * 开始内存监控
   */
  startMonitoring(): void {
    const config = getPerformanceConfig();
    this.checkInterval = setInterval(() => {
      this.checkMemory();
    }, config.memoryManagement.checkIntervalMs);
    logForDebugging('内存监控已启动', { interval: config.memoryManagement.checkIntervalMs });
  }

  /**
   * 停止内存监控
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logForDebugging('内存监控已停止');
  }

  /**
   * 检查内存使用情况
   */
  checkMemory(): void {
    const memory = process.memoryUsage();
    const config = getPerformanceConfig();
    
    // 计算内存增长率
    let growthRate = 0;
    if (this.lastMemory) {
      growthRate = ((memory.heapUsed - this.lastMemory.heapUsed) / this.lastMemory.heapUsed) * 100;
    }
    this.lastMemory = memory;

    // 计算堆使用百分比
    const heapUsagePercent = (memory.heapUsed / memory.heapTotal) * 100;

    // 创建内存快照
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      memory: {
        rss: memory.rss / (1024 * 1024),
        heapTotal: memory.heapTotal / (1024 * 1024),
        heapUsed: memory.heapUsed / (1024 * 1024),
        external: memory.external / (1024 * 1024),
      },
      growthRate,
      heapUsagePercent,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }

    // 更新内存使用历史
    this.updateMemoryHistory(snapshot);

    // 检查内存使用是否超过阈值
    if (snapshot.memory.rss > config.memoryManagement.thresholdMb) {
      logForDebugging(`内存使用超过阈值: ${snapshot.memory.rss.toFixed(2)}MB > ${config.memoryManagement.thresholdMb}MB`, { level: 'warn' });
      this.notifyListeners();
    }

    // 检查内存增长率是否异常
    if (Math.abs(growthRate) > 50) {
      logForDebugging(`内存增长率异常: ${growthRate.toFixed(2)}%`, { level: 'warn' });
      this.notifyListeners();
    }

    // 检查堆使用百分比是否过高
    if (heapUsagePercent > 90) {
      logForDebugging(`堆使用百分比过高: ${heapUsagePercent.toFixed(2)}%`, { level: 'warn' });
      this.notifyListeners();
    }

    // 记录内存使用情况
    if (process.env.USER_TYPE === 'ant' || process.env.NODE_ENV === 'development') {
      logForDebugging('内存使用情况', snapshot.memory);
    }
  }

  /**
   * 更新内存使用历史
   */
  private updateMemoryHistory(snapshot: MemorySnapshot): void {
    const timestamp = snapshot.timestamp;
    
    // 更新RSS历史
    this.updateHistory('rss', timestamp, snapshot.memory.rss);
    // 更新堆使用历史
    this.updateHistory('heapUsed', timestamp, snapshot.memory.heapUsed);
    // 更新堆总大小历史
    this.updateHistory('heapTotal', timestamp, snapshot.memory.heapTotal);
    // 更新外部内存历史
    this.updateHistory('external', timestamp, snapshot.memory.external);
  }

  /**
   * 更新历史数据
   */
  private updateHistory(key: string, timestamp: number, value: number): void {
    if (!this.memoryUsageHistory.has(key)) {
      this.memoryUsageHistory.set(key, []);
    }
    
    const history = this.memoryUsageHistory.get(key)!;
    history.push(value);
    
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * 获取内存快照
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * 获取内存趋势
   */
  getMemoryTrend(): MemoryTrend {
    const timestamps = this.snapshots.map(s => s.timestamp);
    const rss = this.snapshots.map(s => s.memory.rss);
    const heapUsed = this.snapshots.map(s => s.memory.heapUsed);
    const heapTotal = this.snapshots.map(s => s.memory.heapTotal);
    const external = this.snapshots.map(s => s.memory.external);

    return {
      timestamps,
      rss,
      heapUsed,
      heapTotal,
      external,
    };
  }

  /**
   * 生成内存使用报告
   */
  generateReport(): string {
    const snapshots = this.getSnapshots();
    if (snapshots.length === 0) {
      return '暂无内存快照数据';
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const config = getPerformanceConfig();

    // 计算平均值
    const avgRss = snapshots.reduce((sum, s) => sum + s.memory.rss, 0) / snapshots.length;
    const avgHeapUsed = snapshots.reduce((sum, s) => sum + s.memory.heapUsed, 0) / snapshots.length;
    const avgHeapTotal = snapshots.reduce((sum, s) => sum + s.memory.heapTotal, 0) / snapshots.length;
    const avgExternal = snapshots.reduce((sum, s) => sum + s.memory.external, 0) / snapshots.length;

    let report = '\n=== 内存使用报告 ===\n';
    report += `时间: ${new Date(latestSnapshot.timestamp).toISOString()}\n`;
    report += `当前内存使用:\n`;
    report += `  RSS: ${latestSnapshot.memory.rss.toFixed(2)}MB\n`;
    report += `  Heap Total: ${latestSnapshot.memory.heapTotal.toFixed(2)}MB\n`;
    report += `  Heap Used: ${latestSnapshot.memory.heapUsed.toFixed(2)}MB (${latestSnapshot.heapUsagePercent.toFixed(1)}%)\n`;
    report += `  External: ${latestSnapshot.memory.external.toFixed(2)}MB\n`;
    report += `内存增长率: ${latestSnapshot.growthRate.toFixed(2)}%\n`;
    report += `平均内存使用:\n`;
    report += `  RSS: ${avgRss.toFixed(2)}MB\n`;
    report += `  Heap Total: ${avgHeapTotal.toFixed(2)}MB\n`;
    report += `  Heap Used: ${avgHeapUsed.toFixed(2)}MB\n`;
    report += `  External: ${avgExternal.toFixed(2)}MB\n`;
    report += `内存阈值: ${config.memoryManagement.thresholdMb}MB\n`;
    report += `检查间隔: ${config.memoryManagement.checkIntervalMs}ms\n`;
    report += `快照数量: ${snapshots.length}\n`;
    report += '==================\n';

    return report;
  }

  /**
   * 生成详细内存报告
   */
  generateDetailedReport(): string {
    const snapshots = this.getSnapshots();
    if (snapshots.length === 0) {
      return '暂无内存快照数据';
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const config = getPerformanceConfig();
    const trend = this.getMemoryTrend();

    // 计算趋势数据
    const maxRss = Math.max(...trend.rss);
    const minRss = Math.min(...trend.rss);
    const maxHeapUsed = Math.max(...trend.heapUsed);
    const minHeapUsed = Math.min(...trend.heapUsed);

    let report = '\n=== 详细内存使用报告 ===\n';
    report += `时间: ${new Date(latestSnapshot.timestamp).toISOString()}\n`;
    report += `当前内存使用:\n`;
    report += `  RSS: ${latestSnapshot.memory.rss.toFixed(2)}MB\n`;
    report += `  Heap Total: ${latestSnapshot.memory.heapTotal.toFixed(2)}MB\n`;
    report += `  Heap Used: ${latestSnapshot.memory.heapUsed.toFixed(2)}MB (${latestSnapshot.heapUsagePercent.toFixed(1)}%)\n`;
    report += `  External: ${latestSnapshot.memory.external.toFixed(2)}MB\n`;
    report += `内存增长率: ${latestSnapshot.growthRate.toFixed(2)}%\n`;
    report += `内存趋势 (${snapshots.length} 个快照):\n`;
    report += `  RSS: ${minRss.toFixed(2)}MB - ${maxRss.toFixed(2)}MB\n`;
    report += `  Heap Used: ${minHeapUsed.toFixed(2)}MB - ${maxHeapUsed.toFixed(2)}MB\n`;
    report += `内存阈值: ${config.memoryManagement.thresholdMb}MB\n`;
    report += `检查间隔: ${config.memoryManagement.checkIntervalMs}ms\n`;
    report += `快照数量: ${snapshots.length}\n`;
    report += '==================\n';

    return report;
  }

  /**
   * 强制垃圾回收
   */
  forceGC(): void {
    if (global.gc) {
      logForDebugging('执行强制垃圾回收');
      global.gc();
      this.checkMemory();
      logForDebugging('强制垃圾回收完成');
    } else {
      logForDebugging('垃圾回收未启用，请使用 --expose-gc 标志启动应用', { level: 'warn' });
    }
  }

  /**
   * 优化内存使用
   */
  optimizeMemory(): void {
    logForDebugging('开始内存优化');
    
    // 执行垃圾回收
    this.forceGC();
    
    // 清理历史数据
    this.snapshots = this.snapshots.slice(-50); // 保留最近50个快照
    
    // 清理内存使用历史
    for (const [key, history] of this.memoryUsageHistory.entries()) {
      if (history.length > 500) {
        this.memoryUsageHistory.set(key, history.slice(-500));
      }
    }
    
    logForDebugging('内存优化完成');
  }

  /**
   * 检测内存泄漏
   */
  detectMemoryLeak(): boolean {
    const snapshots = this.getSnapshots();
    if (snapshots.length < 5) {
      return false;
    }

    // 检查最近5个快照的内存使用趋势
    const recentSnapshots = snapshots.slice(-5);
    let isLeaking = true;
    let previousHeapUsed = recentSnapshots[0].memory.heapUsed;

    for (let i = 1; i < recentSnapshots.length; i++) {
      const currentHeapUsed = recentSnapshots[i].memory.heapUsed;
      // 如果内存使用没有持续增长，则不是内存泄漏
      if (currentHeapUsed <= previousHeapUsed) {
        isLeaking = false;
        break;
      }
      previousHeapUsed = currentHeapUsed;
    }

    if (isLeaking) {
      logForDebugging('检测到可能的内存泄漏', { level: 'error' });
      this.notifyListeners();
    }

    return isLeaking;
  }

  /**
   * 获取内存优化建议
   */
  getMemoryOptimizationSuggestions(): string[] {
    const snapshots = this.getSnapshots();
    if (snapshots.length === 0) {
      return ['暂无内存数据，无法提供建议'];
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const config = getPerformanceConfig();
    const suggestions: string[] = [];

    if (latestSnapshot.memory.rss > config.memoryManagement.thresholdMb) {
      suggestions.push('内存使用超过阈值，建议检查内存泄漏或增加内存限制');
    }

    if (latestSnapshot.heapUsagePercent > 90) {
      suggestions.push('堆使用百分比过高，建议优化内存使用或增加堆大小');
    }

    if (latestSnapshot.growthRate > 50) {
      suggestions.push('内存增长率异常，建议检查内存泄漏');
    }

    if (this.detectMemoryLeak()) {
      suggestions.push('检测到可能的内存泄漏，建议检查代码中的内存管理问题');
    }

    if (snapshots.length > 50) {
      suggestions.push('内存快照数量过多，建议定期清理历史数据');
    }

    if (suggestions.length === 0) {
      suggestions.push('内存使用正常，继续保持良好的内存管理实践');
    }

    return suggestions;
  }

  /**
   * 注册内存变化监听器
   */
  onMemoryChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除内存变化监听器
   */
  offMemoryChange(listener: () => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知内存变化监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logForDebugging(`内存变化监听器执行失败: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
      }
    }
  }

  /**
   * 清理历史数据
   */
  cleanupHistory(): void {
    // 清理快照
    this.snapshots = this.snapshots.slice(-20); // 保留最近20个快照
    
    // 清理内存使用历史
    for (const [key, history] of this.memoryUsageHistory.entries()) {
      this.memoryUsageHistory.set(key, history.slice(-200)); // 保留最近200个数据点
    }
    
    logForDebugging('历史数据清理完成');
  }
}

/**
 * 全局内存管理器实例
 */
export const memoryManager = new MemoryManager();

/**
 * 开始内存监控
 */
export function startMemoryMonitoring(): void {
  memoryManager.startMonitoring();
}

/**
 * 停止内存监控
 */
export function stopMemoryMonitoring(): void {
  memoryManager.stopMonitoring();
}

/**
 * 检查内存使用情况
 */
export function checkMemory(): void {
  memoryManager.checkMemory();
}

/**
 * 生成内存使用报告
 */
export function generateMemoryReport(): string {
  return memoryManager.generateReport();
}

/**
 * 生成详细内存报告
 */
export function generateDetailedMemoryReport(): string {
  return memoryManager.generateDetailedReport();
}

/**
 * 强制垃圾回收
 */
export function forceGC(): void {
  memoryManager.forceGC();
}

/**
 * 优化内存使用
 */
export function optimizeMemory(): void {
  memoryManager.optimizeMemory();
}

/**
 * 检测内存泄漏
 */
export function detectMemoryLeak(): boolean {
  return memoryManager.detectMemoryLeak();
}

/**
 * 获取内存趋势
 */
export function getMemoryTrend(): MemoryTrend {
  return memoryManager.getMemoryTrend();
}

/**
 * 获取内存优化建议
 */
export function getMemoryOptimizationSuggestions(): string[] {
  return memoryManager.getMemoryOptimizationSuggestions();
}

/**
 * 清理历史数据
 */
export function cleanupMemoryHistory(): void {
  memoryManager.cleanupHistory();
}
