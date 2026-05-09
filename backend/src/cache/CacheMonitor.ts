//
/**
 * 缓存监控器
 * 提供缓存使用情况的监控和统计功能
 */

import { getCacheSystem, CacheItem } from './CacheSystem.js';
import { logForDebugging } from '../utils/debug.js';
import { getStatsAggregator } from './DataAggregator.js';

/**
 * 缓存统计数据
 */
export interface CacheStats {
  /** 缓存键数量 */
  keyCount: number;
  /** 缓存大小（估计） */
  estimatedSize: number;
  /** 命中率 */
  hitRate: number;
  /** 未命中率 */
  missRate: number;
  /** 总访问次数 */
  totalAccesses: number;
  /** 总命中次数 */
  totalHits: number;
  /** 总未命中次数 */
  totalMisses: number;
  /** 平均访问时间 */
  averageAccessTime: number;
  /** 最近访问时间 */
  lastAccessTime: number;
  /** 缓存项详情 */
  items?: CacheItem[];
}

/**
 * 缓存监控器
 */
export class CacheMonitor {
  private cache = getCacheSystem();
  private statsAggregator = getStatsAggregator();
  private accessCount = 0;
  private hitCount = 0;
  private missCount = 0;
  private totalAccessTime = 0;
  private lastAccessTime = 0;
  private monitoringEnabled = true;

  /**
   * 启用监控
   */
  enableMonitoring(): void {
    this.monitoringEnabled = true;
    logForDebugging('缓存监控已启用');
  }

  /**
   * 禁用监控
   */
  disableMonitoring(): void {
    this.monitoringEnabled = false;
    logForDebugging('缓存监控已禁用');
  }

  /**
   * 记录缓存访问
   */
  async recordAccess(
    key: string,
    hit: boolean,
    accessTime: number
  ): Promise<void> {
    if (!this.monitoringEnabled) return;

    this.accessCount++;
    if (hit) {
      this.hitCount++;
    } else {
      this.missCount++;
    }
    this.totalAccessTime += accessTime;
    this.lastAccessTime = Date.now();

    // 记录到统计聚合器
    if (hit) {
      await this.statsAggregator.recordCacheHit('global');
    } else {
      await this.statsAggregator.recordCacheMiss('global');
    }
  }

  /**
   * 获取缓存统计数据
   */
  async getStats(includeItems = false): Promise<CacheStats> {
    const keys = await this.cache.keys();
    const keyCount = keys.length;

    // 估计缓存大小
    let estimatedSize = 0;
    let items: CacheItem[] = [];

    if (includeItems) {
      for (const key of keys) {
        const item = await this.cache.getItem(key);
        if (item) {
          items.push(item);
          // 简单估计大小：JSON字符串长度
          estimatedSize += JSON.stringify(item).length;
        }
      }
    }

    const totalAccesses = this.accessCount;
    const totalHits = this.hitCount;
    const totalMisses = this.missCount;
    const hitRate = totalAccesses > 0 ? (totalHits / totalAccesses) * 100 : 0;
    const missRate =
      totalAccesses > 0 ? (totalMisses / totalAccesses) * 100 : 0;
    const averageAccessTime =
      totalAccesses > 0 ? this.totalAccessTime / totalAccesses : 0;

    const stats: CacheStats = {
      keyCount,
      estimatedSize,
      hitRate,
      missRate,
      totalAccesses,
      totalHits,
      totalMisses,
      averageAccessTime,
      lastAccessTime: this.lastAccessTime,
    };

    if (includeItems) {
      stats.items = items;
    }

    return stats;
  }

  /**
   * 生成缓存报告
   */
  async generateReport(includeItems = false): Promise<string> {
    const stats = await this.getStats(includeItems);

    let report = '\n==========================================\n';
    report += '            缓存监控报告\n';
    report += '==========================================\n';
    report += `缓存键数量: ${stats.keyCount}\n`;
    report += `估计缓存大小: ${this.formatSize(stats.estimatedSize)}\n`;
    report += `命中率: ${stats.hitRate.toFixed(2)}%\n`;
    report += `未命中率: ${stats.missRate.toFixed(2)}%\n`;
    report += `总访问次数: ${stats.totalAccesses}\n`;
    report += `总命中次数: ${stats.totalHits}\n`;
    report += `总未命中次数: ${stats.totalMisses}\n`;
    report += `平均访问时间: ${stats.averageAccessTime.toFixed(2)}ms\n`;
    report += `最近访问时间: ${new Date(stats.lastAccessTime).toLocaleString()}\n`;

    if (includeItems && stats.items) {
      report += '\n缓存项详情:\n';
      for (const item of stats.items.slice(0, 10)) {
        // 只显示前10个
        report += `\n键: ${item.key}\n`;
        report += `  类型: ${typeof item.value}\n`;
        report += `  大小: ${this.formatSize(JSON.stringify(item.value).length)}\n`;
        report += `  创建时间: ${new Date(item.timestamp).toLocaleString()}\n`;
        if (item.expiry) {
          report += `  过期时间: ${new Date(item.expiry).toLocaleString()}\n`;
          report += `  剩余时间: ${Math.round((item.expiry - Date.now()) / 1000)}s\n`;
        }
      }
      if (stats.items.length > 10) {
        report += `\n... 还有 ${stats.items.length - 10} 个缓存项未显示\n`;
      }
    }

    report += '==========================================\n';

    return report;
  }

  /**
   * 重置统计数据
   */
  resetStats(): void {
    this.accessCount = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.totalAccessTime = 0;
    this.lastAccessTime = 0;
    logForDebugging('缓存统计数据已重置');
  }

  /**
   * 格式化大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
}

/**
 * 缓存告警器
 */
export class CacheAlarm {
  private monitor: CacheMonitor;
  private thresholds = {
    maxKeyCount: 10000,
    maxSize: 104857600, // 100MB
    minHitRate: 50,
  };
  private alarms: string[] = [];

  constructor(monitor: CacheMonitor) {
    this.monitor = monitor;
  }

  /**
   * 设置告警阈值
   */
  setThresholds(thresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    logForDebugging('缓存告警阈值已更新', this.thresholds);
  }

  /**
   * 检查告警
   */
  async checkAlarms(): Promise<string[]> {
    this.alarms = [];
    const stats = await this.monitor.getStats();

    // 检查键数量
    if (stats.keyCount > this.thresholds.maxKeyCount) {
      this.alarms.push(
        `缓存键数量超过阈值: ${stats.keyCount} > ${this.thresholds.maxKeyCount}`
      );
    }

    // 检查缓存大小
    if (stats.estimatedSize > this.thresholds.maxSize) {
      this.alarms.push(
        `缓存大小超过阈值: ${this.formatSize(stats.estimatedSize)} > ${this.formatSize(this.thresholds.maxSize)}`
      );
    }

    // 检查命中率
    if (stats.hitRate < this.thresholds.minHitRate) {
      this.alarms.push(
        `缓存命中率低于阈值: ${stats.hitRate.toFixed(2)}% < ${this.thresholds.minHitRate}%`
      );
    }

    return this.alarms;
  }

  /**
   * 获取当前告警
   */
  getAlarms(): string[] {
    return [...this.alarms];
  }

  /**
   * 格式化大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
}

/**
 * 全局缓存监控器实例
 */
export const cacheMonitor = new CacheMonitor();
export const cacheAlarm = new CacheAlarm(cacheMonitor);

/**
 * 获取缓存监控器实例
 */
export function getCacheMonitor(): CacheMonitor {
  return cacheMonitor;
}

export function getCacheAlarm(): CacheAlarm {
  return cacheAlarm;
}

/**
 * 包装缓存操作以进行监控
 */
export async function monitorCacheOperation<T>(
  operation: () => Promise<T>,
  key: string
): Promise<T> {
  const startTime = Date.now();
  let hit = false;

  try {
    const result = await operation();
    hit = result !== undefined;
    return result;
  } finally {
    const endTime = Date.now();
    const accessTime = endTime - startTime;
    await cacheMonitor.recordAccess(key, hit, accessTime);
  }
}
