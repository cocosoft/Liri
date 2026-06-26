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
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 信号量，控制每 Provider 的并发转录数
 *
 * active < max → 立即执行
 * active >= max → FIFO 排队等待
 * 队列满 → acquire() 抛异常
 */
class ProviderSemaphore {
  private max: number;
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  private active: number = 0;
  private maxQueue: number;

  constructor(max: number, maxQueueLength: number = 10) {
    this.max = max;
    this.maxQueue = maxQueueLength;
  }

  /**
   * 获取执行许可
   * - 未达上限 → 立即返回
   * - 已达上限但队未满 → 排队等待
   * - 队已满 → 抛出错误
   */
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }

    if (this.queue.length >= this.maxQueue) {
      throw new Error(
        `转录并发已达上限（${this.max}），队列已满（${this.maxQueue}）`
      );
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  /**
   * 释放执行许可
   * 有排队 → 唤醒下一个，active 不变
   * 无排队 → active--
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    } else {
      this.active--;
    }
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

/** 默认故障转移链 */
const DEFAULT_FAILOVER_CHAIN = ['cloud', 'local', 'stream'];

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
  /** 并发限制配置：provider id → 最大并发数 */
  private concurrencyLimits: Record<string, number> = {
    local: 1,
    cloud: 3,
    stream: 1,
  };

  /**
   * 获取全局默认实例
   */
  static getDefaultInstance(): STTRegistry {
    return STTRegistry.defaultInstance;
  }

  /**
   * 配置指定提供者的最大并发数
   * @param providerType 提供者类型关键字（如 'local', 'cloud', 'stream'）
   * @param max 最大并发数
   */
  static setConcurrencyLimit(providerType: string, max: number): void {
    STTRegistry.defaultInstance.concurrencyLimits[providerType] = max;
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
        await semaphore.acquire();
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
        result = await provider.transcribe(audioData, options);

        // 转录成功 → 记录恢复，写入缓存
        this.recordProviderSuccess(provider.id);
        this.sttCache.set(audioData, result, options);

        logger.info('STT 转录成功', {
          provider: provider.id,
          confidence: result.confidence,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error('STT 转录失败', {
          provider: provider.id,
          error: lastError.message,
          attempt: i + 1,
          total: providers.length,
        });
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
    logger.error('STT 所有提供者转录均失败', {
      providerCount: providers.length,
      lastError: lastError?.message,
    });
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
   * 根据 provider.id 匹配 concurrencyLimits 中的关键字配置最大并发数
   */
  private getOrCreateSemaphore(providerId: string): ProviderSemaphore {
    let existing = this.semaphores.get(providerId);
    if (existing) return existing;

    // 根据 providerId 匹配关键字确定最大并发数
    const idLower = providerId.toLowerCase();
    let maxConcurrent = 1; // 默认值
    for (const [key, limit] of Object.entries(this.concurrencyLimits)) {
      if (idLower.includes(key)) {
        maxConcurrent = limit;
        break;
      }
    }

    existing = new ProviderSemaphore(maxConcurrent);
    this.semaphores.set(providerId, existing);
    return existing;
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
