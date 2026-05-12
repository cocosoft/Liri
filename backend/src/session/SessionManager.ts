import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { SessionStore } from './SessionStore';
import { SessionPruner } from './SessionPruner';
import type { PrunerOptions } from './SessionPruner';
import { SessionLock } from './SessionLock';
import type { LockOptions } from './SessionLock';
import { SessionMigration } from './SessionMigration';
import { FileSystemStorage } from './storage/FileSystemStorage';
import type { SessionStorage } from './SessionStorage';

const logger = new Logger({ level: LogLevel.INFO });

export interface SessionManagerConfig {
  storageRootDir?: string;
  storage?: SessionStorage;
  maxCacheSize?: number;
  prunerOptions?: PrunerOptions;
  lockOptions?: LockOptions;
  enablePruner?: boolean;
  enableMigration?: boolean;
  enableLock?: boolean;
}

export class SessionManager {
  static instance: SessionManager;

  readonly store: SessionStore;
  readonly pruner: SessionPruner;
  readonly lock: SessionLock;
  readonly migration: SessionMigration;

  private config: Required<
    Omit<SessionManagerConfig, 'storage' | 'prunerOptions' | 'lockOptions'>
  > & {
    storage?: SessionStorage;
    prunerOptions?: PrunerOptions;
    lockOptions?: LockOptions;
  };
  private prunerInterval: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      storageRootDir: config.storageRootDir ?? './data/sessions',
      maxCacheSize: config.maxCacheSize ?? 100,
      enablePruner: config.enablePruner ?? true,
      enableMigration: config.enableMigration ?? true,
      enableLock: config.enableLock ?? true,
      storage: config.storage,
      prunerOptions: config.prunerOptions,
      lockOptions: config.lockOptions,
    };

    const storage =
      this.config.storage ?? new FileSystemStorage(this.config.storageRootDir);

    this.store = new SessionStore({
      maxCacheSize: this.config.maxCacheSize,
      storage,
    });

    this.pruner = new SessionPruner(storage, this.config.prunerOptions);
    this.lock = this.config.enableLock
      ? new SessionLock(this.config.lockOptions)
      : (null as unknown as SessionLock);
    this.migration = this.config.enableMigration
      ? new SessionMigration()
      : (null as unknown as SessionMigration);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('SessionManager initializing');

    if (this.config.enablePruner) {
      this.startPruner();
    }

    this.initialized = true;
    logger.info('SessionManager initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    logger.info('SessionManager shutting down');

    this.stopPruner();

    if (this.config.enableLock) {
      await this.lock.releaseAll();
    }

    this.store.clearCache();
    this.initialized = false;

    logger.info('SessionManager shut down');
  }

  async pruneNow(): Promise<import('./SessionPruner').PruneResult> {
    return this.pruner.prune();
  }

  async getCacheStats(): Promise<{
    sessions: number;
    metadata: number;
    messages: number;
  }> {
    return this.store.getCacheStats();
  }

  async getPruneEstimate(): Promise<{
    total: number;
    ageCandidates: number;
    countCandidates: number;
    activeSessions: number;
  }> {
    return this.pruner.getPruneEstimate();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private startPruner(): void {
    this.stopPruner();
    this.prunerInterval = setInterval(
      () => {
        this.pruner.prune();
      },
      60 * 60 * 1000
    );
    this.prunerInterval.unref();
  }

  private stopPruner(): void {
    if (this.prunerInterval) {
      clearInterval(this.prunerInterval);
      this.prunerInterval = null;
    }
  }
}

const sessionManager = new SessionManager();
SessionManager.instance = sessionManager;

export function createSessionManager(
  config?: SessionManagerConfig
): SessionManager {
  return new SessionManager(config);
}

export default sessionManager;
