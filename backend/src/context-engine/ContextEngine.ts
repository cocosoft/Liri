/**
 * ContextEngine 上下文引擎
 * P2 — 对标 OpenClaw 的上下文引擎
 */

/**
 * 上下文条目
 */
export interface ContextEntry {
  id: string;
  key: string;
  value: unknown;
  scope: 'conversation' | 'session' | 'project' | 'global';
  priority: number;
  ttl?: number;
  createdAt: number;
  expiresAt?: number;
  tags: string[];
  source?: string;
}

/**
 * 上下文查询
 */
export interface ContextQuery {
  keys?: string[];
  scope?: ContextEntry['scope'];
  tags?: string[];
  limit?: number;
}

/**
 * 查询结果
 */
export interface ContextResult {
  entries: ContextEntry[];
  total: number;
  query: ContextQuery;
}

/**
 * 引擎配置
 */
export interface EngineConfig {
  maxEntries: number;
  defaultTTL: number;
  enableExpiry: boolean;
}

/**
 * 上下文引擎
 */
export class ContextEngine {
  private entries: Map<string, ContextEntry> = new Map();
  private config: EngineConfig;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<EngineConfig>) {
    this.config = {
      maxEntries: config?.maxEntries || 10000,
      defaultTTL: config?.defaultTTL || 3600000,
      enableExpiry: config?.enableExpiry !== false,
    };

    if (this.config.enableExpiry) {
      this.startExpiryCheck();
    }
  }

  /**
   * 设置上下文
   */
  set(key: string, value: unknown, options?: {
    scope?: ContextEntry['scope'];
    priority?: number;
    ttl?: number;
    tags?: string[];
    source?: string;
  }): ContextEntry {
    const entry: ContextEntry = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      key,
      value,
      scope: options?.scope || 'conversation',
      priority: options?.priority || 0,
      ttl: options?.ttl || this.config.defaultTTL,
      createdAt: Date.now(),
      expiresAt: Date.now() + (options?.ttl || this.config.defaultTTL),
      tags: options?.tags || [],
      source: options?.source,
    };

    if (this.entries.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(key, entry);

    return entry;
  }

  /**
   * 获取上下文
   */
  get(key: string): ContextEntry | undefined {
    const entry = this.entries.get(key);

    if (entry && entry.expiresAt && Date.now() > entry.expiresAt) {
      this.entries.delete(key);

      return undefined;
    }

    return entry;
  }

  /**
   * 查询上下文
   */
  query(query: ContextQuery): ContextResult {
    let results = Array.from(this.entries.values());

    if (query.keys) {
      results = results.filter((e) => query.keys!.includes(e.key));
    }

    if (query.scope) {
      results = results.filter((e) => e.scope === query.scope);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((t) => e.tags.includes(t)));
    }

    results = results.filter((e) => !e.expiresAt || Date.now() <= e.expiresAt);
    results.sort((a, b) => b.priority - a.priority);

    const total = results.length;

    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return { entries: results, total, query };
  }

  /**
   * 删除上下文
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * 清空上下文
   */
  clear(scope?: ContextEntry['scope']): void {
    if (scope) {
      for (const [key, entry] of this.entries.entries()) {
        if (entry.scope === scope) {
          this.entries.delete(key);
        }
      }
    } else {
      this.entries.clear();
    }
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byScope: Record<string, number> } {
    const byScope: Record<string, number> = {};

    for (const entry of this.entries.values()) {
      byScope[entry.scope] = (byScope[entry.scope] || 0) + 1;
    }

    return { total: this.entries.size, byScope };
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }

    this.entries.clear();
  }

  /**
   * 驱逐最旧条目
   */
  private evictOldest(): void {
    let oldest: ContextEntry | undefined;
    let oldestKey = '';

    for (const [key, entry] of this.entries.entries()) {
      if (!oldest || entry.createdAt < oldest.createdAt) {
        oldest = entry;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }

  /**
   * 启动过期检查
   */
  private startExpiryCheck(): void {
    this.expiryTimer = setInterval(() => {
      const now = Date.now();

      for (const [key, entry] of this.entries.entries()) {
        if (entry.expiresAt && now > entry.expiresAt) {
          this.entries.delete(key);
        }
      }
    }, 60000);
  }
}

export const contextEngine = new ContextEngine();
