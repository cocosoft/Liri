//
/**
 * 缓存模块
 * 提供多级缓存系统，包括内存缓存、带过期的内存缓存和持久化缓存
 */

import { jsonStringify } from './json.js';

/**
 * 缓存项
 */
interface CacheItem<T> {
  value: T;
  expiresAt?: number;
}

/**
 * 缓存配置
 */
interface CacheConfig {
  maxSize?: number;
  ttl?: number;
  onEvict?: (key: string, value: any) => void;
}

/**
 * LRU缓存条目
 */
interface LRUCacheItem<T> {
  value: T;
  lastAccess: number;
}

/**
 * LRU缓存类（纯JavaScript实现）
 */
export class LRUCache<T = any> {
  private cache: Map<string, LRUCacheItem<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;

  /**
   * 构造函数
   * @param maxSize 最大缓存大小
   * @param defaultTtl 默认过期时间（毫秒）
   */
  constructor(maxSize: number = 1000, defaultTtl: number = 0) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
  }

  /**
   * 设置缓存
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, value: T, ttl?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    const expiresAt = ttl !== undefined ? Date.now() + ttl : this.defaultTtl > 0 ? Date.now() + this.defaultTtl : undefined;
    this.cache.set(key, { value, lastAccess: Date.now() });
  }

  /**
   * 获取缓存
   * @param key 键
   * @returns 值或undefined
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);

    if (!item) {
      return undefined;
    }

    item.lastAccess = Date.now();
    return item.value;
  }

  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 删除缓存
   * @param key 键
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取所有键
   * @returns 键数组
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.defaultTtl,
    };
  }

  /**
   * 淘汰最久未使用的项
   */
  private evict(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccess < oldestTime) {
        oldestTime = item.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * TTL缓存类（带过期时间的缓存）
 */
export class TTLCache<T = any> {
  private cache: Map<string, CacheItem<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;
  private accessOrder: string[] = [];

  /**
   * 构造函数
   * @param maxSize 最大缓存大小
   * @param defaultTtl 默认过期时间（毫秒）
   */
  constructor(maxSize: number = 1000, defaultTtl: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
  }

  /**
   * 设置缓存
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, value: T, ttl?: number): void {
    const expiresAt = ttl !== undefined ? Date.now() + ttl : Date.now() + this.defaultTtl;

    if (this.cache.has(key)) {
      this.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, { value, expiresAt });
    this.accessOrder.push(key);
  }

  /**
   * 获取缓存
   * @param key 键
   * @returns 值或undefined
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);

    if (!item) {
      return undefined;
    }

    if (Date.now() > item.expiresAt) {
      this.delete(key);
      return undefined;
    }

    this.touch(key);
    return item.value;
  }

  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  has(key: string): boolean {
    const item = this.cache.get(key);

    if (!item) {
      return false;
    }

    if (Date.now() > item.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存
   * @param key 键
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }
    return deleted;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 更新访问顺序
   * @param key 键
   */
  private touch(key: string): void {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);
  }

  /**
   * 淘汰最久未使用的项
   */
  private evict(): void {
    if (this.accessOrder.length > 0) {
      const lruKey = this.accessOrder[0];
      this.delete(lruKey);
    }
  }

  /**
   * 清理过期项
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.delete(key);
    }
  }
}

/**
 * 缓存条目（用于内存缓存）
 */
interface MemoryCacheItem<T> {
  value: T;
  expiresAt?: number;
  lastAccess: number;
}

/**
 * 内存缓存类（改进版，带LRU和TTL支持）
 */
export class MemoryCache<T = any> {
  private cache: Map<string, MemoryCacheItem<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;

  /**
   * 构造函数
   * @param maxSize 最大缓存大小
   * @param defaultTtl 默认过期时间（毫秒）
   */
  constructor(maxSize: number = 1000, defaultTtl?: number) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl || 0;
  }

  /**
   * 设置缓存
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, value: T, ttl?: number): void {
    const expiresAt = ttl ? Date.now() + ttl : undefined;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, { value, expiresAt, lastAccess: Date.now() });
  }

  /**
   * 获取缓存
   * @param key 键
   * @returns 值或undefined
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);

    if (!item) {
      return undefined;
    }

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key);
      return undefined;
    }

    item.lastAccess = Date.now();
    return item.value;
  }

  /**
   * 删除缓存
   * @param key 键
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  has(key: string): boolean {
    const item = this.cache.get(key);

    if (!item) {
      return false;
    }

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 淘汰缓存项（LRU策略）
   */
  private evict(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccess < oldestTime) {
        oldestTime = item.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 清理过期项
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; maxSize: number; defaultTtl: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTtl: this.defaultTtl,
    };
  }
}

/**
 * 持久化缓存类
 */
export class PersistentCache<T = any> {
  private cache: Map<string, CacheItem<T>> = new Map();
  private filePath: string;
  private maxSize: number;
  private size: number = 0;

  /**
   * 构造函数
   * @param filePath 文件路径
   * @param maxSize 最大缓存大小
   */
  constructor(filePath: string, maxSize: number = 1000) {
    this.filePath = filePath;
    this.maxSize = maxSize;
    this.load();
  }

  /**
   * 设置缓存
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, value: T, ttl?: number): void {
    const expiresAt = ttl ? Date.now() + ttl : undefined;
    
    // 如果键已存在，先删除旧值
    if (this.cache.has(key)) {
      this.size--;
    }
    
    // 检查是否超过最大容量
    if (this.size >= this.maxSize) {
      this.evict();
    }
    
    this.cache.set(key, { value, expiresAt });
    this.size++;
    
    // 保存到文件
    this.save();
  }

  /**
   * 获取缓存
   * @param key 键
   * @returns 值或undefined
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);
    
    if (!item) {
      return undefined;
    }
    
    // 检查是否过期
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key);
      return undefined;
    }
    
    return item.value;
  }

  /**
   * 删除缓存
   * @param key 键
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.size--;
      this.save();
    }
    return deleted;
  }

  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    
    if (!item) {
      return false;
    }
    
    // 检查是否过期
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.size = 0;
    this.save();
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  size(): number {
    return this.size;
  }

  /**
   * 淘汰缓存项（LRU策略）
   */
  private evict(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.delete(firstKey);
    }
  }

  /**
   * 清理过期项
   */
  cleanup(): void {
    const now = Date.now();
    
    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        this.delete(key);
      }
    }
  }

  /**
   * 保存缓存到文件
   */
  private save(): void {
    try {
      const fs = require('fs');
      const data = Array.from(this.cache.entries());
      fs.writeFileSync(this.filePath, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  /**
   * 从文件加载缓存
   */
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const entries = JSON.parse(data) as [string, CacheItem<T>][];
        
        this.cache = new Map(entries);
        this.size = entries.length;
        
        // 清理过期项
        this.cleanup();
      }
    } catch (error) {
      console.error('Failed to load cache:', error);
    }
  }
}

/**
 * 多级缓存类
 */
export class MultiLevelCache<T = any> {
  private memoryCache: MemoryCache<T>;
  private persistentCache?: PersistentCache<T>;

  /**
   * 构造函数
   * @param memorySize 内存缓存大小
   * @param persistentFile 持久化缓存文件路径
   * @param persistentSize 持久化缓存大小
   */
  constructor(
    memorySize: number = 1000,
    persistentFile?: string,
    persistentSize: number = 10000
  ) {
    this.memoryCache = new MemoryCache<T>(memorySize);
    
    if (persistentFile) {
      this.persistentCache = new PersistentCache<T>(persistentFile, persistentSize);
    }
  }

  /**
   * 设置缓存
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（毫秒）
   * @param persistent 是否持久化
   */
  set(key: string, value: T, ttl?: number, persistent: boolean = false): void {
    // 总是设置到内存缓存
    this.memoryCache.set(key, value, ttl);
    
    // 如果需要持久化且持久化缓存存在
    if (persistent && this.persistentCache) {
      this.persistentCache.set(key, value, ttl);
    }
  }

  /**
   * 获取缓存
   * @param key 键
   * @returns 值或undefined
   */
  get(key: string): T | undefined {
    // 先从内存缓存获取
    let value = this.memoryCache.get(key);
    
    // 如果内存缓存中没有，从持久化缓存获取
    if (value === undefined && this.persistentCache) {
      value = this.persistentCache.get(key);
      
      // 如果持久化缓存中有，回填到内存缓存
      if (value !== undefined) {
        this.memoryCache.set(key, value);
      }
    }
    
    return value;
  }

  /**
   * 删除缓存
   * @param key 键
   */
  delete(key: string): void {
    this.memoryCache.delete(key);
    
    if (this.persistentCache) {
      this.persistentCache.delete(key);
    }
  }

  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.memoryCache.has(key) || 
           (this.persistentCache?.has(key) ?? false);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.memoryCache.clear();
    
    if (this.persistentCache) {
      this.persistentCache.clear();
    }
  }

  /**
   * 清理过期项
   */
  cleanup(): void {
    this.memoryCache.cleanup();
    
    if (this.persistentCache) {
      this.persistentCache.cleanup();
    }
  }

  /**
   * 获取内存缓存大小
   * @returns 内存缓存大小
   */
  getMemorySize(): number {
    return this.memoryCache.size();
  }

  /**
   * 获取持久化缓存大小
   * @returns 持久化缓存大小
   */
  getPersistentSize(): number {
    return this.persistentCache?.size() ?? 0;
  }
}
