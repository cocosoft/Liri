/**
 * 延迟加载服务
 * 参考CC源码的延迟加载模式（如defer_loading工具、懒加载模块等）
 * 提供按需加载、缓存、状态追踪等功能
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'LazyService' });

/**
 * 延迟加载状态
 */
export type LazyLoadStatus = 'pending' | 'loading' | 'loaded' | 'failed';

/**
 * 延迟加载结果
 */
export interface LazyResult<T> {
  /** 加载的数据 */
  data: T;
  /** 加载时间戳 */
  loadedAt: number;
  /** 加载耗时（毫秒） */
  loadDuration: number;
}

/**
 * 延迟加载项
 */
interface LazyItem<T> {
  /** 唯一标识 */
  key: string;
  /** 加载状态 */
  status: LazyLoadStatus;
  /** 加载结果（如果已加载） */
  result?: LazyResult<T>;
  /** 加载函数 */
  loadFn: () => Promise<T>;
  /** 错误信息（如果加载失败） */
  error?: string;
  /** 加载开始时间 */
  loadStartedAt?: number;
}

/**
 * 延迟加载配置
 */
export interface LazyConfig {
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 缓存过期时间（毫秒），0表示永不过期 */
  cacheExpiryMs?: number;
  /** 最大缓存数量，0表示无限制 */
  maxCacheSize?: number;
}

/**
 * 延迟加载服务
 */
export class LazyService {
  private static instance: LazyService;
  private items: Map<string, LazyItem<any>>;
  private config: LazyConfig;
  private accessOrder: string[];

  private constructor(config?: LazyConfig) {
    this.items = new Map();
    this.accessOrder = [];
    this.config = {
      enableCache: true,
      cacheExpiryMs: 0,
      maxCacheSize: 0,
      ...config,
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: LazyConfig): LazyService {
    if (!LazyService.instance) {
      LazyService.instance = new LazyService(config);
    }
    return LazyService.instance;
  }

  /**
   * 注册延迟加载项
   * @param key 唯一标识
   * @param loadFn 加载函数
   */
  register<T>(key: string, loadFn: () => Promise<T>): void {
    if (this.items.has(key)) {
      logger.warn(`Lazy item already registered: ${key}`);
      return;
    }

    this.items.set(key, {
      key,
      status: 'pending',
      loadFn,
    });

    logger.debug(`Registered lazy item: ${key}`);
  }

  /**
   * 获取延迟加载项（如果未加载则触发加载）
   * @param key 唯一标识
   */
  async get<T>(key: string): Promise<T> {
    const item = this.items.get(key);

    if (!item) {
      throw new AppError(
        `Lazy item not found: ${key}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    // 如果已加载且未过期，直接返回
    if (item.status === 'loaded' && item.result && !this.isExpired(item)) {
      this.updateAccessOrder(key);
      return item.result.data;
    }

    // 如果正在加载，等待
    if (item.status === 'loading') {
      logger.debug(`Waiting for lazy item to load: ${key}`);
      return this.waitForLoading<T>(key);
    }

    // 触发加载
    return this.loadItem<T>(key);
  }

  /**
   * 预加载指定项（不阻塞）
   * @param key 唯一标识
   */
  preload<T>(key: string): Promise<T> | null {
    const item = this.items.get(key);

    if (!item) {
      logger.warn(`Lazy item not found for preload: ${key}`);
      return null;
    }

    if (item.status === 'loaded') {
      return Promise.resolve(item.result!.data);
    }

    return this.loadItem<T>(key);
  }

  /**
   * 预加载所有项（并行）
   */
  async preloadAll(): Promise<void> {
    const promises = Array.from(this.items.keys()).map((key) =>
      this.loadItem(key).catch((err) => {
        logger.warn(`Failed to preload item ${key}:`, err);
      })
    );

    await Promise.all(promises);
    logger.info(`All lazy items preloaded: ${this.items.size} items`);
  }

  /**
   * 检查项是否已加载
   */
  isLoaded(key: string): boolean {
    const item = this.items.get(key);
    return item?.status === 'loaded' && !this.isExpired(item);
  }

  /**
   * 检查项是否正在加载
   */
  isLoading(key: string): boolean {
    const item = this.items.get(key);
    return item?.status === 'loading' || false;
  }

  /**
   * 获取加载状态
   */
  getStatus(key: string): LazyLoadStatus {
    return this.items.get(key)?.status ?? 'pending';
  }

  /**
   * 清除指定项的缓存
   */
  invalidate(key: string): void {
    const item = this.items.get(key);
    if (item) {
      item.status = 'pending';
      item.result = undefined;
      item.error = undefined;
      logger.debug(`Invalidated lazy item: ${key}`);
    }
  }

  /**
   * 清除所有缓存
   */
  invalidateAll(): void {
    const items = Array.from(this.items.values());
    for (const item of items) {
      item.status = 'pending';
      item.result = undefined;
      item.error = undefined;
    }
    logger.info('All lazy items invalidated');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    pending: number;
    loading: number;
    loaded: number;
    failed: number;
  } {
    const stats = {
      total: this.items.size,
      pending: 0,
      loading: 0,
      loaded: 0,
      failed: 0,
    };

    const items = Array.from(this.items.values());
    for (const item of items) {
      if (item.status === 'loaded' && this.isExpired(item)) {
        stats.pending++;
      } else {
        stats[item.status]++;
      }
    }

    return stats;
  }

  /**
   * 重置服务（主要用于测试）
   */
  reset(): void {
    this.items.clear();
    this.accessOrder = [];
  }

  /**
   * 加载指定项
   */
  private async loadItem<T>(key: string): Promise<T> {
    const item = this.items.get(key);

    if (!item) {
      throw new AppError(
        `Lazy item not found: ${key}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    item.status = 'loading';
    item.loadStartedAt = Date.now();

    try {
      const data = await item.loadFn();
      const loadDuration = Date.now() - item.loadStartedAt!;

      item.status = 'loaded';
      item.result = {
        data,
        loadedAt: Date.now(),
        loadDuration,
      };
      item.error = undefined;

      this.updateAccessOrder(key);
      this.enforceMaxCacheSize();

      logger.debug(`Lazy item loaded: ${key} (${loadDuration}ms)`);
      return data;
    } catch (error) {
      item.status = 'failed';
      item.error = (error as Error).message;

      await handleError(error, {
        module: 'core:lazy',
        action: 'load_item',
      });
      throw error;
    }
  }

  /**
   * 等待正在加载的项
   */
  private async waitForLoading<T>(key: string): Promise<T> {
    const item = this.items.get(key);

    if (!item) {
      throw new AppError(
        `Lazy item not found: ${key}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    // 轮询等待加载完成
    while (item.status === 'loading') {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (item.status === 'loaded' && item.result) {
      return item.result.data;
    }

    throw new AppError(
      `Lazy item failed: ${item.error}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH
    );
  }

  /**
   * 检查是否过期
   */
  private isExpired<T>(item: LazyItem<T>): boolean {
    if (!item.result) {
      return false;
    }
    if (this.config.cacheExpiryMs === 0) {
      return false;
    }

    return (
      Date.now() - item.result!.loadedAt > (this.config.cacheExpiryMs ?? 0)
    );
  }

  /**
   * 更新访问顺序
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * 强制执行最大缓存大小
   */
  private enforceMaxCacheSize(): void {
    if (this.config.maxCacheSize === 0) {
      return;
    }

    while (this.accessOrder.length > (this.config.maxCacheSize ?? 0)) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey !== undefined) {
        this.invalidate(oldestKey);
      }
    }
  }
}

/**
 * 便捷函数：注册延迟加载项
 */
export function registerLazy<T>(key: string, loadFn: () => Promise<T>): void {
  LazyService.getInstance().register(key, loadFn);
}

/**
 * 便捷函数：获取延迟加载项
 */
export function getLazy<T>(key: string): Promise<T> {
  return LazyService.getInstance().get<T>(key);
}

/**
 * 便捷函数：预加载指定项
 */
export function preloadLazy<T>(key: string): Promise<T> | null {
  return LazyService.getInstance().preload<T>(key);
}
