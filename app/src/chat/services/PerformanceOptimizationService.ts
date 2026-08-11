//
/**
 * 性能优化服务
 * 提供缓存、批处理和性能监控功能
 */

import { EventEmitter } from 'events';
import { TTLCache } from '@modules/utils/cache';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:performance-optimization');

/**
 * 性能指标
 */
interface PerformanceMetrics {
  cacheHits: number;
  cacheMisses: number;
  averageResponseTime: number;
  totalRequests: number;
}

/**
 * 批处理任务
 */
interface BatchTask<T> {
  id: string;
  data: T;
  timestamp: number;
}

/**
 * 性能优化服务类
 * 使用标准 TTLCache 作为底层缓存，委托 TTL/过期管理给标准实现。
 */
export class PerformanceOptimizationService extends EventEmitter {
  private static instance: PerformanceOptimizationService;
  /** 标准缓存实例，接管 TTL/过期管理 */
  private cache: TTLCache<unknown> = new TTLCache();
  private metrics: PerformanceMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    averageResponseTime: 0,
    totalRequests: 0,
  };
  private responseTimes: number[] = [];
  private maxResponseTimes: number = 100;
  private batchQueues: Map<string, BatchTask<unknown>[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private defaultBatchDelay: number = 100;
  private maxBatchSize: number = 10;

  private constructor() {
    super();
    this.startCacheCleanup();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PerformanceOptimizationService {
    if (!PerformanceOptimizationService.instance) {
      PerformanceOptimizationService.instance =
        new PerformanceOptimizationService();
    }
    return PerformanceOptimizationService.instance;
  }

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值或null
   */
  get<T>(key: string): T | null {
    const value = this.cache.get(key) as T | null;

    if (value === null) {
      this.metrics.cacheMisses++;
      return null;
    }

    this.metrics.cacheHits++;
    return value;
  }

  /**
   * 设置缓存值
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（毫秒）
   */
  set<T>(key: string, value: T, ttl: number = 60000): void {
    this.cache.set(key, value, ttl);
  }

  /**
   * 删除缓存值
   * @param key 缓存键
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  getCacheSize(): number {
    return this.cache.size();
  }

  /**
   * 开始性能测量
   * @returns 测量ID
   */
  startMeasure(): string {
    const id = `measure_${Date.now()}_${Math.random()}`;
    this.cache.set(id, Date.now());
    return id;
  }

  /**
   * 结束性能测量
   * @param id 测量ID
   * @returns 响应时间（毫秒）
   */
  endMeasure(id: string): number {
    const startTime = this.get<number>(id);
    if (startTime === null) {
      return 0;
    }

    const responseTime = Date.now() - startTime;
    this.delete(id);

    this.metrics.totalRequests++;
    this.responseTimes.push(responseTime);

    if (this.responseTimes.length > this.maxResponseTimes) {
      this.responseTimes.shift();
    }

    this.updateAverageResponseTime();

    return responseTime;
  }

  /**
   * 更新平均响应时间
   */
  private updateAverageResponseTime(): void {
    if (this.responseTimes.length === 0) {
      this.metrics.averageResponseTime = 0;
      return;
    }

    const sum = this.responseTimes.reduce((acc, time) => acc + time, 0);
    this.metrics.averageResponseTime = sum / this.responseTimes.length;
  }

  /**
   * 获取性能指标
   * @returns 性能指标
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 重置性能指标
   */
  resetMetrics(): void {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      totalRequests: 0,
    };
    this.responseTimes = [];
  }

  /**
   * 添加批处理任务
   * @param queueName 队列名称
   * @param data 任务数据
   * @param delay 批处理延迟（毫秒）
   */
  addBatchTask<T>(
    queueName: string,
    data: T,
    delay: number = this.defaultBatchDelay
  ): void {
    if (!this.batchQueues.has(queueName)) {
      this.batchQueues.set(queueName, []);
    }

    const queue = this.batchQueues.get(queueName)!;
    const task: BatchTask<T> = {
      id: `task_${Date.now()}_${Math.random()}`,
      data,
      timestamp: Date.now(),
    };

    queue.push(task as BatchTask<unknown>);

    if (queue.length >= this.maxBatchSize) {
      this.processBatch(queueName);
    } else {
      this.scheduleBatchProcessing(queueName, delay);
    }
  }

  /**
   * 调度批处理
   * @param queueName 队列名称
   * @param delay 延迟（毫秒）
   */
  private scheduleBatchProcessing(queueName: string, delay: number): void {
    if (this.batchTimers.has(queueName)) {
      return;
    }

    const timer = setTimeout(() => {
      this.processBatch(queueName);
    }, delay);

    this.batchTimers.set(queueName, timer);
  }

  /**
   * 处理批处理
   * @param queueName 队列名称
   */
  private processBatch(queueName: string): void {
    const queue = this.batchQueues.get(queueName);
    if (!queue || queue.length === 0) {
      return;
    }

    const tasks = [...queue];
    this.batchQueues.set(queueName, []);

    const timer = this.batchTimers.get(queueName);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(queueName);
    }

    this.emit('batch', { queueName, tasks });
  }

  /**
   * 立即处理批处理
   * @param queueName 队列名称
   */
  flushBatch(queueName: string): void {
    this.processBatch(queueName);
  }

  /**
   * 获取批处理队列大小
   * @param queueName 队列名称
   * @returns 队列大小
   */
  getBatchQueueSize(queueName: string): number {
    const queue = this.batchQueues.get(queueName);
    return queue ? queue.length : 0;
  }

  /**
   * 清除批处理队列
   * @param queueName 队列名称
   */
  clearBatchQueue(queueName: string): void {
    this.batchQueues.delete(queueName);

    const timer = this.batchTimers.get(queueName);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(queueName);
    }
  }

  /**
   * 设置批处理配置
   * @param config 配置
   */
  setBatchConfig(config: { defaultDelay?: number; maxSize?: number }): void {
    if (config.defaultDelay !== undefined) {
      this.defaultBatchDelay = config.defaultDelay;
    }
    if (config.maxSize !== undefined) {
      this.maxBatchSize = config.maxSize;
    }
  }

  /**
   * 启动缓存清理
   * 标准 TTLCache 在访问时惰性清理，定时器仅用于发出清理事件。
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      this.cleanupExpiredCache();
      // R08-002: 缓存清理循环记录
      logger.debug('性能缓存清理 tick', { size: this.cache.size() });
    }, 60000);
  }

  /**
   * 清理过期缓存
   * 委托给标准 TTLCache 处理，仅发出清理事件保持兼容。
   */
  private cleanupExpiredCache(): void {
    this.emit('cacheCleanup', { count: 0 });
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计信息
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    totalRequests: number;
  } {
    const totalRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
    const hitRate =
      totalRequests > 0 ? this.metrics.cacheHits / totalRequests : 0;

    return {
      size: this.cache.size(),
      hitRate,
      totalRequests,
    };
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.cache.clear();
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      totalRequests: 0,
    };
    this.responseTimes = [];
    this.batchQueues.clear();
    this.batchTimers.forEach((timer) => clearTimeout(timer));
    this.batchTimers.clear();
  }
}

/**
 * 导出单例
 */
export const performanceOptimizationService =
  PerformanceOptimizationService.getInstance();
