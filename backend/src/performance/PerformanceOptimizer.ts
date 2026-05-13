/**
 * 性能优化模块
 *
 * 提供启动性能和运行性能优化功能
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt?: number;
}

export interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryUsage?: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
}

export class PerformanceOptimizer {
  private static instance: PerformanceOptimizer | null = null;
  private caches: Map<string, CacheEntry<any>> = new Map();
  private metrics: PerformanceMetrics[] = [];
  private lazyLoadedModules: Map<string, any> = new Map();
  private operationCounts: Map<string, number> = new Map();
  private operationTimes: Map<string, number[]> = new Map();

  private constructor() {}

  static getInstance(): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer();
    }
    return PerformanceOptimizer.instance;
  }

  /**
   * 创建缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（毫秒）
   */
  setCache<T>(key: string, value: T, ttl?: number): void {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : undefined,
    };
    this.caches.set(key, entry);
  }

  /**
   * 获取缓存
   * @param key 缓存键
   */
  getCache<T>(key: string): T | undefined {
    const entry = this.caches.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.caches.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  deleteCache(key: string): boolean {
    return this.caches.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.caches.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.caches.size;
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.caches.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.caches.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 记录操作开始
   * @param operation 操作名称
   */
  startOperation(operation: string): number {
    this.operationCounts.set(
      operation,
      (this.operationCounts.get(operation) || 0) + 1
    );
    return Date.now();
  }

  /**
   * 记录操作结束
   * @param operation 操作名称
   * @param startTime 开始时间
   */
  endOperation(operation: string, startTime: number): number {
    const duration = Date.now() - startTime;

    if (!this.operationTimes.has(operation)) {
      this.operationTimes.set(operation, []);
    }

    const times = this.operationTimes.get(operation)!;
    times.push(duration);

    if (times.length > 100) {
      times.shift();
    }

    return duration;
  }

  /**
   * 获取操作统计
   * @param operation 操作名称
   */
  getOperationStats(operation: string): {
    count: number;
    totalTime: number;
    averageTime: number;
    minTime: number;
    maxTime: number;
  } {
    const times = this.operationTimes.get(operation) || [];
    const count = this.operationCounts.get(operation) || 0;

    if (times.length === 0) {
      return { count, totalTime: 0, averageTime: 0, minTime: 0, maxTime: 0 };
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const averageTime = totalTime / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    return { count, totalTime, averageTime, minTime, maxTime };
  }

  /**
   * 获取所有操作统计
   */
  getAllOperationStats(): Record<
    string,
    {
      count: number;
      totalTime: number;
      averageTime: number;
      minTime: number;
      maxTime: number;
    }
  > {
    const stats: Record<
      string,
      {
        count: number;
        totalTime: number;
        averageTime: number;
        minTime: number;
        maxTime: number;
      }
    > = {};

    for (const operation of this.operationCounts.keys()) {
      stats[operation] = this.getOperationStats(operation);
    }

    return stats;
  }

  /**
   * 记录性能指标
   * @param metrics 性能指标
   */
  recordMetrics(metrics: PerformanceMetrics): void {
    this.metrics.push({
      ...metrics,
      endTime: metrics.startTime + (metrics.duration || 0),
    });

    if (this.metrics.length > 1000) {
      this.metrics.shift();
    }
  }

  /**
   * 获取性能指标
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * 获取CPU使用情况
   */
  getCpuUsage(): NodeJS.CpuUsage {
    return process.cpuUsage();
  }

  /**
   * 延迟加载模块
   * @param moduleName 模块名称
   * @param loader 加载器函数
   */
  async lazyLoad<T>(moduleName: string, loader: () => Promise<T>): Promise<T> {
    if (this.lazyLoadedModules.has(moduleName)) {
      return this.lazyLoadedModules.get(moduleName);
    }

    const module = await loader();
    this.lazyLoadedModules.set(moduleName, module);
    return module;
  }

  /**
   * 检查模块是否已加载
   * @param moduleName 模块名称
   */
  isModuleLoaded(moduleName: string): boolean {
    return this.lazyLoadedModules.has(moduleName);
  }

  /**
   * 预加载模块
   * @param moduleName 模块名称
   * @param loader 加载器函数
   */
  async preload<T>(moduleName: string, loader: () => Promise<T>): Promise<T> {
    return this.lazyLoad(moduleName, loader);
  }

  /**
   * 获取启动时间估算
   */
  getStartupTimeEstimate(): number {
    const moduleLoadTime = Array.from(this.operationTimes.entries())
      .filter(([name]) => name.startsWith('module:'))
      .reduce(
        (total, [, times]) => total + times.reduce((a, b) => a + b, 0),
        0
      );

    return moduleLoadTime;
  }

  /**
   * 重置所有统计数据
   */
  reset(): void {
    this.caches.clear();
    this.metrics = [];
    this.operationCounts.clear();
    this.operationTimes.clear();
  }
}

export const performanceOptimizer = PerformanceOptimizer.getInstance();

export default performanceOptimizer;
