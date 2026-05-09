//
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export enum StrategyType {
  LRU = 'LRU',
  LFU = 'LFU',
  FIFO = 'FIFO',
  ADAPTIVE = 'ADAPTIVE',
  HYBRID = 'HYBRID',
  LRU_K = 'LRU_K',
}

/**
 * 缓存优先级枚举
 */
export enum CachePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 缓存层类型
 */
export enum CacheLayer {
  L1 = 'L1',
  L2 = 'L2',
}

/**
 * 缓存事件类型
 */
export enum CacheEventType {
  /** 缓存命中 */
  HIT = 'hit',
  /** 缓存未命中 */
  MISS = 'miss',
  /** 缓存条目被添加 */
  SET = 'set',
  /** 缓存条目被删除 */
  DELETE = 'delete',
  /** 缓存条目被淘汰 */
  EVICT = 'evict',
  /** 缓存条目从L2提升到L1 */
  PROMOTE = 'promote',
  /** 缓存条目从L1降级到L2 */
  DEMOTE = 'demote',
  /** 缓存被清空 */
  CLEAR = 'clear',
  /** 热点数据被保护 */
  HOT_PROTECT = 'hot_protect',
  /** 热点数据保护过期 */
  HOT_UNPROTECT = 'hot_unprotect',
  /** 策略切换 */
  STRATEGY_SWITCH = 'strategy_switch',
  /** TTL过期 */
  TTL_EXPIRE = 'ttl_expire',
}

/**
 * 缓存事件接口
 */
export interface CacheEvent {
  type: CacheEventType;
  timestamp: number;
  key?: string;
  layer?: CacheLayer;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * 缓存事件监听器
 */
export type CacheEventListener = (event: CacheEvent) => void;

export interface StrategyConfig {
  type: StrategyType;
  maxSize: number;
  ttl: number;
  monitorInterval: number;
  adaptThreshold: number;

  /**
   * 热点数据访问阈值（超过此次数视为热点）
   */
  hotThreshold: number;

  /**
   * 热点数据保护TTL（秒）
   */
  hotProtectionTtl: number;

  /**
   * TTL随机化因子（0-1）
   */
  ttlJitterFactor: number;

  /**
   * 是否启用二级缓存
   */
  enableL2Cache: boolean;

  /**
   * 二级缓存大小
   */
  l2MaxSize: number;

  /**
   * 预热完成标志
   */
  preWarmEnabled: boolean;
}

export interface StrategyEffectiveness {
  type: StrategyType;
  hitRate: number;
  avgAccessTime: number;
  memoryEfficiency: number;
  sampleSize: number;
  score: number;
  evictionCount: number;
  hitCount: number;
  missCount: number;
}

export interface StrategySwitchEvent {
  from: StrategyType;
  to: StrategyType;
  reason: string;
  timestamp: number;
  context?: Record<string, any>;
}

/**
 * 缓存条目元数据
 */
export interface CacheEntry {
  key: string;
  value: any;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  size: number;
  ttl?: number;
  effectiveTtl: number;
  priority: CachePriority;
  isHot: boolean;
  lastPromoted?: number;
  demotionCount: number;
}

/**
 * 预热配置
 */
export interface PreWarmConfig {
  enabled: boolean;
  keys: string[];
  warmupInterval: number;
  loadBatchSize: number;
}

/**
 * 热点数据信息
 */
export interface HotDataInfo {
  key: string;
  accessCount: number;
  lastAccess: number;
  isProtected: boolean;
  protectionExpireTime?: number;
}

export interface ICacheStrategyManager {
  get(key: string): Promise<any>;
  set(
    key: string,
    value: any,
    ttl?: number,
    priority?: CachePriority
  ): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): void;
  getEffectiveness(): StrategyEffectiveness[];
  getStrategy(): StrategyType;
  getSwitchHistory(): StrategySwitchEvent[];
  getSize(): number;

  /**
   * 获取热点数据列表
   */
  getHotData(): HotDataInfo[];

  /**
   * 保护热点数据
   */
  protectHotData(key: string, protectionTime?: number): void;

  /**
   * 预热缓存
   */
  preWarm(
    keys: string[],
    dataProvider: (key: string) => Promise<any>
  ): Promise<void>;

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats;

  /**
   * 订阅缓存事件
   */
  subscribe(listener: CacheEventListener): () => void;

  /**
   * 取消订阅缓存事件
   */
  unsubscribe(listener: CacheEventListener): void;

  /**
   * 获取最近的缓存事件
   */
  getRecentEvents(count?: number): CacheEvent[];

  /**
   * 触发缓存事件
   */
  triggerEvent(event: CacheEvent): void;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  totalEntries: number;
  l1Entries: number;
  l2Entries: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  evictionCount: number;
  hotDataCount: number;
  protectedDataCount: number;
  avgTtl: number;
  avgAccessTime: number;
}

export class CacheStrategyManager implements ICacheStrategyManager {
  private storage: Map<string, CacheEntry> = new Map();
  private l2Storage: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private insertionOrder: string[] = [];
  private accessFrequency: Map<string, number> = new Map();
  private config: StrategyConfig;
  private currentStrategy: StrategyType;
  private switchHistory: StrategySwitchEvent[] = [];
  private totalHits = 0;
  private totalMisses = 0;
  private totalAccessTime = 0;
  private totalAccesses = 0;
  private evictionCount = 0;
  private protectedKeys: Set<string> = new Set();
  private protectedExpireTimes: Map<string, number> = new Map();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private lruKHistory: Map<string, number[]> = new Map();
  private kValue = 2;

  /** 事件监听器列表 */
  private eventListeners: Set<CacheEventListener> = new Set();

  /** 最近事件历史 */
  private recentEvents: CacheEvent[] = [];

  /** 最大事件历史记录数 */
  private maxEventHistory = 1000;

  constructor(config?: Partial<StrategyConfig>) {
    this.config = {
      type: StrategyType.ADAPTIVE,
      maxSize: 10000,
      ttl: 3600000,
      monitorInterval: 300000,
      adaptThreshold: 0.05,
      hotThreshold: 100,
      hotProtectionTtl: 3600,
      ttlJitterFactor: 0.1,
      enableL2Cache: false,
      l2MaxSize: 50000,
      preWarmEnabled: false,
      ...config,
    };
    this.currentStrategy = this.config.type;
    this.startMonitoring();
  }

  private startMonitoring(): void {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(() => {
      this.adaptStrategy();
    }, this.config.monitorInterval);
  }

  private async adaptStrategy(): Promise<void> {
    if (this.currentStrategy !== StrategyType.ADAPTIVE) return;
    if (this.totalAccesses < 100) return;

    const currentScore = this.calculateScore(this.currentStrategy);
    const candidates: StrategyType[] = [
      StrategyType.LRU,
      StrategyType.LFU,
      StrategyType.FIFO,
    ];
    let bestType: StrategyType = this.currentStrategy;
    let bestScore = currentScore;

    for (const type of candidates) {
      const score = this.estimateScore(type);
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    if (
      bestType !== this.currentStrategy &&
      bestScore - currentScore > this.config.adaptThreshold
    ) {
      const reason = `Score improved: ${currentScore.toFixed(3)} → ${bestScore.toFixed(3)}`;
      this.switchHistory.push({
        from: this.currentStrategy,
        to: bestType,
        reason,
        timestamp: Date.now(),
      });
      this.triggerStrategySwitchEvent(this.currentStrategy, bestType, reason);
      this.currentStrategy = bestType;
    }
  }

  private calculateScore(type: StrategyType): number {
    if (this.totalAccesses === 0) return 0;
    const hitRate =
      this.totalAccesses > 0 ? this.totalHits / this.totalAccesses : 0;
    const avgTime =
      this.totalAccesses > 0 ? this.totalAccessTime / this.totalAccesses : 0;
    const timeScore = Math.max(0, 1 - avgTime / 100);
    const memScore =
      this.storage.size > 0 ? 1 - this.storage.size / this.config.maxSize : 0;
    return hitRate * 0.5 + timeScore * 0.25 + memScore * 0.25;
  }

  private estimateScore(type: StrategyType): number {
    const baseScore = this.calculateScore(type);
    const sampleHits = this.totalHits > 0 ? this.totalHits : 1;
    if (type === StrategyType.LRU && this.accessOrder.length > 0)
      return baseScore * 1.1;
    if (type === StrategyType.LFU && this.accessFrequency.size > 5)
      return baseScore * 1.05;
    return baseScore;
  }

  async get(key: string): Promise<any> {
    const start = Date.now();

    // 清理过期的保护
    this.cleanupExpiredProtections();

    // 首先检查L1缓存
    let entry = this.storage.get(key);

    if (entry) {
      // 检查TTL
      if (entry.timestamp + entry.effectiveTtl < Date.now()) {
        this.storage.delete(key);
        this.triggerTtlExpireEvent(key);
        // 如果启用L2缓存，降级到L2
        if (this.config.enableL2Cache) {
          return this.getFromL2(key, start);
        }
        this.recordMiss(start);
        this.triggerMissEvent(key);
        return undefined;
      }

      // 更新访问信息
      this.updateAccessInfo(key, entry);

      // 检查是否成为热点
      this.checkHotData(key, entry);

      this.recordHit(start);
      this.triggerHitEvent(key, CacheLayer.L1);
      return entry.value;
    }

    // L1缓存未命中，检查L2缓存
    if (this.config.enableL2Cache) {
      return this.getFromL2(key, start);
    }

    this.recordMiss(start);
    this.triggerMissEvent(key);
    return undefined;
  }

  private getFromL2(key: string, startTime: number): any {
    const l2Entry = this.l2Storage.get(key);

    if (l2Entry) {
      // L2命中，提升到L1
      if (this.storage.size >= this.config.maxSize) {
        this.evict();
      }

      // 提升到L1
      const promotedEntry: CacheEntry = {
        ...l2Entry,
        timestamp: Date.now(),
        lastPromoted: Date.now(),
      };
      this.storage.set(key, promotedEntry);
      this.l2Storage.delete(key);

      this.updateAccessInfo(key, promotedEntry);
      this.recordHit(startTime);
      this.triggerHitEvent(key, CacheLayer.L2);
      this.triggerPromoteEvent(key);
      return promotedEntry.value;
    }

    this.recordMiss(startTime);
    this.triggerMissEvent(key);
    return undefined;
  }

  private updateAccessInfo(key: string, entry: CacheEntry): void {
    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.accessFrequency.set(key, (this.accessFrequency.get(key) || 0) + 1);

    // 更新访问顺序
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(key);

    // 更新LRU-K历史
    let history = this.lruKHistory.get(key) || [];
    history.push(Date.now());
    if (history.length > this.kValue) {
      history.shift();
    }
    this.lruKHistory.set(key, history);
  }

  private checkHotData(key: string, entry: CacheEntry): void {
    const frequency = this.accessFrequency.get(key) || 0;

    if (frequency >= this.config.hotThreshold && !entry.isHot) {
      entry.isHot = true;
      // 自动保护热点数据
      this.protectHotData(key, this.config.hotProtectionTtl * 1000);
    }
  }

  private recordHit(startTime: number): void {
    this.totalHits++;
    this.totalAccesses++;
    this.totalAccessTime += Date.now() - startTime;
  }

  private recordMiss(startTime: number): void {
    this.totalMisses++;
    this.totalAccesses++;
    this.totalAccessTime += Date.now() - startTime;
  }

  private cleanupExpiredProtections(): void {
    const now = Date.now();
    for (const [key, expireTime] of this.protectedExpireTimes) {
      if (expireTime < now) {
        this.protectedKeys.delete(key);
        this.protectedExpireTimes.delete(key);

        // 更新缓存条目的保护状态
        const entry = this.storage.get(key);
        if (entry) {
          entry.isHot = false;
        }
      }
    }
  }

  async set(
    key: string,
    value: any,
    ttl?: number,
    priority: CachePriority = CachePriority.NORMAL
  ): Promise<void> {
    // 应用TTL随机化
    const baseTtl = ttl ?? this.config.ttl;
    const jitter = this.config.ttlJitterFactor;
    const jitteredTtl = baseTtl * (1 + (Math.random() * 2 - 1) * jitter);

    // 如果启用L2缓存且当前在L1，先检查L1容量
    if (this.config.enableL2Cache) {
      if (this.storage.size >= this.config.maxSize) {
        this.evict(true); // 允许降级到L2
      }
    } else {
      if (this.storage.size >= this.config.maxSize) {
        this.evict(false);
      }
    }

    const entry: CacheEntry = {
      key,
      value,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
      size: JSON.stringify(value).length,
      ttl: baseTtl,
      effectiveTtl: jitteredTtl,
      priority,
      isHot: false,
      demotionCount: 0,
    };

    this.storage.set(key, entry);
    this.insertionOrder.push(key);
    this.accessOrder.push(key);

    // 触发SET事件
    this.triggerSetEvent(key, CacheLayer.L1, {
      ttl: baseTtl,
      jitteredTtl,
      priority,
    });
  }

  private evict(allowDemotion: boolean = false): void {
    if (this.storage.size === 0) return;

    let victimKey: string | undefined;

    switch (this.currentStrategy) {
      case StrategyType.LRU:
        victimKey = this.findLRUVictim();
        break;
      case StrategyType.LFU:
        victimKey = this.findLFUVictim();
        break;
      case StrategyType.FIFO:
        victimKey = this.findFIFOVictim();
        break;
      case StrategyType.LRU_K:
        victimKey = this.findLRUKVictim();
        break;
      default:
        victimKey = this.findLRUVictim();
    }

    if (victimKey) {
      this.evictKey(victimKey, allowDemotion);
    }
  }

  private findLRUVictim(): string | undefined {
    for (const k of this.accessOrder) {
      if (this.storage.has(k) && !this.isProtected(k)) {
        return k;
      }
    }
    // 如果所有数据都受保护，返回第一个（包括受保护的）
    for (const k of this.accessOrder) {
      if (this.storage.has(k)) {
        return k;
      }
    }
    return undefined;
  }

  private findLFUVictim(): string | undefined {
    let minFreq = Infinity;
    let victimKey: string | undefined;

    for (const [k, freq] of this.accessFrequency) {
      if (this.storage.has(k) && !this.isProtected(k) && freq < minFreq) {
        minFreq = freq;
        victimKey = k;
      }
    }

    if (!victimKey) {
      // 如果所有数据都受保护，找频率最低的（包括受保护的）
      for (const [k, freq] of this.accessFrequency) {
        if (this.storage.has(k) && freq < minFreq) {
          minFreq = freq;
          victimKey = k;
        }
      }
    }

    return victimKey || this.accessOrder[0];
  }

  private findFIFOVictim(): string | undefined {
    for (const k of this.insertionOrder) {
      if (this.storage.has(k) && !this.isProtected(k)) {
        return k;
      }
    }
    for (const k of this.insertionOrder) {
      if (this.storage.has(k)) {
        return k;
      }
    }
    return undefined;
  }

  private findLRUKVictim(): string | undefined {
    let minScore = Infinity;
    let victimKey: string | undefined;

    for (const [k, history] of this.lruKHistory) {
      if (!this.storage.has(k) || this.isProtected(k)) continue;

      const entry = this.storage.get(k)!;
      // LRU-K算法：基于第K次访问和最后访问的时间差评分
      if (history.length >= this.kValue) {
        const kthAccess = history[0];
        const lastAccess = history[history.length - 1];
        const score = lastAccess - kthAccess;
        if (score < minScore) {
          minScore = score;
          victimKey = k;
        }
      }
    }

    return victimKey || this.findLRUVictim();
  }

  private isProtected(key: string): boolean {
    return this.protectedKeys.has(key);
  }

  private evictKey(key: string, allowDemotion: boolean): void {
    const entry = this.storage.get(key);

    if (!entry) return;

    // 如果启用L2缓存且允许降级，将数据移动到L2
    const isDemoted = allowDemotion && this.config.enableL2Cache;
    if (isDemoted) {
      // 检查L2容量
      if (this.l2Storage.size >= this.config.l2MaxSize) {
        this.evictFromL2();
      }

      const demotedEntry: CacheEntry = {
        ...entry,
        demotionCount: entry.demotionCount + 1,
      };
      this.l2Storage.set(key, demotedEntry);
      this.triggerDemoteEvent(key);
    }

    this.storage.delete(key);
    this.accessFrequency.delete(key);
    this.lruKHistory.delete(key);

    const aoIdx = this.accessOrder.indexOf(key);
    if (aoIdx !== -1) this.accessOrder.splice(aoIdx, 1);
    const ioIdx = this.insertionOrder.indexOf(key);
    if (ioIdx !== -1) this.insertionOrder.splice(ioIdx, 1);

    this.evictionCount++;

    // 如果没有降级到L2，则触发EVICT事件
    if (!isDemoted) {
      this.triggerEvictEvent(
        key,
        CacheLayer.L1,
        `策略: ${this.currentStrategy}`
      );
    }
  }

  private evictFromL2(): void {
    if (this.l2Storage.size === 0) return;

    // 使用LRU策略从L2淘汰
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.l2Storage) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.l2Storage.delete(oldestKey);
    }
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.storage.has(key) || this.l2Storage.has(key);
    this.storage.delete(key);
    this.l2Storage.delete(key);
    this.accessFrequency.delete(key);
    this.lruKHistory.delete(key);
    this.protectedKeys.delete(key);
    this.protectedExpireTimes.delete(key);

    const aoIdx = this.accessOrder.indexOf(key);
    if (aoIdx !== -1) this.accessOrder.splice(aoIdx, 1);
    const ioIdx = this.insertionOrder.indexOf(key);
    if (ioIdx !== -1) this.insertionOrder.splice(ioIdx, 1);

    if (existed) {
      this.triggerDeleteEvent(key);
    }

    return existed;
  }

  clear(): void {
    this.storage.clear();
    this.l2Storage.clear();
    this.accessOrder = [];
    this.insertionOrder = [];
    this.accessFrequency.clear();
    this.lruKHistory.clear();
    this.protectedKeys.clear();
    this.protectedExpireTimes.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
    this.totalAccessTime = 0;
    this.totalAccesses = 0;
    this.evictionCount = 0;

    // 触发CLEAR事件
    this.triggerClearEvent();
  }

  getEffectiveness(): StrategyEffectiveness[] {
    const types = [
      StrategyType.LRU,
      StrategyType.LFU,
      StrategyType.FIFO,
      StrategyType.LRU_K,
    ];
    return types.map((type) => ({
      type,
      hitRate: this.totalAccesses > 0 ? this.totalHits / this.totalAccesses : 0,
      avgAccessTime:
        this.totalAccesses > 0 ? this.totalAccessTime / this.totalAccesses : 0,
      memoryEfficiency:
        this.config.maxSize > 0
          ? 1 - this.storage.size / this.config.maxSize
          : 0,
      sampleSize: this.totalAccesses,
      score: this.calculateScore(type),
      evictionCount: this.evictionCount,
      hitCount: this.totalHits,
      missCount: this.totalMisses,
    }));
  }

  getStrategy(): StrategyType {
    return this.currentStrategy;
  }

  getSwitchHistory(): StrategySwitchEvent[] {
    return [...this.switchHistory];
  }

  getSize(): number {
    return this.storage.size;
  }

  getHotData(): HotDataInfo[] {
    const hotData: HotDataInfo[] = [];

    for (const [key, entry] of this.storage) {
      if (
        entry.isHot ||
        (this.accessFrequency.get(key) ?? 0) >= this.config.hotThreshold
      ) {
        hotData.push({
          key,
          accessCount: entry.accessCount,
          lastAccess: entry.lastAccess,
          isProtected: this.protectedKeys.has(key),
          protectionExpireTime: this.protectedExpireTimes.get(key),
        });
      }
    }

    return hotData.sort((a, b) => b.accessCount - a.accessCount);
  }

  protectHotData(key: string, protectionTime?: number): void {
    const expireTime =
      Date.now() + (protectionTime || this.config.hotProtectionTtl * 1000);
    this.protectedKeys.add(key);
    this.protectedExpireTimes.set(key, expireTime);

    // 更新缓存条目
    const entry = this.storage.get(key);
    if (entry) {
      entry.isHot = true;
    }

    // 触发热点保护事件
    this.triggerHotProtectEvent(key, expireTime - Date.now());
  }

  async preWarm(
    keys: string[],
    dataProvider: (key: string) => Promise<any>
  ): Promise<void> {
    const batchSize = this.config.preWarmEnabled ? 10 : keys.length;

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const promises = batch.map(async (key) => {
        try {
          const value = await dataProvider(key);
          if (value !== undefined) {
            await this.set(key, value, undefined, CachePriority.HIGH);
          }
        } catch (error) {
          logger.warning(`Failed to pre-warm key ${key}:`, { error });
        }
      });

      await Promise.all(promises);

      // 如果启用预热间隔，添加延迟
      if (this.config.preWarmEnabled && i + batchSize < keys.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  getStats(): CacheStats {
    const now = Date.now();
    let totalTtl = 0;

    for (const entry of this.storage.values()) {
      totalTtl += entry.effectiveTtl;
    }

    const avgTtl = this.storage.size > 0 ? totalTtl / this.storage.size : 0;

    return {
      totalEntries: this.storage.size + this.l2Storage.size,
      l1Entries: this.storage.size,
      l2Entries: this.l2Storage.size,
      hitRate: this.totalAccesses > 0 ? this.totalHits / this.totalAccesses : 0,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      evictionCount: this.evictionCount,
      hotDataCount: this.getHotData().length,
      protectedDataCount: this.protectedKeys.size,
      avgTtl,
      avgAccessTime:
        this.totalAccesses > 0 ? this.totalAccessTime / this.totalAccesses : 0,
    };
  }

  /**
   * 获取L2缓存统计
   */
  getL2Stats(): { size: number; oldestEntry?: number } {
    let oldestEntry: number | undefined;

    for (const entry of this.l2Storage.values()) {
      if (!oldestEntry || entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
    }

    return {
      size: this.l2Storage.size,
      oldestEntry,
    };
  }

  /**
   * 订阅缓存事件
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: CacheEventListener): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.unsubscribe(listener);
    };
  }

  /**
   * 取消订阅缓存事件
   * @param listener 事件监听器
   */
  unsubscribe(listener: CacheEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * 获取最近的缓存事件
   * @param count 返回的事件数量，默认50
   */
  getRecentEvents(count: number = 50): CacheEvent[] {
    return [...this.recentEvents].slice(-count);
  }

  /**
   * 触发缓存事件
   * @param event 缓存事件
   */
  triggerEvent(event: CacheEvent): void {
    // 添加到历史记录
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxEventHistory) {
      this.recentEvents.shift();
    }

    // 通知所有监听器
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warning('Cache event listener error:', { error });
      }
    }
  }

  /**
   * 内部方法：触发HIT事件
   */
  private triggerHitEvent(key: string, layer: CacheLayer): void {
    this.triggerEvent({
      type: CacheEventType.HIT,
      timestamp: Date.now(),
      key,
      layer,
    });
  }

  /**
   * 内部方法：触发MISS事件
   */
  private triggerMissEvent(key: string): void {
    this.triggerEvent({
      type: CacheEventType.MISS,
      timestamp: Date.now(),
      key,
    });
  }

  /**
   * 内部方法：触发SET事件
   */
  private triggerSetEvent(
    key: string,
    layer: CacheLayer,
    metadata?: Record<string, any>
  ): void {
    this.triggerEvent({
      type: CacheEventType.SET,
      timestamp: Date.now(),
      key,
      layer,
      metadata,
    });
  }

  /**
   * 内部方法：触发DELETE事件
   */
  private triggerDeleteEvent(key: string): void {
    this.triggerEvent({
      type: CacheEventType.DELETE,
      timestamp: Date.now(),
      key,
    });
  }

  /**
   * 内部方法：触发EVICT事件
   */
  private triggerEvictEvent(
    key: string,
    layer: CacheLayer,
    reason?: string
  ): void {
    this.triggerEvent({
      type: CacheEventType.EVICT,
      timestamp: Date.now(),
      key,
      layer,
      reason,
    });
  }

  /**
   * 内部方法：触发PROMOTE事件
   */
  private triggerPromoteEvent(key: string): void {
    this.triggerEvent({
      type: CacheEventType.PROMOTE,
      timestamp: Date.now(),
      key,
      layer: CacheLayer.L1,
    });
  }

  /**
   * 内部方法：触发DEMOTE事件
   */
  private triggerDemoteEvent(key: string): void {
    this.triggerEvent({
      type: CacheEventType.DEMOTE,
      timestamp: Date.now(),
      key,
      layer: CacheLayer.L2,
    });
  }

  /**
   * 内部方法：触发CLEAR事件
   */
  private triggerClearEvent(): void {
    this.triggerEvent({
      type: CacheEventType.CLEAR,
      timestamp: Date.now(),
    });
  }

  /**
   * 内部方法：触发HOT_PROTECT事件
   */
  private triggerHotProtectEvent(key: string, protectionTime: number): void {
    this.triggerEvent({
      type: CacheEventType.HOT_PROTECT,
      timestamp: Date.now(),
      key,
      metadata: { protectionTime },
    });
  }

  /**
   * 内部方法：触发HOT_UNPROTECT事件
   */
  private triggerHotUnprotectEvent(key: string): void {
    this.triggerEvent({
      type: CacheEventType.HOT_UNPROTECT,
      timestamp: Date.now(),
      key,
    });
  }

  /**
   * 内部方法：触发STRATEGY_SWITCH事件
   */
  private triggerStrategySwitchEvent(
    from: StrategyType,
    to: StrategyType,
    reason: string
  ): void {
    this.triggerEvent({
      type: CacheEventType.STRATEGY_SWITCH,
      timestamp: Date.now(),
      reason,
      metadata: { from, to },
    });
  }

  /**
   * 内部方法：触发TTL_EXPIRE事件
   */
  private triggerTtlExpireEvent(key: string): void {
    this.triggerEvent({
      type: CacheEventType.TTL_EXPIRE,
      timestamp: Date.now(),
      key,
    });
  }
}

export const cacheStrategyManager = new CacheStrategyManager();
