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
 * STT 提供者注册表
 *
 * 实例方法实现核心逻辑，static 方法作为默认实例的门面。
 */
export class STTRegistry {
  /** 实例级别：提供者映射表 */
  private providers: Map<string, STTProvider> = new Map();
  /** 实例级别：默认提供者 ID */
  private defaultProviderId: string = '';
  /** 全局默认实例 */
  private static defaultInstance: STTRegistry = new STTRegistry();

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
    const providers = this.getCandidateProvidersInstance(providerId);

    if (providers.length === 0) {
      return {
        text: '',
        confidence: 0,
        isFinal: true,
        provider: undefined,
      };
    }

    let lastError: Error | undefined;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];

      // 并发控制：获取信号量许可（队列满则跳过该 provider）
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
          context: {
            provider: provider.id,
            error: semaError,
          },
        });

        // 队列满，不阻塞，尝试下一个提供者
        // 如果这是最后一个提供者，循环结束后会使用 lastError
        continue;
      }

      try {
        return await provider.transcribe(audioData, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error('STT 转录失败', {
          provider: provider.id,
          error: lastError.message,
          fallback: providers.length > 1,
        });
        handleError(lastError, {
          module: 'services:voice:sttRegistry',
          action: 'transcribe',
          context: {
            provider: provider.id,
            fallback: providers.length > 1,
          },
        });

        // 如果首个候选提供者失败且有 fallback，标记为降级以启动健康自愈
        if (i === 0 && providers.length > 1) {
          this.trackDegradedProvider(provider.id);
        }
      } finally {
        if (semAcquired) semaphore.release();
      }
    }

    logger.error('STT 所有提供者转录均失败', {
      providerCount: providers.length,
      lastError: lastError?.message,
    });
    handleError(lastError!, {
      module: 'services:voice:sttRegistry',
      action: 'transcribe:all_failed',
      context: {
        providerCount: providers.length,
      },
    });

    return {
      text: '',
      confidence: 0,
      isFinal: true,
      provider: undefined,
    };
  }

  /**
   * 获取当前实例的候选提供者列表（按优先级排序）
   */
  private getCandidateProvidersInstance(providerId?: string): STTProvider[] {
    const candidates: STTProvider[] = [];
    const seen = new Set<string>();

    const addIfNotSeen = (p: STTProvider | undefined): void => {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        candidates.push(p);
      }
    };

    addIfNotSeen(this.getProviderInstance(providerId));
    addIfNotSeen(this.getDefaultProviderInstance());

    for (const p of this.getAllProvidersInstance()) {
      addIfNotSeen(p);
    }

    return candidates;
  }

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

  /**
   * 记录降级的提供者并启动健康探测
   */
  private trackDegradedProvider(providerId: string): void {
    if (this.degradedProviderIds.has(providerId)) return;
    this.degradedProviderIds.add(providerId);
    this.emitInstance('provider_failed', providerId);
    this.startHealthCheckInstance();
  }
}
