/**
 * 记忆同步服务
 * 对标 Hermes prefetch_all / sync_all
 * 管理记忆的批量预取和同步操作
 */
import type {
  ExternalMemoryProvider,
  ExternalMemoryEntry,
} from './providers/ExternalMemoryProvider';
import { getExternalMemoryProviderRegistry } from './providers/ExternalMemoryProvider';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:MemorySyncService');

/**
 * 同步状态
 */
export type SyncStatus = 'idle' | 'syncing' | 'prefetching' | 'error';

/**
 * 同步记录
 */
export interface SyncRecord {
  id: string;
  providerId: string;
  status: SyncStatus;
  startedAt: number;
  completedAt: number | null;
  entriesCount: number;
  error?: string;
}

/**
 * 同步配置
 */
export interface SyncConfig {
  prefetchIntervalMs: number;
  maxEntriesPerSync: number;
  retryCount: number;
  retryDelayMs: number;
}

/**
 * 默认同步配置
 */
const DEFAULT_SYNC_CONFIG: SyncConfig = {
  prefetchIntervalMs: 300_000,
  maxEntriesPerSync: 500,
  retryCount: 3,
  retryDelayMs: 5000,
};

/**
 * 记忆同步服务
 */
export class MemorySyncService {
  private config: SyncConfig;
  private history: SyncRecord[] = [];
  private maxHistory: number = 100;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private prefetchCache: ExternalMemoryEntry[] = [];
  private cacheExpiry: number = 0;

  /**
   * 构造函数
   * @param config 同步配置
   */
  constructor(config?: Partial<SyncConfig>) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /**
   * 从所有提供商预取记忆
   * @param limit 最大条目数
   * @returns 预取的记忆条目
   */
  async prefetchAll(limit?: number): Promise<ExternalMemoryEntry[]> {
    const maxEntries = limit || this.config.maxEntriesPerSync;

    if (this.prefetchCache.length > 0 && Date.now() < this.cacheExpiry) {
      return this.prefetchCache.slice(0, maxEntries);
    }

    const registry = getExternalMemoryProviderRegistry();
    const providers = registry.getAll();

    const entries = await registry.fetchAllFromAllProviders({
      limit: maxEntries,
    });

    this.prefetchCache = entries;
    this.cacheExpiry = Date.now() + this.config.prefetchIntervalMs;

    return entries;
  }

  /**
   * 同步所有提供商的记忆
   * @returns 同步记录列表
   */
  async syncAll(): Promise<SyncRecord[]> {
    const registry = getExternalMemoryProviderRegistry();
    const providers = registry.getAll();
    const records: SyncRecord[] = [];

    for (const provider of providers) {
      const record = await this.syncProvider(provider);
      records.push(record);
    }

    return records;
  }

  /**
   * 同步单个提供商
   * @param provider 提供商实例
   * @returns 同步记录
   */
  private async syncProvider(
    provider: ExternalMemoryProvider
  ): Promise<SyncRecord> {
    const record: SyncRecord = {
      id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      providerId: provider.id,
      status: 'syncing',
      startedAt: Date.now(),
      completedAt: null,
      entriesCount: 0,
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retryCount; attempt++) {
      try {
        const entries = await provider.fetchAllMemories({
          limit: this.config.maxEntriesPerSync,
        });

        await provider.syncMemories(entries);

        record.entriesCount = entries.length;
        record.status = 'syncing';
        record.completedAt = Date.now();
        record.status = 'idle';

        this.addToHistory(record);

        return record;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.config.retryCount - 1) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    record.status = 'error';
    record.error = lastError?.message || '同步失败';
    record.completedAt = Date.now();

    this.addToHistory(record);

    return record;
  }

  /**
   * 启动定期同步
   */
  startAutoSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setInterval(() => {
      this.syncAll()
        .then(() => {
          // @ignore-catch — 同步完成后的预取是fire-and-forget优化，非关键路径
          this.prefetchAll().catch(() => {});
        })
        // @ignore-catch — 后台定时同步失败不阻塞主流程
        .catch(() => {});
    }, this.config.prefetchIntervalMs);
  }

  /**
   * 停止定期同步
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * 获取同步历史
   * @param limit 最大条数
   * @returns 同步记录列表
   */
  getHistory(limit?: number): SyncRecord[] {
    const sorted = [...this.history].sort((a, b) => b.startedAt - a.startedAt);

    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 获取提供商的上次同步状态
   * @param providerId 提供商 ID
   * @returns 同步记录
   */
  getLastSyncForProvider(providerId: string): SyncRecord | undefined {
    return this.history.find((r) => r.providerId === providerId);
  }

  /**
   * 添加同步记录到历史
   * @param record 同步记录
   */
  private addToHistory(record: SyncRecord): void {
    this.history.push(record);

    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  /**
   * 延迟函数
   * @param ms 毫秒
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取预取缓存
   * @returns 预取的记忆条目
   */
  getPrefetchCache(): ExternalMemoryEntry[] {
    return [...this.prefetchCache];
  }

  /**
   * 清除预取缓存
   */
  clearPrefetchCache(): void {
    this.prefetchCache = [];
    this.cacheExpiry = 0;
  }
}

/**
 * 全局同步服务实例
 */
let globalSyncService: MemorySyncService | null = null;

/**
 * 获取全局记忆同步服务
 * @returns MemorySyncService 实例
 */
export function getMemorySyncService(): MemorySyncService {
  if (!globalSyncService) {
    globalSyncService = new MemorySyncService();
  }

  return globalSyncService;
}
