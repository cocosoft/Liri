/**
 * SessionCache — 会话级缓存
 *
 * 按 session 隔离的缓存，每个缓存项支持 TTL 过期。
 * 支持 session 级清理和全局过期淘汰。
 *
 * 用法:
 * ```
 * const cache = new SessionCache<string>({ ttlMs: 60000 });
 * cache.set('session1', 'key1', 'value1');
 * const v = cache.get('session1', 'key1');   // 'value1'
 * cache.clearSession('session1');            // 清理该会话所有缓存
 * ```
 */

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * SessionCache 配置
 */
export interface SessionCacheOptions {
  ttlMs?: number;
  maxEntriesPerSession?: number;
  cleanupIntervalMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 默认 5 分钟
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_CLEANUP_INTERVAL = 60 * 1000; // 1 分钟

export class SessionCache<T = unknown> {
  private sessions: Map<string, Map<string, CacheEntry<T>>> = new Map();
  private options: Required<SessionCacheOptions>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionCacheOptions = {}) {
    this.options = {
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      maxEntriesPerSession: options.maxEntriesPerSession ?? DEFAULT_MAX_ENTRIES,
      cleanupIntervalMs: options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL,
    };
  }

  /**
   * 设置缓存项
   */
  set(sessionId: string, key: string, value: T, ttlMs?: number): void {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new Map();
      this.sessions.set(sessionId, session);
    }

    if (session.size >= this.options.maxEntriesPerSession) {
      const oldestKey = session.keys().next().value;
      if (oldestKey !== undefined) {
        session.delete(oldestKey);
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.options.ttlMs);
    session.set(key, { value, expiresAt });
  }

  /**
   * 获取缓存项
   */
  get(sessionId: string, key: string): T | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const entry = session.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      session.delete(key);
      if (session.size === 0) {
        this.sessions.delete(sessionId);
      }
      return undefined;
    }

    return entry.value;
  }

  /**
   * 删除指定缓存项
   */
  delete(sessionId: string, key: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const deleted = session.delete(key);
    if (session.size === 0) {
      this.sessions.delete(sessionId);
    }
    return deleted;
  }

  /**
   * 清理指定 session 的所有缓存
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 清空所有缓存
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * 手动触发过期淘汰
   */
  evictExpired(): number {
    let evicted = 0;
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      for (const [key, entry] of session) {
        if (now > entry.expiresAt) {
          session.delete(key);
          evicted++;
        }
      }
      if (session.size === 0) {
        this.sessions.delete(sessionId);
      }
    }

    return evicted;
  }

  /**
   * 开始自动过期清理（间隔执行 evictExpired）
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.evictExpired();
    }, this.options.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 停止自动过期清理
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 判断指定缓存项是否存在且未过期
   */
  has(sessionId: string, key: string): boolean {
    return this.get(sessionId, key) !== undefined;
  }

  /**
   * 获取缓存统计信息
   */
  stats(): { sessions: number; entries: number; totalEntries: number } {
    let totalEntries = 0;
    for (const session of this.sessions.values()) {
      totalEntries += session.size;
    }
    return {
      sessions: this.sessions.size,
      entries: totalEntries,
      totalEntries,
    };
  }

  /**
   * 获取指定 session 的缓存项数量
   */
  sessionSize(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    return session ? session.size : 0;
  }

  /**
   * 获取或设置缓存（若不存在则通过 factory 创建）
   */
  getOrSet(
    sessionId: string,
    key: string,
    factory: () => T,
    ttlMs?: number
  ): T {
    const existing = this.get(sessionId, key);
    if (existing !== undefined) return existing;

    const value = factory();
    this.set(sessionId, key, value, ttlMs);
    return value;
  }
}
