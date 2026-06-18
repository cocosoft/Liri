import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { configManager } from '@modules/config';
import { TTLCache } from '@modules/utils/cache';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 性能指标类型
 */
export enum PerformanceMetric {
  // 响应时间
  RESPONSE_TIME = 'response_time',
  // 内存使用
  MEMORY_USAGE = 'memory_usage',
  // CPU使用率
  CPU_USAGE = 'cpu_usage',
  // 网络延迟
  NETWORK_LATENCY = 'network_latency',
  // 磁盘I/O
  DISK_IO = 'disk_io',
  // 数据库查询时间
  DATABASE_QUERY = 'database_query',
  // 函数执行时间
  FUNCTION_EXECUTION = 'function_execution',
  //  API调用时间
  API_CALL = 'api_call',
  // 工具执行时间
  TOOL_EXECUTION = 'tool_execution',
  // 消息处理时间
  MESSAGE_PROCESSING = 'message_processing',
  // 会话管理时间
  SESSION_MANAGEMENT = 'session_management',
  // 权限检查时间
  PERMISSION_CHECK = 'permission_check',
  // 验证时间
  VALIDATION = 'validation',
  // 序列化/反序列化时间
  SERIALIZATION = 'serialization',
  // 缓存操作时间
  CACHE_OPERATION = 'cache_operation',
  // 其他
  OTHER = 'other',
}

/**
 * 性能事件
 */
export interface PerformanceEvent {
  id: string;
  metric: PerformanceMetric;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
  memoryUsage?: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  timestamp: number;
}

/**
 * 性能分析器选项
 */
export interface PerformanceProfilerOptions {
  enabled?: boolean;
  samplingInterval?: number;
  maxEvents?: number;
  slowThreshold?: number;
  verySlowThreshold?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  autoReport?: boolean;
  reportInterval?: number;
}

/**
 * 性能分析器
 */
export class PerformanceProfiler {
  private enabled: boolean;
  private samplingInterval: number;
  private maxEvents: number;
  private slowThreshold: number;
  private verySlowThreshold: number;
  private logLevel: 'debug' | 'info' | 'warn' | 'error';
  private autoReport: boolean;
  private reportInterval: number;
  private events: PerformanceEvent[] = [];
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private reportTimer: NodeJS.Timeout | null = null;

  constructor(options: PerformanceProfilerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.samplingInterval = options.samplingInterval ?? 100;
    this.maxEvents = options.maxEvents ?? 1000;
    this.slowThreshold = options.slowThreshold ?? 100;
    this.verySlowThreshold = options.verySlowThreshold ?? 1000;
    this.logLevel = options.logLevel ?? 'info';
    this.autoReport = options.autoReport ?? false;
    this.reportInterval = options.reportInterval ?? 60000;

    if (this.autoReport) {
      this.startAutoReport();
    }
  }

  /**
   * 开始新的性能分析会话
   */
  startSession(sessionId?: string): string {
    this.currentSessionId =
      sessionId ||
      `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.sessionStartTime = Date.now();
    this.events = [];
    return this.currentSessionId;
  }

  /**
   * 结束当前性能分析会话
   */
  endSession(): void {
    this.currentSessionId = null;
    this.sessionStartTime = 0;
  }

  /**
   * 开始性能事件
   */
  startEvent(
    metric: PerformanceMetric,
    name: string,
    metadata?: Record<string, unknown>
  ): string {
    if (!this.enabled) return '';

    const eventId = `event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const event: PerformanceEvent = {
      id: eventId,
      metric,
      name,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      metadata,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      timestamp: Date.now(),
    };

    this.events.push(event);

    // 限制事件数量
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    return eventId;
  }

  /**
   * 结束性能事件
   */
  endEvent(eventId: string): PerformanceEvent | null {
    if (!this.enabled || !eventId) return null;

    const event = this.events.find((e) => e.id === eventId);
    if (!event) return null;

    event.endTime = Date.now();
    event.duration = event.endTime - event.startTime;
    event.memoryUsage = process.memoryUsage();
    event.cpuUsage = process.cpuUsage();

    // 检查是否慢操作
    if (event.duration > this.verySlowThreshold) {
      this.log(`[VERY SLOW] ${event.name}: ${event.duration}ms`, 'warn');
    } else if (event.duration > this.slowThreshold) {
      this.log(`[SLOW] ${event.name}: ${event.duration}ms`, 'warn');
    }

    return event;
  }

  /**
   * 记录性能事件
   */
  recordEvent(
    metric: PerformanceMetric,
    name: string,
    duration: number,
    metadata?: Record<string, unknown>
  ): PerformanceEvent {
    if (!this.enabled) {
      return {
        id: '',
        metric,
        name,
        startTime: 0,
        endTime: 0,
        duration,
        metadata,
        timestamp: Date.now(),
      };
    }

    const event: PerformanceEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      metric,
      name,
      startTime: Date.now() - duration,
      endTime: Date.now(),
      duration,
      metadata,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      timestamp: Date.now(),
    };

    this.events.push(event);

    // 限制事件数量
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // 检查是否慢操作
    if (event.duration > this.verySlowThreshold) {
      this.log(`[VERY SLOW] ${event.name}: ${event.duration}ms`, 'warn');
    } else if (event.duration > this.slowThreshold) {
      this.log(`[SLOW] ${event.name}: ${event.duration}ms`, 'warn');
    }

    return event;
  }

  /**
   * 包装函数以记录执行时间
   */
  wrap<T extends (...args: unknown[]) => unknown>(
    metric: PerformanceMetric,
    name: string,
    fn: T,
    metadata?: Record<string, unknown>
  ): (...args: Parameters<T>) => ReturnType<T> {
    return ((...args: Parameters<T>) => {
      const eventId = this.startEvent(metric, name, metadata);
      try {
        return fn(...args);
      } finally {
        this.endEvent(eventId);
      }
    }) as (...args: Parameters<T>) => ReturnType<T>;
  }

  /**
   * 包装异步函数以记录执行时间
   */
  asyncWrap<T extends (...args: unknown[]) => unknown>(
    metric: PerformanceMetric,
    name: string,
    fn: T,
    metadata?: Record<string, unknown>
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
    return (async (...args: Parameters<T>) => {
      const eventId = this.startEvent(metric, name, metadata);
      try {
        return await fn(...args);
      } finally {
        this.endEvent(eventId);
      }
    }) as (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;
  }

  /**
   * 获取性能报告
   */
  getReport(): string {
    if (!this.enabled || this.events.length === 0) {
      return 'No performance events recorded';
    }

    const lines: string[] = [];
    lines.push('='.repeat(80));
    lines.push(
      `PERFORMANCE REPORT - Session: ${this.currentSessionId || 'Unknown'}`
    );
    lines.push('='.repeat(80));
    lines.push('');

    // 按指标分组
    const eventsByMetric = this.events.reduce(
      (acc, event) => {
        if (!acc[event.metric]) {
          acc[event.metric] = [];
        }
        acc[event.metric].push(event);
        return acc;
      },
      {} as Record<PerformanceMetric, PerformanceEvent[]>
    );

    // 输出每个指标的统计
    for (const [metric, events] of Object.entries(eventsByMetric)) {
      const totalDuration = events.reduce(
        (sum, event) => sum + event.duration,
        0
      );
      const avgDuration = totalDuration / events.length;
      const maxDuration = Math.max(...events.map((e) => e.duration));
      const minDuration = Math.min(...events.map((e) => e.duration));

      lines.push(`Metric: ${metric}`);
      lines.push(`  Events: ${events.length}`);
      lines.push(`  Total: ${totalDuration.toFixed(2)}ms`);
      lines.push(`  Average: ${avgDuration.toFixed(2)}ms`);
      lines.push(`  Max: ${maxDuration.toFixed(2)}ms`);
      lines.push(`  Min: ${minDuration.toFixed(2)}ms`);
      lines.push('');

      // 输出最慢的5个事件
      const slowEvents = [...events]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5);
      if (slowEvents.length > 0) {
        lines.push('  Slowest events:');
        slowEvents.forEach((event, index) => {
          lines.push(
            `    ${index + 1}. ${event.name}: ${event.duration.toFixed(2)}ms`
          );
        });
        lines.push('');
      }
    }

    // 内存使用统计
    const memorySnapshots = this.events
      .map((e) => e.memoryUsage)
      .filter(Boolean) as NodeJS.MemoryUsage[];
    if (memorySnapshots.length > 0) {
      const maxHeapUsed = Math.max(...memorySnapshots.map((m) => m.heapUsed));
      const maxHeapTotal = Math.max(...memorySnapshots.map((m) => m.heapTotal));
      const maxRss = Math.max(...memorySnapshots.map((m) => m.rss));

      lines.push('Memory Usage:');
      lines.push(
        `  Max Heap Used: ${(maxHeapUsed / 1024 / 1024).toFixed(2)} MB`
      );
      lines.push(
        `  Max Heap Total: ${(maxHeapTotal / 1024 / 1024).toFixed(2)} MB`
      );
      lines.push(`  Max RSS: ${(maxRss / 1024 / 1024).toFixed(2)} MB`);
      lines.push('');
    }

    lines.push('='.repeat(80));
    return lines.join('\n');
  }

  /**
   * 输出性能报告
   */
  report(): void {
    const report = this.getReport();
    this.log(report, 'info');
  }

  /**
   * 开始自动报告
   */
  private startAutoReport(): void {
    this.reportTimer = setInterval(() => {
      if (this.events.length > 0) {
        this.report();
      }
    }, this.reportInterval);
  }

  /**
   * 停止自动报告
   */
  stopAutoReport(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  /**
   * 清除所有事件
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * 启用性能分析
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用性能分析
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 日志函数
   */
  private log(message: string, level: 'debug' | 'info' | 'warn' | 'error') {
    if (this.shouldLog(level)) {
      switch (level) {
        case 'debug':
          logger.debug(message);
          break;
        case 'info':
          logger.info(message);
          break;
        case 'warn':
          logger.warning(message);
          break;
        case 'error':
          logger.error(message);
          break;
      }
    }
  }

  /**
   * 检查是否应该记录日志
   */
  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  /**
   * 销毁性能分析器
   */
  destroy(): void {
    this.stopAutoReport();
    this.clearEvents();
  }
}

/**
 * 内存管理器
 */
export class MemoryManager {
  private maxMemoryUsage: number;
  private memoryCheckInterval: number;
  private memoryCheckTimer: NodeJS.Timeout | null = null;
  private listeners: ((usage: NodeJS.MemoryUsage) => void)[] = [];

  constructor(options?: {
    maxMemoryUsage?: number;
    memoryCheckInterval?: number;
  }) {
    this.maxMemoryUsage = options?.maxMemoryUsage ?? 1024 * 1024 * 1024; // 1GB
    this.memoryCheckInterval = options?.memoryCheckInterval ?? 5000;
  }

  /**
   * 开始内存监控
   */
  startMonitoring(): void {
    this.memoryCheckTimer = setInterval(() => {
      const usage = process.memoryUsage();
      this.listeners.forEach((listener) => listener(usage));

      // 检查内存使用是否超过阈值
      if (usage.rss > this.maxMemoryUsage) {
        logger.warning(
          `Memory usage exceeded threshold: ${(usage.rss / 1024 / 1024).toFixed(2)} MB`
        );
      }
    }, this.memoryCheckInterval);
  }

  /**
   * 停止内存监控
   */
  stopMonitoring(): void {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
      this.memoryCheckTimer = null;
    }
  }

  /**
   * 注册内存使用监听器
   */
  onMemoryUsage(listener: (usage: NodeJS.MemoryUsage) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除内存使用监听器
   */
  offMemoryUsage(listener: (usage: NodeJS.MemoryUsage) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * 获取当前内存使用情况
   */
  getCurrentUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * 格式化内存使用情况
   */
  formatUsage(usage: NodeJS.MemoryUsage): string {
    return [
      `Heap Used: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `Heap Total: ${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      `RSS: ${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
      `External: ${(usage.external / 1024 / 1024).toFixed(2)} MB`,
    ].join(', ');
  }

  /**
   * 销毁内存管理器
   */
  destroy(): void {
    this.stopMonitoring();
    this.listeners = [];
  }
}

/**
 * 缓存项
 */
export interface CacheItem<T> {
  value: T;
  expiry: number;
  createdAt: number;
  accessedAt: number;
  size?: number;
}

/**
 * 缓存选项
 */
export interface CacheOptions {
  maxSize?: number;
  maxAge?: number;
  cleanupInterval?: number;
  sizeCalculator?: (value: unknown) => number;
}

/**
 * 内存缓存
 * 基于标准 TTLCache 实现，委托 TTL/过期管理给标准实现。
 */
export class MemoryCache<T> {
  /** 标准缓存实例，接管 TTL/过期/逐出管理 */
  private cache: TTLCache<T>;
  /** 默认过期时间（毫秒） */
  private defaultMaxAge: number;

  constructor(options: CacheOptions = {}) {
    const maxSize = options.maxSize ?? 1024 * 1024 * 1024;
    this.defaultMaxAge = options.maxAge ?? 3600000;
    this.cache = new TTLCache<T>(maxSize, this.defaultMaxAge);
  }

  /**
   * 设置缓存项
   */
  set(key: string, value: T, maxAge?: number): void {
    this.cache.set(key, value, maxAge);
  }

  /**
   * 获取缓存项
   */
  get(key: string): T | undefined {
    const val = this.cache.get(key);
    return val ?? undefined;
  }

  /**
   * 移除缓存项
   */
  remove(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 检查缓存项是否存在
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取缓存项数量
   */
  size(): number {
    return this.cache.size();
  }

  /**
   * 获取缓存占用大小（近似值，基于标准缓存估算）
   */
  getCurrentSize(): number {
    return this.cache.size() * 1024;
  }

  /**
   * 停止自动清理（标准 TTLCache 无定时器，空操作）
   */
  stopCleanup(): void {
    // TTLCache 在访问时惰性清理，无需停止定时器
  }

  /**
   * 销毁缓存
   */
  destroy(): void {
    this.cache.clear();
  }
}

/**
 * 性能工具函数
 */
export const performanceUtils = {
  /**
   * 格式化时间（毫秒）
   */
  formatTime: (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  },

  /**
   * 格式化内存大小
   */
  formatMemory: (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  },

  /**
   * 测量函数执行时间
   */
  measure: <T>(fn: () => T): { result: T; duration: number } => {
    const start = Date.now();
    const result = fn();
    const duration = Date.now() - start;
    return { result, duration };
  },

  /**
   * 测量异步函数执行时间
   */
  async measureAsync<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
  },

  /**
   * 节流函数
   */
  throttle: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let lastCall = 0;
    return (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        fn(...args);
      }
    };
  },

  /**
   * 防抖函数
   */
  debounce: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  },
};

/**
 * 创建默认的性能分析器
 */
export function createPerformanceProfiler(
  options?: PerformanceProfilerOptions
): PerformanceProfiler {
  return new PerformanceProfiler({
    enabled: configManager.env('NODE_ENV') !== 'production',
    samplingInterval: 100,
    maxEvents: 1000,
    slowThreshold: 100,
    verySlowThreshold: 1000,
    logLevel: 'info',
    autoReport: false,
    reportInterval: 60000,
    ...options,
  });
}

/**
 * 创建默认的内存管理器
 */
export function createMemoryManager(options?: {
  maxMemoryUsage?: number;
  memoryCheckInterval?: number;
}): MemoryManager {
  return new MemoryManager({
    maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
    memoryCheckInterval: 5000,
    ...options,
  });
}

/**
 * 创建默认的内存缓存
 */
export function createMemoryCache<T>(options?: CacheOptions): MemoryCache<T> {
  return new MemoryCache<T>({
    maxSize: 100 * 1024 * 1024, // 100MB
    maxAge: 3600000, // 1 hour
    cleanupInterval: 60000, // 1 minute
    ...options,
  });
}

/**
 * 全局性能分析器实例
 */
let globalProfiler: PerformanceProfiler | null = null;

/**
 * 获取全局性能分析器
 */
export function getPerformanceProfiler(): PerformanceProfiler {
  if (!globalProfiler) {
    globalProfiler = createPerformanceProfiler();
  }
  return globalProfiler;
}

/**
 * 全局内存管理器实例
 */
let globalMemoryManager: MemoryManager | null = null;

/**
 * 获取全局内存管理器
 */
export function getMemoryManager(): MemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = createMemoryManager();
  }
  return globalMemoryManager;
}
