/**
 * 缓存策略
 * 支持多种缓存淘汰策略
 */

import { CacheItem } from './CacheSystem.js';

/**
 * 缓存策略接口
 */
export interface CacheStrategy {
  /**
   * 记录缓存访问
   */
  recordAccess(key: string): void;
  
  /**
   * 选择要淘汰的缓存项
   */
  selectVictim(keys: string[], items: Map<string, CacheItem>): string | undefined;
  
  /**
   * 清除策略状态
   */
  clear(): void;
}

/**
 * LRU (Least Recently Used) 策略
 */
export class LRUCacheStrategy implements CacheStrategy {
  private accessOrder: string[] = [];

  recordAccess(key: string): void {
    // 移除旧的访问记录
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    // 添加到访问顺序的末尾
    this.accessOrder.push(key);
  }

  selectVictim(keys: string[], items: Map<string, CacheItem>): string | undefined {
    // 选择最早访问的项
    for (const key of this.accessOrder) {
      if (keys.includes(key)) {
        return key;
      }
    }
    return keys[0];
  }

  clear(): void {
    this.accessOrder = [];
  }
}

/**
 * LFU (Least Frequently Used) 策略
 */
export class LFUCacheStrategy implements CacheStrategy {
  private accessCount: Map<string, number> = new Map();

  recordAccess(key: string): void {
    const count = this.accessCount.get(key) || 0;
    this.accessCount.set(key, count + 1);
  }

  selectVictim(keys: string[], items: Map<string, CacheItem>): string | undefined {
    let minCount = Infinity;
    let victim: string | undefined;

    for (const key of keys) {
      const count = this.accessCount.get(key) || 0;
      if (count < minCount) {
        minCount = count;
        victim = key;
      }
    }

    return victim;
  }

  clear(): void {
    this.accessCount.clear();
  }
}

/**
 * FIFO (First In First Out) 策略
 */
export class FIFOCacheStrategy implements CacheStrategy {
  private insertionOrder: string[] = [];

  recordAccess(key: string): void {
    // FIFO 策略不关心访问顺序，只关心插入顺序
  }

  selectVictim(keys: string[], items: Map<string, CacheItem>): string | undefined {
    // 选择最早插入的项
    for (const key of this.insertionOrder) {
      if (keys.includes(key)) {
        return key;
      }
    }
    return keys[0];
  }

  clear(): void {
    this.insertionOrder = [];
  }
}

/**
 * 缓存策略工厂
 */
export class CacheStrategyFactory {
  /**
   * 创建缓存策略
   */
  static createStrategy(type: 'LRU' | 'LFU' | 'FIFO'): CacheStrategy {
    switch (type) {
      case 'LRU':
        return new LRUCacheStrategy();
      case 'LFU':
        return new LFUCacheStrategy();
      case 'FIFO':
        return new FIFOCacheStrategy();
      default:
        return new LRUCacheStrategy();
    }
  }
}

/**
 * 带策略的缓存存储
 */
export class StrategyCacheStorage implements CacheItem {
  private storage: Map<string, CacheItem> = new Map();
  private strategy: CacheStrategy;
  private maxSize: number;

  constructor(strategy: CacheStrategy, maxSize: number = 1000) {
    this.strategy = strategy;
    this.maxSize = maxSize;
  }

  /**
   * 获取缓存项
   */
  get(key: string): CacheItem | undefined {
    const item = this.storage.get(key);
    if (item) {
      this.strategy.recordAccess(key);
    }
    return item;
  }

  /**
   * 设置缓存项
   */
  set(key: string, item: CacheItem): void {
    // 如果缓存已满，淘汰一个项
    if (this.storage.size >= this.maxSize) {
      const keys = Array.from(this.storage.keys());
      const victim = this.strategy.selectVictim(keys, this.storage);
      if (victim) {
        this.storage.delete(victim);
      }
    }

    this.storage.set(key, item);
    this.strategy.recordAccess(key);
  }

  /**
   * 删除缓存项
   */
  delete(key: string): boolean {
    return this.storage.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.storage.clear();
    this.strategy.clear();
  }

  /**
   * 获取所有缓存键
   */
  keys(): string[] {
    return Array.from(this.storage.keys());
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.storage.size;
  }

  /**
   * 设置最大大小
   */
  setMaxSize(maxSize: number): void {
    this.maxSize = maxSize;
  }

  /**
   * 获取最大大小
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}
