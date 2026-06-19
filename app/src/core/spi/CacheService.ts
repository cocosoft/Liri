/**
 * TTL 缓存 SPI
 *
 * core 层用的轻量 TTL 缓存实现，不依赖 infra/utils 层。
 * 纯内存 Map 实现，无外部依赖。
 */

/** TTL 缓存条目 */
interface TtlEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * 带 TTL 的简单内存缓存
 *
 * 提供 set/get/delete/clear 基本操作，自动淘汰过期条目。
 * 达到 maxSize 时按插入顺序淘汰最旧条目。
 */
export class TtlCache<T = unknown> {
  private cache = new Map<string, TtlEntry<T>>();
  private keysOrder: string[] = [];

  constructor(
    private maxSize: number = 1000,
    private defaultTtlMs: number = 300_000
  ) {}

  /** 设置缓存项 */
  set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);

    if (this.cache.has(key)) {
      this.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, { value, expiresAt });
    this.keysOrder.push(key);
  }

  /** 获取缓存项，过期返回 null */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.value;
  }

  /** 检查键是否存在（未过期） */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /** 删除缓存项 */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.keysOrder = this.keysOrder.filter((k) => k !== key);
    }
    return deleted;
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
    this.keysOrder = [];
  }

  /** 当前缓存项数量 */
  size(): number {
    return this.cache.size;
  }

  /** 淘汰最旧条目 */
  private evict(): void {
    const oldest = this.keysOrder.shift();
    if (oldest !== undefined) {
      this.cache.delete(oldest);
    }
  }
}
