/**
 * StickerCache 贴纸缓存
 * 基于 TTLCache 实现，支持容量控制和统计
 */

import { TTLCache } from '@modules/utils/cache';

/**
 * 贴纸元数据
 */
export interface StickerMeta {
  /** 贴纸唯一标识 */
  id: string;
  /** 贴纸包名 */
  pack: string;
  /** 贴纸 URL */
  url: string;
  /** 贴纸类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 宽（像素） */
  width: number;
  /** 高（像素） */
  height: number;
  /** 缓存时间戳 */
  cachedAt: number;
  /** 访问次数 */
  accessCount: number;
}

/** TTLCache 内部存储值类型 */
interface StickerCacheValue {
  meta: StickerMeta;
  data: Buffer | null;
}

/**
 * StickerCache - 基于 TTLCache 的贴纸缓存
 */
export class StickerCache {
  private cache: TTLCache<StickerCacheValue>;
  private capacity: number;
  private hits = 0;
  private misses = 0;
  private cachedKeys: string[] = [];

  /**
   * @param capacity 最大缓存条目数（默认 200）
   */
  constructor(capacity: number = 200) {
    this.capacity = capacity;
    this.cache = new TTLCache<StickerCacheValue>(capacity, 86400000);
  }

  /**
   * 获取贴纸缓存
   * @param key 贴纸键
   * @returns 贴纸元数据与数据缓冲区，未命中返回 null
   */
  get(key: string): { meta: StickerMeta; data: Buffer | null } | null {
    const value = this.cache.get(key);

    if (!value) {
      this.misses++;
      return null;
    }

    this.hits++;
    value.meta.accessCount++;

    return { meta: value.meta, data: value.data };
  }

  /**
   * 存入贴纸缓存
   * @param key 贴纸键
   * @param meta 贴纸元数据
   * @param data 贴纸二进制数据
   */
  set(key: string, meta: StickerMeta, data: Buffer | null = null): void {
    this.cache.set(key, {
      meta: { ...meta, cachedAt: Date.now(), accessCount: 0 },
      data,
    });

    if (!this.cachedKeys.includes(key)) {
      this.cachedKeys.push(key);
    }
  }

  /**
   * 检查键是否存在
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 删除指定缓存
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);

    if (result) {
      this.cachedKeys = this.cachedKeys.filter((k) => k !== key);
    }

    return result;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.cachedKeys = [];
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    capacity: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    const stats = this.cache.getStats();

    return {
      size: stats.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * 获取所有缓存的贴纸键列表
   */
  keys(): string[] {
    return this.cachedKeys.filter((k) => this.cache.has(k));
  }
}
