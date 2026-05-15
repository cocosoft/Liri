/**
 * StickerCache 贴纸 LRU 缓存
 * 对标 Hermes 的贴纸缓存机制
 */

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

/**
 * LRU 贴纸缓存节点
 */
interface CacheNode {
  key: string;
  meta: StickerMeta;
  data: Buffer | null;
  prev: CacheNode | null;
  next: CacheNode | null;
}

/**
 * StickerCache - 基于 LRU 的贴纸缓存
 */
export class StickerCache {
  private capacity: number;
  private cache: Map<string, CacheNode>;
  private head: CacheNode | null;
  private tail: CacheNode | null;
  private hits: number;
  private misses: number;

  /**
   * @param capacity 最大缓存条目数（默认 200）
   */
  constructor(capacity: number = 200) {
    this.capacity = capacity;
    this.cache = new Map();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 获取贴纸缓存
   * @param key 贴纸键
   * @returns 贴纸元数据与数据缓冲区，未命中返回 null
   */
  get(key: string): { meta: StickerMeta; data: Buffer | null } | null {
    const node = this.cache.get(key);

    if (!node) {
      this.misses++;
      return null;
    }

    this.hits++;
    node.meta.accessCount++;
    this.moveToHead(node);

    return { meta: node.meta, data: node.data };
  }

  /**
   * 存入贴纸缓存
   * @param key 贴纸键
   * @param meta 贴纸元数据
   * @param data 贴纸二进制数据
   */
  set(key: string, meta: StickerMeta, data: Buffer | null = null): void {
    const existing = this.cache.get(key);

    if (existing) {
      existing.meta = { ...meta, cachedAt: Date.now(), accessCount: existing.meta.accessCount };
      existing.data = data;
      this.moveToHead(existing);
      return;
    }

    if (this.cache.size >= this.capacity) {
      this.evictTail();
    }

    const node: CacheNode = {
      key,
      meta: { ...meta, cachedAt: Date.now(), accessCount: 0 },
      data,
      prev: null,
      next: null,
    };

    this.cache.set(key, node);
    this.addToHead(node);
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
    const node = this.cache.get(key);

    if (!node) return false;

    this.removeNode(node);
    this.cache.delete(key);

    return true;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; capacity: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;

    return {
      size: this.cache.size,
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
    return Array.from(this.cache.keys());
  }

  private addToHead(node: CacheNode): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: CacheNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private moveToHead(node: CacheNode): void {
    if (node === this.head) return;

    this.removeNode(node);
    this.addToHead(node);
  }

  private evictTail(): void {
    if (!this.tail) return;

    const key = this.tail.key;
    this.removeNode(this.tail);
    this.cache.delete(key);
  }
}
