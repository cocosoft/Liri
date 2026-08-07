/**
 * STT 提供者注册表
 *
 * 管理 STT 提供者的注册、查找和默认提供者切换。
 * 支持实例化创建隔离注册表（用于测试），同时保留 static 便捷方法门面。
 *
 * 用法：
 * ```ts
 * import { STTRegistry } from './sttRegistry';
 *
 * // 注册所有默认提供者（static 门面）
 * STTRegistry.registerDefaults();
 *
 * // 或手动注册
 * import { LocalSTTProvider } from './localSTTProvider';
 * STTRegistry.register(new LocalSTTProvider());
 *
 * const result = await STTRegistry.transcribe(audioBuffer);
 *
 * // 测试时创建隔离实例
 * const registry = STTRegistry.createInstance();
 * registry.register(testProvider);
 * ```
 */

import { createHash } from 'crypto';

import type { STTProvider, STTStreamConnection } from './sttProvider';
import type {
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

import { LocalSTTProvider } from './localSTTProvider';
import { CloudSTTProvider } from './cloudSTTProvider';
import { StreamSTTProvider } from './streamSTTProvider';
import { SenseVoiceSTTProvider } from './senseVoiceSTTProvider';
// 2026-08-06 接入（3.1/P0-1）：STT 入口格式嗅探 + ffmpeg 转码兜底
import { normalizeAudioForSTT } from './audioNormalizer';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getMetricsService } from '@modules/monitoring';
import type { HistogramMetric } from '@modules/monitoring';

const logger = new Logger({
  module: 'voice:sttRegistry',
  level: LogLevel.INFO,
});

/**
 * 信号量队列统计
 */
interface SemaphoreStats {
  /** Provider 标识 */
  providerId: string;
  /** 最大并发数 */
  maxConcurrent: number;
  /** 当前活跃数 */
  active: number;
  /** 当前排队数 */
  queued: number;
  /** 最大队列长度配置 */
  maxQueueLength: number;
  /** 请求超时时间（毫秒） */
  acquireTimeoutMs: number;
  /** 历史峰值排队长度 */
  peakQueued: number;
  /** 累计入队总数 */
  totalEnqueued: number;
  /** 累计超时总数 */
  totalTimedOut: number;
  /** 累计服务总数 */
  totalServed: number;
}

/**
 * 信号量，控制每 Provider 的并发转录数
 *
 * active < max → 立即执行
 * active >= max → FIFO 排队等待
 * 队列满或超时 → acquire() 抛异常
 *
 * @example
 *   const sem = new ProviderSemaphore(3, 20, 15000);
 *   await sem.acquire();
 *   try { // 转录
 *   } finally { sem.release(); }
 */
class ProviderSemaphore {
  /** 排队条目 */
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    enqueuedAt: number;
    timer?: ReturnType<typeof setTimeout>;
  }> = [];
  private active: number = 0;
  private readonly max: number;
  private readonly maxQueue: number;
  private readonly acquireTimeoutMs: number;

  /** 统计 */
  private peakQueued: number = 0;
  private totalEnqueued: number = 0;
  private totalTimedOut: number = 0;
  private totalServed: number = 0;

  /**
   * @param max 最大并发数
   * @param maxQueueLength 最大队列长度，默认 20
   * @param acquireTimeoutMs 排队获取许可超时（毫秒），默认 30000
   */
  constructor(
    max: number,
    maxQueueLength: number = 20,
    acquireTimeoutMs: number = 30000
  ) {
    this.max = max;
    this.maxQueue = maxQueueLength;
    this.acquireTimeoutMs = acquireTimeoutMs;
  }

  /**
   * 获取执行许可
   *
   * - 未达上限 → 立即返回
   * - 已达上限但队未满 → 排队等待（可配置超时）
   * - 队已满或超时 → 抛出错误
   *
   * @param timeoutMs 可选，覆盖默认超时（毫秒）
   */
  async acquire(timeoutMs?: number): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }

    if (this.queue.length >= this.maxQueue) {
      throw new Error(
        `转录并发已达上限（${this.max}），队列已满（${this.maxQueue}）`
      );
    }

    // 排队
    const timeout = timeoutMs ?? this.acquireTimeoutMs;
    this.totalEnqueued++;

    return new Promise<void>((resolve, reject) => {
      const entry: {
        resolve: () => void;
        reject: (err: Error) => void;
        enqueuedAt: number;
        timer?: ReturnType<typeof setTimeout>;
      } = {
        resolve: () => {
          this.totalServed++;
          resolve();
        },
        reject: (err: Error) => {
          reject(err);
        },
        enqueuedAt: Date.now(),
      };

      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          // 从队列中移除自己（可能已在队列中间）
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          this.totalTimedOut++;
          reject(
            new Error(
              `转录排队超时（${timeout}ms），当前活跃 ${this.active}，排队 ${this.queue.length}`
            )
          );
        }, timeout);
      }

      this.queue.push(entry);
      this.peakQueued = Math.max(this.peakQueued, this.queue.length);
    });
  }

  /**
   * 释放执行许可
   *
   * 有排队 → 唤醒下一个排队者（自动清理已超时的条目），active 不变
   * 无排队 → active--
   */
  release(): void {
    // 跳过队列首部已超时的条目
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next.timer) {
        // 定时器未触发 → 该条目仍有效
        clearTimeout(next.timer);
        next.timer = undefined;
      }
      // 如果条目已被 reject（超时），它的 timer 已经触发且从队列移除
      // 但可能存在极短窗口内的残留，用 shift 确认
      this.queue.shift()!;
      next.resolve();
      return;
    }

    this.active--;
  }

  /**
   * 获取队列统计
   *
   * @param providerId Provider 标识，用于返回信息
   */
  getStats(providerId: string): SemaphoreStats {
    return {
      providerId,
      maxConcurrent: this.max,
      active: this.active,
      queued: this.queue.length,
      maxQueueLength: this.maxQueue,
      acquireTimeoutMs: this.acquireTimeoutMs,
      peakQueued: this.peakQueued,
      totalEnqueued: this.totalEnqueued,
      totalTimedOut: this.totalTimedOut,
      totalServed: this.totalServed,
    };
  }
}

/**
 * 计算音频内容指纹（SHA-256 前 16 字节）
 *
 * @param buffer 音频数据
 * @returns 16 字节十六进制字符串
 */
function computeAudioFingerprint(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

/**
 * STT 缓存配置
 */
interface STTCacheConfig {
  /** 最大缓存条目数，默认 50 */
  maxEntries: number;
  /** 缓存 TTL（毫秒），默认 5 分钟 */
  ttlMs: number;
  /** 最小音频大小（字节），小于此值不缓存，默认 256 */
  minAudioSize: number;
}

/**
 * 缓存条目
 */
interface CacheEntry {
  result: STTResult;
  cachedAt: number;
  hits: number;
}

/**
 * STT 转录 LRU 缓存
 *
 * 以音频内容指纹为键，避免重复转录相同音频。
 * 使用 Map 的插入顺序实现 LRU 驱逐（访问时先删除再插入）。
 */
class STTCache {
  private store = new Map<string, CacheEntry>();
  private config: STTCacheConfig;

  constructor(config?: Partial<STTCacheConfig>) {
    this.config = {
      maxEntries: 50,
      ttlMs: 5 * 60 * 1000,
      minAudioSize: 256,
      ...config,
    };
  }

  /**
   * 生成缓存键
   * 复合键：指纹 + 语言 + 格式 + 采样率
   */
  private buildKey(audioData: Buffer, options?: STTTranscribeOptions): string {
    const fingerprint = computeAudioFingerprint(audioData);
    const lang = options?.language || '';
    const fmt = options?.format || '';
    const rate = options?.sampleRate || '';
    return `${fingerprint}:${lang}:${fmt}:${rate}`;
  }

  /**
   * 获取缓存
   * 命中时将条目移到末尾（LRU 策略）
   */
  get(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): STTResult | undefined {
    const key = this.buildKey(audioData, options);
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // TTL 过期检查
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.store.delete(key);
      return undefined;
    }

    // LRU：先删除再插入，将该条目移到末尾
    this.store.delete(key);
    this.store.set(key, entry);
    entry.hits++;

    logger.debug('STTCache · 命中缓存', {
      key: key.slice(0, 16),
      hits: entry.hits,
    });
    return entry.result;
  }

  /**
   * 写入缓存
   */
  set(
    audioData: Buffer,
    result: STTResult,
    options?: STTTranscribeOptions
  ): void {
    // 跳过过小的音频
    if (audioData.length < this.config.minAudioSize) return;

    // 跳过空结果
    if (!result.text && result.confidence === 0) return;

    const key = this.buildKey(audioData, options);

    // 已存在 → 更新
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      result,
      cachedAt: Date.now(),
      hits: 0,
    });

    // LRU 驱逐
    this.evictIfNeeded();
  }

  /**
   * 超过上限时驱逐最久未使用的条目（即 Map 中第一个）
   */
  private evictIfNeeded(): void {
    while (this.store.size > this.config.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        logger.debug('STTCache · LRU 驱逐', { key: oldestKey.slice(0, 16) });
      }
    }
  }

  /**
   * 主动失效指定音频的缓存
   */
  invalidate(audioData: Buffer, options?: STTTranscribeOptions): void {
    const key = this.buildKey(audioData, options);
    this.store.delete(key);
  }

  /**
   * 清理过期条目
   */
  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store) {
      if (now - entry.cachedAt > this.config.ttlMs) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * 当前缓存大小
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * 缓存命中率统计
   */
  getStats(): { size: number; hitRatio: number } {
    let totalHits = 0;
    for (const entry of this.store.values()) {
      totalHits += entry.hits;
    }
    return {
      size: this.store.size,
      hitRatio:
        this.store.size > 0 ? totalHits / (totalHits + this.store.size) : 0,
    };
  }
}

/** 默认故障转移链（本地优先 + 云端兜底，对齐方案 §4.2 混合路由） */
const DEFAULT_FAILOVER_CHAIN = ['local', 'cloud', 'stream'];

/**
 * 故障转移配置
 */
interface FailoverConfig {
  /** 故障转移链（Provider ID 列表，按优先级从高到低） */
  chain: string[];
  /** 降级持续时间（毫秒），超过后重试原始 Provider */
  degradeDurationMs: number;
  /** 故障计数阈值，超过此值触发降级 */
  failureThreshold: number;
}

/**
 * 健康探测结果
 */
interface HealthProbeResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * 统一健康探测策略接口
 */
interface HealthProbeStrategy {
  name: string;
  probe(): Promise<HealthProbeResult>;
  intervalMs: number;
  timeoutMs: number;
}

/**
 * Provider 健康配置
 */
interface ProviderHealthConfig {
  strategy: HealthProbeStrategy;
  unhealthyThreshold: number;
  recoveryThreshold: number;
  retryIntervalMs: number;
}
/** Provider 信号量配置 */
interface SemaphoreConfig {
  /** 最大并发数 */
  max: number;
  /** 最大队列长度，默认 20 */
  maxQueue: number;
  /** 排队获取许可超时（毫秒），默认 30000 */
  acquireTimeoutMs: number;
}

export class STTRegistry {
  /** 实例级别：提供者映射表 */
  private providers: Map<string, STTProvider> = new Map();
  /** 实例级别：默认提供者 ID */
  private defaultProviderId: string = '';
  /** 全局默认实例 */
  private static defaultInstance: STTRegistry = new STTRegistry();

  /** STT 转录 LRU 缓存 */
  private sttCache: STTCache = new STTCache();
  /** 是否跳过缓存（用于调试/测试） */
  private skipCache: boolean = false;

  /** STT 转录耗时直方图（§4.2 端到端延迟观测，按 Provider 维度） */
  private sttLatencyHistograms = new Map<string, HistogramMetric>();

  /** 故障转移链配置 */
  private failoverConfig: FailoverConfig = {
    chain: [...DEFAULT_FAILOVER_CHAIN],
    degradeDurationMs: 60000,
    failureThreshold: 3,
  };

  /** 各 Provider 连续失败计数 */
  private failureCounts: Map<string, number> = new Map();
  /** 各 Provider 降级时间戳（为 0 表示未降级） */
  private degradedTimestamps: Map<string, number> = new Map();

  /** 事件监听器映射表 */
  private listeners: Map<string, Set<(providerId: string) => void>> = new Map();
  /** 健康探测定时器 */
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** 健康探测间隔（毫秒），默认 30s */
  private healthCheckMs: number = 30000;
  /** 当前已降级的失败提供者 ID 集合 */
  private degradedProviderIds: Set<string> = new Set();
  /** 并发控制信号量表 */
  private semaphores: Map<string, ProviderSemaphore> = new Map();
  /** Provider 信号量配置 */
  private semaphoreConfigs: Record<string, SemaphoreConfig> = {
    local: { max: 1, maxQueue: 10, acquireTimeoutMs: 30000 },
    cloud: { max: 3, maxQueue: 20, acquireTimeoutMs: 60000 },
    stream: { max: 1, maxQueue: 5, acquireTimeoutMs: 30000 },
  };

  /**
   * 获取全局默认实例
   */
  static getDefaultInstance(): STTRegistry {
    return STTRegistry.defaultInstance;
  }

  /**
   * 配置指定提供者的最大并发数（向后兼容）
   *
   * @param providerType 提供者类型关键字（如 'local', 'cloud', 'stream'）
   * @param max 最大并发数
   */
  static setConcurrencyLimit(providerType: string, max: number): void {
    STTRegistry.defaultInstance.setConcurrencyLimitInstance(providerType, max);
  }

  /**
   * 配置指定提供者的信号量（队列长度 + 超时）
   *
   * @param providerType 提供者类型关键字
   * @param maxQueue 最大队列长度
   * @param acquireTimeoutMs 排队获取许可超时（毫秒），0 为不超时
   */
  static setQueueConfig(
    providerType: string,
    maxQueue: number,
    acquireTimeoutMs: number
  ): void {
    STTRegistry.defaultInstance.setQueueConfigInstance(
      providerType,
      maxQueue,
      acquireTimeoutMs
    );
  }

  /**
   * 获取所有 Provider 的队列统计
   *
   * @returns 信号量统计数组
   */
  static getQueueStats(): SemaphoreStats[] {
    return STTRegistry.defaultInstance.getQueueStatsInstance();
  }

  /**
   * 配置 STT 缓存
   *
   * @param config 缓存配置（部分字段）
   */
  static configureCache(config: Partial<STTCacheConfig>): void {
    STTRegistry.defaultInstance.sttCache = new STTCache(config);
  }

  /**
   * 设置是否跳过缓存
   *
   * @param skip true 为跳过缓存（调试/测试用）
   */
  static setSkipCache(skip: boolean): void {
    STTRegistry.defaultInstance.skipCache = skip;
  }

  /**
   * 获取缓存统计信息
   */
  static getCacheStats(): { size: number; hitRatio: number } {
    return STTRegistry.defaultInstance.sttCache.getStats();
  }

  /**
   * 配置故障转移链
   *
   * @param chain Provider ID 列表（按优先级从高到低）
   */
  static setFailoverChain(chain: string[]): void {
    STTRegistry.defaultInstance.failoverConfig.chain = [...chain];
  }

  /**
   * 创建隔离的 STTRegistry 实例（用于测试，避免测试间状态污染）
   */
  static createInstance(): STTRegistry {
    return new STTRegistry();
  }

  /**
   * 注册 STT 提供者
   * @param provider STT 提供者实例
   * @param setAsDefault 是否设置为默认提供者
   */
  static register(provider: STTProvider, setAsDefault: boolean = false): void {
    STTRegistry.defaultInstance.registerInstance(provider, setAsDefault);
  }

  /**
   * 注销 STT 提供者
   * @param id 提供者 ID
   */
  static unregister(id: string): void {
    STTRegistry.defaultInstance.unregisterInstance(id);
  }

  /**
   * 获取 STT 提供者
   * @param id 提供者 ID，不传则返回默认提供者
   */
  static getProvider(id?: string): STTProvider | undefined {
    return STTRegistry.defaultInstance.getProviderInstance(id);
  }

  /**
   * 获取默认 STT 提供者
   */
  static getDefaultProvider(): STTProvider | undefined {
    return STTRegistry.defaultInstance.getDefaultProviderInstance();
  }

  /**
   * 设置默认提供者
   * @param id 提供者 ID
   */
  static setDefaultProvider(id: string): void {
    STTRegistry.defaultInstance.setDefaultProviderInstance(id);
  }

  /**
   * 获取所有已注册的提供者 ID 列表
   */
  static getProviderIds(): string[] {
    return STTRegistry.defaultInstance.getProviderIdsInstance();
  }

  /**
   * 获取所有已注册的提供者列表
   */
  static getAllProviders(): STTProvider[] {
    return STTRegistry.defaultInstance.getAllProvidersInstance();
  }

  /**
   * 检查是否有可用的提供者
   */
  static hasAvailableProvider(): boolean {
    return STTRegistry.defaultInstance.hasAvailableProviderInstance();
  }

  /**
   * 获取第一个可用的提供者
   */
  static getFirstAvailableProvider(): STTProvider | undefined {
    return STTRegistry.defaultInstance.getFirstAvailableProviderInstance();
  }

  /**
   * 注册所有默认 STT 提供者
   */
  static registerDefaults(
    cloudConfig?: { apiKey?: string; baseUrl?: string },
    streamConfig?: { apiKey?: string; wsUrl?: string }
  ): void {
    STTRegistry.defaultInstance.registerDefaultsInstance(
      cloudConfig,
      streamConfig
    );
  }

  /**
   * 执行文件级转录
   */
  static async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions,
    providerId?: string
  ): Promise<STTResult> {
    return STTRegistry.defaultInstance.transcribeInstance(
      audioData,
      options,
      providerId
    );
  }

  /**
   * 创建流式转录连接
   */
  static createStream(
    options?: STTStreamOptions,
    providerId?: string
  ): STTStreamConnection | null {
    return STTRegistry.defaultInstance.createStreamInstance(
      options,
      providerId
    );
  }

  /**
   * 获取可用的提供者列表（按优先级排序）
   */
  static getAvailableProviders(): STTProvider[] {
    return STTRegistry.defaultInstance.getAvailableProvidersInstance();
  }

  // ========== 健康自愈与事件监听（Static 门面） ==========

  /**
   * 注册健康自愈事件监听
   * @param event 事件名（'provider_recovered' | 'provider_failed'）
   * @param listener 回调函数，接收提供者 ID
   */
  static on(event: string, listener: (providerId: string) => void): void {
    STTRegistry.defaultInstance.onInstance(event, listener);
  }

  /**
   * 移除健康自愈事件监听
   */
  static off(event: string, listener: (providerId: string) => void): void {
    STTRegistry.defaultInstance.offInstance(event, listener);
  }

  /**
   * 设置健康探测间隔
   * @param ms 间隔毫秒数，默认 30000
   */
  static setHealthCheckInterval(ms: number): void {
    STTRegistry.defaultInstance.setHealthCheckIntervalInstance(ms);
  }

  /**
   * 手动启动健康探测（默认在降级时自动启动）
   */
  static startHealthCheck(): void {
    STTRegistry.defaultInstance.startHealthCheckInstance();
  }

  /**
   * 停止健康探测
   */
  static stopHealthCheck(): void {
    STTRegistry.defaultInstance.stopHealthCheckInstance();
  }

  // ========== 实例方法 ==========

  /**
   * 注册 STT 提供者到当前实例
   */
  private registerInstance(
    provider: STTProvider,
    setAsDefault: boolean = false
  ): void {
    this.providers.set(provider.id, provider);
    if (setAsDefault || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
    logger.info('STT 提供者已注册', {
      providerId: provider.id,
      isDefault: setAsDefault || this.defaultProviderId === provider.id,
    });
  }

  /**
   * 从当前实例注销提供者
   */
  private unregisterInstance(id: string): void {
    this.providers.delete(id);
    if (this.defaultProviderId === id) {
      const firstProvider = this.providers.keys().next().value;
      this.defaultProviderId = firstProvider ?? '';
    }
  }

  /**
   * 从当前实例获取提供者
   */
  private getProviderInstance(id?: string): STTProvider | undefined {
    const providerId = id || this.defaultProviderId;
    return providerId ? this.providers.get(providerId) : undefined;
  }

  /**
   * 获取当前实例的默认提供者
   */
  private getDefaultProviderInstance(): STTProvider | undefined {
    return this.defaultProviderId
      ? this.providers.get(this.defaultProviderId)
      : undefined;
  }

  /**
   * 设置当前实例的默认提供者
   */
  private setDefaultProviderInstance(id: string): void {
    if (this.providers.has(id)) {
      this.defaultProviderId = id;
    }
  }

  /**
   * 获取当前实例的提供者 ID 列表
   */
  private getProviderIdsInstance(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 获取当前实例的所有提供者
   */
  private getAllProvidersInstance(): STTProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 检查当前实例是否有可用的提供者
   */
  private hasAvailableProviderInstance(): boolean {
    for (const provider of this.providers.values()) {
      if (provider.isAvailable()) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取当前实例的第一个可用提供者
   */
  private getFirstAvailableProviderInstance(): STTProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.isAvailable()) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * 在当前实例注册所有默认提供者
   */
  private registerDefaultsInstance(
    cloudConfig?: { apiKey?: string; baseUrl?: string },
    streamConfig?: { apiKey?: string; wsUrl?: string }
  ): void {
    const localProvider = new LocalSTTProvider();
    this.registerInstance(localProvider);
    if (localProvider.isAvailable()) {
      this.setDefaultProviderInstance(localProvider.id);
    }

    // SenseVoice（中文优化，sherpa-onnx，可用时优先级高于本地 Whisper）
    const senseVoiceProvider = new SenseVoiceSTTProvider();
    this.registerInstance(senseVoiceProvider);
    if (senseVoiceProvider.isAvailable()) {
      this.setDefaultProviderInstance(senseVoiceProvider.id);
    }

    if (cloudConfig?.apiKey) {
      const cloudProvider = new CloudSTTProvider({
        apiKey: cloudConfig.apiKey,
        baseUrl: cloudConfig.baseUrl,
      });
      this.registerInstance(cloudProvider);
      if (cloudProvider.isAvailable()) {
        this.setDefaultProviderInstance(cloudProvider.id);
      }
    }

    if (streamConfig?.apiKey || streamConfig?.wsUrl) {
      const streamProvider = new StreamSTTProvider({
        apiKey: streamConfig.apiKey,
        wsUrl: streamConfig.wsUrl,
      });
      this.registerInstance(streamProvider);
      if (streamProvider.isAvailable()) {
        this.setDefaultProviderInstance(streamProvider.id);
      }
    }
  }

  /**
   * Promise 超时包装
   *
   * @param promise 原始 Promise
   * @param ms 超时毫秒
   * @param message 超时错误消息
   * @returns 原始 Promise 结果，超时则抛出 TimeoutError
   */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(message));
      }, ms);

      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * 在当前实例执行文件级转录
   */
  private async transcribeInstance(
    audioData: Buffer,
    options?: STTTranscribeOptions,
    providerId?: string
  ): Promise<STTResult> {
    // ========== 缓存检查 ==========
    if (!this.skipCache && !options?.skipCache) {
      const cached = this.sttCache.get(audioData, options);
      if (cached) {
        return cached;
      }
    }

    // ========== 格式归一化（3.1/P0-1）==========
    // 前端录音可能是 webm/ogg/mp4，本地 STT 只认 PCM/WAV → 嗅探 + ffmpeg 转码兜底。
    // 缓存键仍用原始音频（避免转码改变指纹破坏命中），Provider 使用归一化后数据。
    const normalized = await normalizeAudioForSTT(audioData);
    const sttAudio = normalized.buffer;

    // ========== 故障转移：按链选择候选 Provider ==========
    const providers = this.getFailoverCandidatesInstance(providerId);

    if (providers.length === 0) {
      return {
        text: '',
        confidence: 0,
        isFinal: true,
        provider: undefined,
      };
    }

    let lastError: Error | undefined;
    let result: STTResult | undefined;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];

      // 检查该 Provider 是否处于降级中
      if (this.isProviderDegraded(provider.id)) {
        logger.debug('STT 跳过已降级的 Provider', { provider: provider.id });
        continue;
      }

      // 并发控制：获取信号量许可
      let semAcquired = false;
      const semaphore = this.getOrCreateSemaphore(provider.id);
      try {
        await semaphore.acquire(options?.timeout);
        semAcquired = true;
      } catch (semaError) {
        lastError =
          semaError instanceof Error ? semaError : new Error(String(semaError));
        handleError(lastError, {
          module: 'services:voice:sttRegistry',
          action: 'transcribe:concurrency',
          context: { provider: provider.id, error: semaError },
        });
        continue;
      }

      try {
        // 请求级超时
        const timeout = options?.timeout ?? 0;
        const attemptStart = Date.now();
        if (timeout > 0) {
          result = await this.withTimeout(
            provider.transcribe(sttAudio, options),
            timeout,
            `Provider ${provider.id} 转录超时（${timeout}ms）`
          );
        } else {
          result = await provider.transcribe(sttAudio, options);
        }

        // §4.2 端到端延迟观测：按 Provider 记录转录耗时（混合路由切换阈值数据源）
        const latencyMs = Date.now() - attemptStart;
        this.observeSttLatency(provider.id, latencyMs);

        // 转录成功 → 记录恢复，写入缓存
        this.recordProviderSuccess(provider.id);
        this.sttCache.set(audioData, result, options);

        logger.info('STT 转录成功', {
          provider: provider.id,
          confidence: result.confidence,
          latencyMs,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        handleError(lastError, {
          module: 'services:voice:sttRegistry',
          action: 'transcribe',
          context: { provider: provider.id, attempt: i + 1 },
        });

        // 记录 Provider 失败
        this.recordProviderFailure(provider.id);
      } finally {
        if (semAcquired) semaphore.release();
      }
    }

    // 全部失败
    handleError(lastError!, {
      module: 'services:voice:sttRegistry',
      action: 'transcribe:all_failed',
      context: { providerCount: providers.length },
    });

    return {
      text: '',
      confidence: 0,
      isFinal: true,
      provider: undefined,
    };
  }

  /**
   * 记录 STT 转录耗时（§4.2 端到端延迟观测）
   * 按 Provider 维度记录直方图，供混合路由切换阈值（本地 > N 秒才切云端）参考。
   */
  private observeSttLatency(providerId: string, latencyMs: number): void {
    let histogram = this.sttLatencyHistograms.get(providerId);
    if (!histogram) {
      histogram = getMetricsService().createHistogram({
        name: 'voice.stt.latency_ms',
        description: `STT 转录耗时（${providerId}，ms）`,
        labels: { provider: providerId, module: 'voice:stt' },
      });
      this.sttLatencyHistograms.set(providerId, histogram);
    }
    histogram.observe(latencyMs);
  }

  /**
   * 获取故障转移候选 Provider 列表
   * 按配置的 failover 链顺序，跳过已降级的 Provider
   */
  private getFailoverCandidatesInstance(providerId?: string): STTProvider[] {
    const candidates: STTProvider[] = [];
    const seen = new Set<string>();

    const addIfNotSeen = (p: STTProvider | undefined): void => {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        candidates.push(p);
      }
    };

    // 如果有指定 providerId，优先使用
    if (providerId) {
      addIfNotSeen(this.providers.get(providerId));
    } else {
      // 按故障转移链顺序遍历
      for (const chainId of this.failoverConfig.chain) {
        addIfNotSeen(this.providers.get(chainId));
      }
      // 补充注册表中但不在链中的 Provider
      for (const p of this.providers.values()) {
        addIfNotSeen(p);
      }
    }

    return candidates;
  }

  /**
   * 检查指定 Provider 是否处于降级状态
   */
  private isProviderDegraded(providerId: string): boolean {
    const degradedAt = this.degradedTimestamps.get(providerId);
    if (degradedAt === undefined) return false;

    // 检查降级持续时间是否已过
    if (Date.now() - degradedAt > this.failoverConfig.degradeDurationMs) {
      // 降级时间已过，尝试恢复
      this.degradedTimestamps.delete(providerId);
      this.failureCounts.set(providerId, 0);
      return false;
    }

    return true;
  }

  /**
   * 记录 Provider 成功（重置失败计数）
   */
  private recordProviderSuccess(providerId: string): void {
    this.failureCounts.set(providerId, 0);
    this.degradedTimestamps.delete(providerId);
    this.degradedProviderIds.delete(providerId);
    this.emitInstance('provider_recovered', providerId);
  }

  /**
   * 记录 Provider 失败（达到阈值时触发降级）
   */
  private recordProviderFailure(providerId: string): void {
    const currentCount = (this.failureCounts.get(providerId) || 0) + 1;
    this.failureCounts.set(providerId, currentCount);

    if (currentCount >= this.failoverConfig.failureThreshold) {
      this.degradedTimestamps.set(providerId, Date.now());
      this.degradedProviderIds.add(providerId);
      this.emitInstance('provider_failed', providerId);
      this.startHealthCheckInstance();

      logger.warn('STT Provider 已降级', {
        provider: providerId,
        failureCount: currentCount,
        degradeDurationMs: this.failoverConfig.degradeDurationMs,
      });
    }
  }

  /**
   * 获取当前实例的候选提供者列表（按优先级排序）
   */
  /**
   * 在当前实例创建流式转录连接
   */
  private createStreamInstance(
    options?: STTStreamOptions,
    providerId?: string
  ): STTStreamConnection | null {
    const provider =
      this.getProviderInstance(providerId) ||
      this.getDefaultProviderInstance() ||
      this.getFirstAvailableProviderInstance();

    if (!provider || !provider.createStream) {
      return null;
    }

    return provider.createStream(options);
  }

  /**
   * 获取当前实例的可用提供者列表
   */
  private getAvailableProvidersInstance(): STTProvider[] {
    return this.getAllProvidersInstance().filter((p) => p.isAvailable());
  }

  /**
   * 获取或创建指定提供者的信号量
   *
   * 根据 provider.id 匹配 semaphoreConfigs 中的关键字配置：
   *   - max：最大并发数
   *   - maxQueue：最大队列长度
   *   - acquireTimeoutMs：排队超时
   */
  private getOrCreateSemaphore(providerId: string): ProviderSemaphore {
    let existing = this.semaphores.get(providerId);
    if (existing) return existing;

    // 根据 providerId 匹配关键字确定配置
    const idLower = providerId.toLowerCase();
    let config: SemaphoreConfig = {
      max: 1,
      maxQueue: 20,
      acquireTimeoutMs: 30000,
    };
    for (const [key, cfg] of Object.entries(this.semaphoreConfigs)) {
      if (idLower.includes(key)) {
        config = cfg;
        break;
      }
    }

    existing = new ProviderSemaphore(
      config.max,
      config.maxQueue,
      config.acquireTimeoutMs
    );
    this.semaphores.set(providerId, existing);
    return existing;
  }

  /**
   * 设置实例级别并发限制（向后兼容）
   */
  private setConcurrencyLimitInstance(providerType: string, max: number): void {
    const existing = this.semaphoreConfigs[providerType];
    if (existing) {
      existing.max = max;
    } else {
      this.semaphoreConfigs[providerType] = {
        max,
        maxQueue: 20,
        acquireTimeoutMs: 30000,
      };
    }
    // 重置信号量，下次使用新配置
    this.semaphores.delete(providerType);
  }

  /**
   * 设置实例级别队列配置
   */
  private setQueueConfigInstance(
    providerType: string,
    maxQueue: number,
    acquireTimeoutMs: number
  ): void {
    const existing = this.semaphoreConfigs[providerType];
    if (existing) {
      existing.maxQueue = maxQueue;
      existing.acquireTimeoutMs = acquireTimeoutMs;
    } else {
      this.semaphoreConfigs[providerType] = {
        max: 1,
        maxQueue,
        acquireTimeoutMs,
      };
    }
    // 重置信号量，下次使用新配置
    this.semaphores.delete(providerType);
  }

  /**
   * 获取实例级别所有信号量统计
   */
  private getQueueStatsInstance(): SemaphoreStats[] {
    const stats: SemaphoreStats[] = [];

    for (const [providerId, sem] of this.semaphores) {
      stats.push(sem.getStats(providerId));
    }

    // 补充已配置但尚未创建信号量的 Provider
    for (const [key] of Object.entries(this.semaphoreConfigs)) {
      if (!this.semaphores.has(key)) {
        stats.push({
          providerId: key,
          maxConcurrent: this.semaphoreConfigs[key].max,
          active: 0,
          queued: 0,
          maxQueueLength: this.semaphoreConfigs[key].maxQueue,
          acquireTimeoutMs: this.semaphoreConfigs[key].acquireTimeoutMs,
          peakQueued: 0,
          totalEnqueued: 0,
          totalTimedOut: 0,
          totalServed: 0,
        });
      }
    }

    return stats;
  }

  // ========== 健康自愈实例方法 ==========

  /**
   * 注册事件监听
   */
  onInstance(event: string, listener: (providerId: string) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * 移除事件监听
   */
  offInstance(event: string, listener: (providerId: string) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * 发送事件
   */
  private emitInstance(event: string, providerId: string): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(providerId);
        } catch (error) {
          handleError(
            error instanceof Error ? error : new Error(String(error)),
            {
              module: 'services:voice:sttRegistry',
              action: 'emitInstance',
              context: { event, providerId },
            }
          );
        }
      }
    }
  }

  /**
   * 设置健康探测间隔
   */
  setHealthCheckIntervalInstance(ms: number): void {
    this.healthCheckMs = ms;
    // 如果定时器已在运行，重新启动以应用新间隔
    if (this.healthCheckTimer !== null) {
      this.stopHealthCheckInstance();
      this.startHealthCheckInstance();
    }
  }

  /**
   * 启动健康探测（如无降级 provider 则不启动）
   */
  startHealthCheckInstance(): void {
    if (this.healthCheckTimer !== null) return;
    if (this.degradedProviderIds.size === 0) return;

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckMs);
  }

  /**
   * 停止健康探测
   */
  stopHealthCheckInstance(): void {
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * 执行一轮健康探测：检查所有已降级的提供者是否已恢复
   */
  private performHealthCheck(): void {
    for (const providerId of this.degradedProviderIds) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        this.degradedProviderIds.delete(providerId);
        continue;
      }

      if (provider.isAvailable()) {
        this.degradedProviderIds.delete(providerId);
        // 恢复为默认提供者
        this.defaultProviderId = providerId;
        this.emitInstance('provider_recovered', providerId);
      }
    }

    // 所有 provider 已恢复，停止定时器
    if (this.degradedProviderIds.size === 0) {
      this.stopHealthCheckInstance();
    }
  }
}
