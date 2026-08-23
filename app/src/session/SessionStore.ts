import { getLogger } from '@modules/monitoring';
import { FileSystemStorage } from './storage/FileSystemStorage';
import type { Session } from './models/Session';
import type { SessionMessage } from './models/SessionMessage';
import type { SessionMetadata } from './models/SessionMetadata';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from './SessionStorage';

const logger = getLogger('session:store');

interface CacheEntry<T> {
  value: T;
  lastAccess: number;
}

export interface SessionStoreOptions {
  maxCacheSize?: number;
  /** P1 第5条：消息缓存独立上限（消息体积远大于元数据，不共用 maxCacheSize） */
  messagesCacheMax?: number;
  storage?: SessionStorage;
  storageRootDir?: string;
}

// P1 第4条：稳态不溢出——插入后逐出到 ≤ 上限（而非"≤ 上限时跳过插入前逐出"）
const EVICT_TARGET_RATIO = 0.8;

export class SessionStore implements SessionStorage {
  private sessionCache: Map<string, CacheEntry<Session>> = new Map();
  private metadataCache: Map<string, CacheEntry<SessionMetadata>> = new Map();
  private messagesCache: Map<string, CacheEntry<SessionMessage[]>> = new Map();
  private maxCacheSize: number;
  private messagesCacheMax: number;
  private storage: SessionStorage;

  constructor(options: SessionStoreOptions = {}) {
    this.maxCacheSize = options.maxCacheSize ?? 100;
    this.messagesCacheMax = options.messagesCacheMax ?? 30;
    this.storage =
      options.storage ?? new FileSystemStorage(options.storageRootDir);
  }

  async saveSession(session: Session): Promise<void> {
    await this.storage.saveSession(session);
    this.sessionCache.set(session.id, {
      value: session,
      lastAccess: Date.now(),
    });
    // #14 修复：save 后同样逐出（原仅 loadSession 时逐出，反复 save 不同会话
    // 可超出 maxCacheSize 导致缓存无限膨胀）
    this.evictIfNeeded(this.sessionCache, this.maxCacheSize);
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    const cached = this.sessionCache.get(sessionId);
    if (cached) {
      // P1 第4条：命中移尾（Map 迭代序伪 LRU，O(1)，替代全 Map 扫描找最旧）
      this.sessionCache.delete(sessionId);
      this.sessionCache.set(sessionId, cached);
      cached.lastAccess = Date.now();
      return cached.value;
    }

    const session = await this.storage.loadSession(sessionId);
    if (session) {
      this.sessionCache.set(sessionId, {
        value: session,
        lastAccess: Date.now(),
      });
      this.evictIfNeeded(this.sessionCache, this.maxCacheSize);
    }
    return session;
  }

  async saveMessage(sessionId: string, message: SessionMessage): Promise<void> {
    await this.storage.saveMessage(sessionId, message);
    this.messagesCache.delete(sessionId);
  }

  async loadMessages(
    sessionId: string,
    options?: MessageLoadOptions
  ): Promise<SessionMessage[]> {
    if (!options) {
      const cached = this.messagesCache.get(sessionId);
      if (cached) {
        // P1 第4条：命中移尾
        this.messagesCache.delete(sessionId);
        this.messagesCache.set(sessionId, cached);
        cached.lastAccess = Date.now();
        return cached.value;
      }
    }

    const messages = await this.storage.loadMessages(sessionId, options);
    if (!options) {
      this.messagesCache.set(sessionId, {
        value: messages,
        lastAccess: Date.now(),
      });
      this.evictIfNeeded(this.messagesCache, this.messagesCacheMax);
    }
    return messages;
  }

  async saveMetadata(
    sessionId: string,
    metadata: SessionMetadata
  ): Promise<void> {
    await this.storage.saveMetadata(sessionId, metadata);
    this.metadataCache.set(sessionId, {
      value: metadata,
      lastAccess: Date.now(),
    });
    // P1-fix（M1）：saveMetadata 补缓存逐出 —— 原实现只 set 不 evictIfNeeded，
    // 高频保存不同会话元数据时 metadataCache 无限增长（内存泄漏）。
    this.evictIfNeeded(this.metadataCache, this.maxCacheSize);
  }

  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const cached = this.metadataCache.get(sessionId);
    if (cached) {
      // P1 第4条：命中移尾
      this.metadataCache.delete(sessionId);
      this.metadataCache.set(sessionId, cached);
      cached.lastAccess = Date.now();
      return cached.value;
    }

    const metadata = await this.storage.loadMetadata(sessionId);
    if (metadata) {
      this.metadataCache.set(sessionId, {
        value: metadata,
        lastAccess: Date.now(),
      });
      this.evictIfNeeded(this.metadataCache, this.maxCacheSize);
    }
    return metadata;
  }

  async deleteSession(sessionId: string): Promise<void> {
    logger.debug('deleteSession:SessionStore 入口，转发底层存储', {
      sessionId,
    });
    await this.storage.deleteSession(sessionId);
    this.sessionCache.delete(sessionId);
    this.metadataCache.delete(sessionId);
    this.messagesCache.delete(sessionId);
  }

  async listSessions(options?: SessionListOptions): Promise<string[]> {
    return this.storage.listSessions(options);
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    if (this.sessionCache.has(sessionId)) return true;
    return this.storage.sessionExists(sessionId);
  }

  async compactSession(sessionId: string): Promise<void> {
    logger.debug('compactSession:SessionStore 入口，转发底层存储', {
      sessionId,
    });
    await this.storage.compactSession(sessionId);
    this.sessionCache.delete(sessionId);
    this.metadataCache.delete(sessionId);
    this.messagesCache.delete(sessionId);
  }

  clearCache(): void {
    this.sessionCache.clear();
    this.metadataCache.clear();
    this.messagesCache.clear();
    logger.info('SessionStore cache cleared');
  }

  getCacheStats(): { sessions: number; metadata: number; messages: number } {
    return {
      sessions: this.sessionCache.size,
      metadata: this.metadataCache.size,
      messages: this.messagesCache.size,
    };
  }

  /**
   * P1 第4条：伪 LRU 批量逐出。
   * - 命中已把 key 移到 Map 尾部（迭代序 = 访问序），keys().next() 即最久未访问，O(1)
   * - 插入后逐出到 maxSize * EVICT_TARGET_RATIO（批量摊薄扫描成本，稳态不溢出）
   */
  private evictIfNeeded(
    cache: Map<string, CacheEntry<any>>,
    maxSize: number
  ): void {
    const target = Math.floor(maxSize * EVICT_TARGET_RATIO);
    while (cache.size > maxSize && cache.size > target) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }
}
