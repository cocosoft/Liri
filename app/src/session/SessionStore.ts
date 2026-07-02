import { Logger, LogLevel } from '@modules/monitoring';
import { FileSystemStorage } from './storage/FileSystemStorage';
import type { Session } from './models/Session';
import type { SessionMessage } from './models/SessionMessage';
import type { SessionMetadata } from './models/SessionMetadata';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from './SessionStorage';

const logger = new Logger({ module: 'session:store', level: LogLevel.INFO });

interface CacheEntry<T> {
  value: T;
  lastAccess: number;
}

export interface SessionStoreOptions {
  maxCacheSize?: number;
  storage?: SessionStorage;
  storageRootDir?: string;
}

export class SessionStore implements SessionStorage {
  private sessionCache: Map<string, CacheEntry<Session>> = new Map();
  private metadataCache: Map<string, CacheEntry<SessionMetadata>> = new Map();
  private messagesCache: Map<string, CacheEntry<SessionMessage[]>> = new Map();
  private maxCacheSize: number;
  private storage: SessionStorage;

  constructor(options: SessionStoreOptions = {}) {
    this.maxCacheSize = options.maxCacheSize ?? 100;
    this.storage =
      options.storage ?? new FileSystemStorage(options.storageRootDir);
  }

  async saveSession(session: Session): Promise<void> {
    await this.storage.saveSession(session);
    this.sessionCache.set(session.id, {
      value: session,
      lastAccess: Date.now(),
    });
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    const cached = this.sessionCache.get(sessionId);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.value;
    }

    const session = await this.storage.loadSession(sessionId);
    if (session) {
      this.evictIfNeeded(this.sessionCache);
      this.sessionCache.set(sessionId, {
        value: session,
        lastAccess: Date.now(),
      });
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
        cached.lastAccess = Date.now();
        return cached.value;
      }
    }

    const messages = await this.storage.loadMessages(sessionId, options);
    if (!options) {
      this.evictIfNeeded(this.messagesCache);
      this.messagesCache.set(sessionId, {
        value: messages,
        lastAccess: Date.now(),
      });
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
  }

  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const cached = this.metadataCache.get(sessionId);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.value;
    }

    const metadata = await this.storage.loadMetadata(sessionId);
    if (metadata) {
      this.evictIfNeeded(this.metadataCache);
      this.metadataCache.set(sessionId, {
        value: metadata,
        lastAccess: Date.now(),
      });
    }
    return metadata;
  }

  async deleteSession(sessionId: string): Promise<void> {
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

  private evictIfNeeded(cache: Map<string, CacheEntry<any>>): void {
    if (cache.size <= this.maxCacheSize) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}
