/**
 * 内存监控和资源清理模块
 * 监控内存使用情况，及时清理资源
 */

import { logger } from './log';
import { MultiLevelCache } from './cache';

/**
 * 内存使用信息
 */
interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

/**
 * 清理回调函数类型
 */
type CleanupCallback = () => void | Promise<void>;

/**
 * 内存监控器类
 */
export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private intervalId?: NodeJS.Timeout;
  private cleanupCallbacks: Set<CleanupCallback> = new Set();
  private caches: Set<MultiLevelCache<any>> = new Set();
  private memoryThreshold: number;
  private checkInterval: number;

  /**
   * 构造函数
   * @param memoryThreshold 内存阈值（MB）
   * @param checkInterval 检查间隔（毫秒）
   */
  private constructor(
    memoryThreshold: number = 512,
    checkInterval: number = 60000
  ) {
    this.memoryThreshold = memoryThreshold;
    this.checkInterval = checkInterval;
  }

  /**
   * 获取内存监控器实例
   * @returns 内存监控器实例
   */
  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  /**
   * 设置内存阈值
   * @param threshold 内存阈值（MB）
   */
  setMemoryThreshold(threshold: number): void {
    this.memoryThreshold = threshold;
  }

  /**
   * 设置检查间隔
   * @param interval 检查间隔（毫秒）
   */
  setCheckInterval(interval: number): void {
    this.checkInterval = interval;

    // 如果正在监控，重启监控
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }

  /**
   * 注册清理回调
   * @param callback 清理回调
   */
  registerCleanupCallback(callback: CleanupCallback): void {
    this.cleanupCallbacks.add(callback);
  }

  /**
   * 注销清理回调
   * @param callback 清理回调
   */
  unregisterCleanupCallback(callback: CleanupCallback): void {
    this.cleanupCallbacks.delete(callback);
  }

  /**
   * 注册缓存
   * @param cache 缓存实例
   */
  registerCache(cache: MultiLevelCache<any>): void {
    this.caches.add(cache);
  }

  /**
   * 注销缓存
   * @param cache 缓存实例
   */
  unregisterCache(cache: MultiLevelCache<any>): void {
    this.caches.delete(cache);
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.checkInterval);

    logger.info('Memory monitor started', {
      threshold: this.memoryThreshold,
      interval: this.checkInterval,
    });
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Memory monitor stopped');
    }
  }

  /**
   * 检查内存使用情况
   */
  private checkMemory(): void {
    const memoryUsage = this.getMemoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;

    logger.debug('Memory usage check', {
      heapUsed: `${heapUsedMB.toFixed(2)} MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
    });

    // 如果超过阈值，触发清理
    if (heapUsedMB > this.memoryThreshold) {
      logger.warn('Memory usage exceeds threshold, triggering cleanup', {
        heapUsed: `${heapUsedMB.toFixed(2)} MB`,
        threshold: `${this.memoryThreshold} MB`,
      });
      this.triggerCleanup();
    }
  }

  /**
   * 触发清理
   */
  private async triggerCleanup(): Promise<void> {
    logger.info('Starting memory cleanup');

    // 清理缓存
    for (const cache of this.caches) {
      try {
        cache.cleanup();
        logger.debug('Cache cleaned', {
          memorySize: cache.getMemorySize(),
          persistentSize: cache.getPersistentSize(),
        });
      } catch (error) {
        logger.error('Failed to clean cache', error as Error);
      }
    }

    // 执行清理回调
    for (const callback of this.cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        logger.error('Failed to execute cleanup callback', error as Error);
      }
    }

    // 强制垃圾回收（如果可用）
    if (global.gc) {
      try {
        global.gc();
        logger.info('Garbage collection triggered');
      } catch (error) {
        logger.error('Failed to trigger garbage collection', error as Error);
      }
    }

    const memoryUsageAfter = this.getMemoryUsage();
    const heapUsedMBAfter = memoryUsageAfter.heapUsed / 1024 / 1024;

    logger.info('Memory cleanup completed', {
      heapUsedAfter: `${heapUsedMBAfter.toFixed(2)} MB`,
    });
  }

  /**
   * 获取内存使用情况
   * @returns 内存使用信息
   */
  getMemoryUsage(): MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * 获取内存使用统计
   * @returns 内存使用统计
   */
  getMemoryStats(): {
    rss: string;
    heapTotal: string;
    heapUsed: string;
    external: string;
    arrayBuffers: string;
    heapUsedPercentage: number;
  } {
    const usage = this.getMemoryUsage();
    const heapUsedPercentage = (usage.heapUsed / usage.heapTotal) * 100;

    return {
      rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`,
      arrayBuffers: `${(usage.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
      heapUsedPercentage,
    };
  }

  /**
   * 检查内存是否健康
   * @returns 是否健康
   */
  isMemoryHealthy(): boolean {
    const usage = this.getMemoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    return heapUsedMB < this.memoryThreshold;
  }
}

/**
 * 资源管理器类
 */
export class ResourceManager {
  private static instance: ResourceManager;
  private resources: Map<string, { resource: any; cleanup: CleanupCallback }> =
    new Map();

  /**
   * 私有构造函数
   */
  private constructor() {}

  /**
   * 获取资源管理器实例
   * @returns 资源管理器实例
   */
  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * 注册资源
   * @param name 资源名称
   * @param resource 资源对象
   * @param cleanup 清理回调
   */
  registerResource(
    name: string,
    resource: any,
    cleanup: CleanupCallback
  ): void {
    this.resources.set(name, { resource, cleanup });
    logger.debug('Resource registered', { name });
  }

  /**
   * 注销资源
   * @param name 资源名称
   */
  unregisterResource(name: string): void {
    const entry = this.resources.get(name);
    if (entry) {
      try {
        entry.cleanup();
        this.resources.delete(name);
        logger.debug('Resource unregistered', { name });
      } catch (error) {
        logger.error('Failed to cleanup resource: ' + String(error), { name });
      }
    }
  }

  /**
   * 获取资源
   * @param name 资源名称
   * @returns 资源对象或undefined
   */
  getResource<T = any>(name: string): T | undefined {
    return this.resources.get(name)?.resource;
  }

  /**
   * 清理所有资源
   */
  async cleanupAll(): Promise<void> {
    logger.info('Cleaning up all resources');

    const cleanupPromises: Promise<void>[] = [];

    for (const [name, entry] of this.resources.entries()) {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          try {
            const result = entry.cleanup();
            if (result instanceof Promise) {
              result
                .then(() => resolve())
                .catch((error) => {
                  logger.error('Failed to cleanup resource: ' + String(error), {
                    name,
                  });
                  resolve();
                });
            } else {
              resolve();
            }
          } catch (error) {
            logger.error('Failed to cleanup resource: ' + String(error), {
              name,
            });
            resolve();
          }
        })
      );
    }

    await Promise.all(cleanupPromises);
    this.resources.clear();

    logger.info('All resources cleaned up');
  }

  /**
   * 获取资源统计
   * @returns 资源统计
   */
  getResourceStats(): {
    count: number;
    names: string[];
  } {
    return {
      count: this.resources.size,
      names: Array.from(this.resources.keys()),
    };
  }
}

// 导出全局实例
export const memoryMonitor = MemoryMonitor.getInstance();
export const resourceManager = ResourceManager.getInstance();
