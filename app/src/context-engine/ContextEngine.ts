/**
 * ContextEngine 上下文引擎
 * P2 — 对标 OpenClaw 的上下文引擎
 * Phase 5: 接入 Logger + handleError + scope-aware KV 存储
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('context:engine');

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
 *
 * Phase 5: 已接入基础设施
 * - Logger (module: context:engine)
 * - handleError (各 catch 块统一处理)
 * - scope-aware KV 存储（set/get/delete 均使用 `${scope}:${key}` 复合键）
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

    logger.info('context:engine initialized', {
      maxEntries: this.config.maxEntries,
      defaultTTL: this.config.defaultTTL,
      enableExpiry: this.config.enableExpiry,
    });

    if (this.config.enableExpiry) {
      this.startExpiryCheck();
    }
  }

  /**
   * 设置上下文
   */
  set(
    key: string,
    value: unknown,
    options?: {
      scope?: ContextEntry['scope'];
      priority?: number;
      ttl?: number;
      tags?: string[];
      source?: string;
    }
  ): ContextEntry {
    try {
      // BUG-8 fix: ttl:0 = never expires (use ?? not || for falsy check)
      const ttl =
        options?.ttl !== undefined ? options.ttl : this.config.defaultTTL;
      const expiresAt = ttl === 0 ? undefined : Date.now() + ttl;
      const entry: ContextEntry = {
        id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        key,
        value,
        scope: options?.scope || 'conversation',
        priority: options?.priority || 0,
        ttl: ttl === 0 ? undefined : ttl,
        createdAt: Date.now(),
        expiresAt,
        tags: options?.tags || [],
        source: options?.source,
      };

      const scopedKey = `${entry.scope}:${key}`;

      if (this.entries.size >= this.config.maxEntries) {
        const evicted = this.evictOldest();
        logger.debug('context:engine evicted entry (store full)', {
          scopedKey,
          evictedKey: evicted,
          size: this.entries.size,
          maxEntries: this.config.maxEntries,
        });
      }

      this.entries.set(scopedKey, entry);

      logger.debug('context:engine set', {
        scopedKey,
        scope: entry.scope,
        priority: entry.priority,
        tags: entry.tags,
      });

      return entry;
    } catch (error) {
      void handleError(error, {
        module: 'context:engine',
        action: 'set',
        context: { key, scope: options?.scope },
      });
      throw error;
    }
  }

  /**
   * 获取上下文
   */
  get(key: string, scope?: string): ContextEntry | undefined {
    try {
      // BUG-7 fix: default scope to 'conversation' (matching set()'s default)
      const scopedKey = scope ? `${scope}:${key}` : `conversation:${key}`;
      const entry = this.entries.get(scopedKey);

      if (entry && entry.expiresAt && Date.now() > entry.expiresAt) {
        this.entries.delete(scopedKey);
        logger.debug('context:engine get — entry expired', { scopedKey });
        return undefined;
      }

      return entry;
    } catch (error) {
      void handleError(error, {
        module: 'context:engine',
        action: 'get',
        context: { key, scope },
      });
      return undefined;
    }
  }

  /**
   * 查询上下文
   */
  query(query: ContextQuery): ContextResult {
    try {
      let results = Array.from(this.entries.values());

      if (query.keys) {
        results = results.filter((e) => query.keys!.includes(e.key));
      }

      if (query.scope) {
        results = results.filter((e) => e.scope === query.scope);
      }

      if (query.tags && query.tags.length > 0) {
        results = results.filter((e) =>
          query.tags!.some((t) => e.tags.includes(t))
        );
      }

      results = results.filter(
        (e) => !e.expiresAt || Date.now() <= e.expiresAt
      );
      results.sort((a, b) => b.priority - a.priority);

      const total = results.length;

      if (query.limit && query.limit > 0) {
        results = results.slice(0, query.limit);
      }

      return { entries: results, total, query };
    } catch (error) {
      void handleError(error, {
        module: 'context:engine',
        action: 'query',
        context: { queryKeys: query.keys, scope: query.scope },
      });
      return { entries: [], total: 0, query };
    }
  }

  /**
   * 删除上下文
   */
  delete(key: string, scope?: string): boolean {
    try {
      const scopedKey = scope ? `${scope}:${key}` : `conversation:${key}`;
      const deleted = this.entries.delete(scopedKey);

      logger.debug('context:engine delete', { scopedKey, deleted });

      return deleted;
    } catch (error) {
      void handleError(error, {
        module: 'context:engine',
        action: 'delete',
        context: { key, scope },
      });
      return false;
    }
  }

  /**
   * 清空上下文
   */
  clear(scope?: ContextEntry['scope']): void {
    try {
      if (scope) {
        let count = 0;
        for (const [key, entry] of this.entries.entries()) {
          if (entry.scope === scope) {
            this.entries.delete(key);
            count++;
          }
        }
        logger.info('context:engine clear scope', { scope, removed: count });
      } else {
        const total = this.entries.size;
        this.entries.clear();
        logger.info('context:engine clear all', { removed: total });
      }
    } catch (error) {
      void handleError(error, {
        module: 'context:engine',
        action: 'clear',
        context: { scope },
      });
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
    logger.info('context:engine destroying', {
      totalEntries: this.entries.size,
    });

    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }

    this.entries.clear();
  }

  /**
   * 驱逐最旧条目
   * @returns 被驱逐条目的 scopedKey，或 null
   */
  private evictOldest(): string | null {
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
      return oldestKey;
    }

    return null;
  }

  /**
   * 启动过期检查
   */
  private startExpiryCheck(): void {
    this.expiryTimer = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      for (const [key, entry] of this.entries.entries()) {
        if (entry.expiresAt && now > entry.expiresAt) {
          this.entries.delete(key);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        logger.debug('context:engine expiry check', {
          expiredCount,
          remaining: this.entries.size,
        });
      }
    }, 60000);
    // BUG-11 fix: don't prevent process exit / GC
    if (this.expiryTimer && typeof this.expiryTimer.unref === 'function') {
      this.expiryTimer.unref();
    }
  }
}

/** 全局单例（接入 ContextManager 后由 DI 管理，单例仅作默认回退） */
export const contextEngine = new ContextEngine();
