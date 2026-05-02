/**
 * 团队记忆同步服务
 * 负责团队记忆的完整同步流程
 * 参考CC源码 cc_code/backend/services/teamMemorySync/ 实现
 */

import { logger } from '../../utils/log';
import { MemorySecretScanner, defaultMemorySecretScanner } from '../scanners/MemorySecretScanner';

/**
 * 同步方向
 */
export type SyncDirection = 'upload' | 'download' | 'bidirectional' | 'skip';

/**
 * 冲突解决策略
 */
export type ConflictResolution = 'local_wins' | 'remote_wins' | 'manual' | 'newest_wins';

/**
 * 同步状态
 */
export enum SyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  SUCCESS = 'success',
  ERROR = 'error',
  CONFLICT = 'conflict',
}

/**
 * 单个记忆的同步状态
 */
export interface MemorySyncState {
  memoryId: string;
  localEtag: string | null;
  remoteEtag: string | null;
  localModified: number;
  remoteModified: number;
  status: 'synced' | 'local_newer' | 'remote_newer' | 'local_only' | 'remote_only' | 'conflict';
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  skipped: number;
  conflicts: string[];
  errors: string[];
  duration: number;
}

/**
 * 服务器记忆条目
 */
interface ServerMemoryEntry {
  id: string;
  content: string;
  metadata: {
    createdAt: string;
    modifiedAt: string;
    etag: string;
    tags?: string[];
    type?: string;
  };
}

/**
 * 团队记忆同步器配置
 */
export interface TeamMemorySyncConfig {
  serverUrl: string;
  teamId: string;
  localDir: string;
  syncInterval: number;
  conflictResolution: ConflictResolution;
  enableSecretScan: boolean;
  maxConcurrent: number;
  timeout: number;
  incremental: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: TeamMemorySyncConfig = {
  serverUrl: '',
  teamId: 'default',
  localDir: './data/team-memory',
  syncInterval: 300000,
  conflictResolution: 'local_wins',
  enableSecretScan: true,
  maxConcurrent: 5,
  timeout: 30000,
  incremental: true,
};

/**
 * 团队记忆同步器
 */
export class TeamMemorySyncService {
  private config: TeamMemorySyncConfig;
  private status: SyncStatus = SyncStatus.IDLE;
  private secretScanner: MemorySecretScanner;
  private etagCache: Map<string, string> = new Map();
  private memoryStates: Map<string, MemorySyncState> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  private listeners: Array<(status: SyncStatus, result?: SyncResult) => void> = [];

  constructor(config: Partial<TeamMemorySyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.secretScanner = defaultMemorySecretScanner;
  }

  /**
   * 启动自动同步
   */
  start(): void {
    if (this.syncTimer) {
      logger.warn('TeamMemorySyncService already running');
      return;
    }

    this.syncTimer = setInterval(() => {
      this.sync().catch(error => {
        logger.error('Auto sync failed:', error);
      });
    }, this.config.syncInterval);

    logger.info(`TeamMemorySyncService started with interval ${this.config.syncInterval}ms`);
  }

  /**
   * 停止自动同步
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    logger.info('TeamMemorySyncService stopped');
  }

  /**
   * 执行同步
   */
  async sync(): Promise<SyncResult> {
    if (this.status === SyncStatus.SYNCING) {
      logger.warn('Sync already in progress');
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        skipped: 0,
        conflicts: [],
        errors: ['Sync already in progress'],
        duration: 0,
      };
    }

    const startTime = Date.now();
    this.status = SyncStatus.SYNCING;
    this.notifyListeners(SyncStatus.SYNCING);

    const result: SyncResult = {
      success: true,
      uploaded: 0,
      downloaded: 0,
      skipped: 0,
      conflicts: [],
      errors: [],
      duration: 0,
    };

    try {
      const [localMemories, remoteMemories] = await Promise.all([
        this.getLocalMemories(),
        this.fetchRemoteMemories(),
      ]);

      this.compareMemories(localMemories, remoteMemories);

      const syncTasks = this.buildSyncTasks();

      const stateEntries = Array.from(this.memoryStates.entries());
      for (const [memoryId, state] of stateEntries) {
        if (state.status === 'conflict') {
          const resolved = await this.resolveConflict(memoryId, state);
          if (!resolved) {
            result.conflicts.push(memoryId);
          }
        }
      }

      const uploadTasks = syncTasks.filter(t => t.direction === 'upload');
      for (const task of uploadTasks) {
        try {
          await this.uploadMemory(task.memoryId, task.content);
          result.uploaded++;
        } catch (error) {
          result.errors.push(`Upload failed for ${task.memoryId}: ${error}`);
        }
      }

      const downloadTasks = syncTasks.filter(t => t.direction === 'download');
      for (const task of downloadTasks) {
        try {
          await this.downloadMemory(task.memoryId, task.content);
          result.downloaded++;
        } catch (error) {
          result.errors.push(`Download failed for ${task.memoryId}: ${error}`);
        }
      }

      result.skipped = syncTasks.filter(t => t.direction === 'skip').length;

      result.success = result.errors.length === 0;
      this.status = result.success ? SyncStatus.SUCCESS : SyncStatus.ERROR;

    } catch (error) {
      logger.error('Sync failed:', error);
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
      this.status = SyncStatus.ERROR;
    }

    result.duration = Date.now() - startTime;
    this.lastSyncTime = Date.now();
    this.notifyListeners(this.status, result);

    return result;
  }

  /**
   * 获取本地记忆列表
   */
  private async getLocalMemories(): Promise<Map<string, { content: string; modified: number; etag: string }>> {
    const memories = new Map<string, { content: string; modified: number; etag: string }>();
    return memories;
  }

  /**
   * 获取远程记忆列表
   */
  private async fetchRemoteMemories(): Promise<Map<string, ServerMemoryEntry>> {
    const memories = new Map<string, ServerMemoryEntry>();

    if (!this.config.serverUrl) {
      return memories;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/teams/${this.config.teamId}/memories`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const entries: ServerMemoryEntry[] = data.memories || [];

      for (const entry of entries) {
        memories.set(entry.id, entry);
      }

      const etag = response.headers.get('ETag');
      if (etag) {
        this.updateEtagCache(memories, etag);
      }

    } catch (error) {
      logger.error('Failed to fetch remote memories:', error);
    }

    return memories;
  }

  /**
   * 比较本地和远程记忆
   */
  private compareMemories(
    localMemories: Map<string, { content: string; modified: number; etag: string }>,
    remoteMemories: Map<string, ServerMemoryEntry>
  ): void {
    this.memoryStates.clear();

    const localEntries = Array.from(localMemories.entries());
    for (const [memoryId, local] of localEntries) {
      const remote = remoteMemories.get(memoryId);

      const state: MemorySyncState = {
        memoryId,
        localEtag: local.etag,
        localModified: local.modified,
        remoteEtag: remote?.metadata.etag || null,
        remoteModified: remote ? new Date(remote.metadata.modifiedAt).getTime() : 0,
        status: 'local_only',
      };

      if (remote) {
        if (local.etag === remote.metadata.etag) {
          state.status = 'synced';
        } else if (local.modified > new Date(remote.metadata.modifiedAt).getTime()) {
          state.status = 'local_newer';
        } else {
          state.status = 'remote_newer';
        }
      }

      this.memoryStates.set(memoryId, state);
    }

    const remoteEntries = Array.from(remoteMemories.entries());
    for (const [memoryId, remote] of remoteEntries) {
      if (!this.memoryStates.has(memoryId)) {
        this.memoryStates.set(memoryId, {
          memoryId,
          localEtag: null,
          localModified: 0,
          remoteEtag: remote.metadata.etag,
          remoteModified: new Date(remote.metadata.modifiedAt).getTime(),
          status: 'remote_only',
        });
      }
    }
  }

  /**
   * 构建同步任务
   */
  private buildSyncTasks(): Array<{ memoryId: string; direction: SyncDirection; content?: string }> {
    const tasks: Array<{ memoryId: string; direction: SyncDirection; content?: string }> = [];

    const stateEntries = Array.from(this.memoryStates.entries());
    for (const [memoryId, state] of stateEntries) {
      switch (state.status) {
        case 'local_newer':
          tasks.push({ memoryId, direction: 'upload' });
          break;
        case 'remote_newer':
          tasks.push({ memoryId, direction: 'download' });
          break;
        case 'local_only':
          tasks.push({ memoryId, direction: 'upload' });
          break;
        case 'remote_only':
          tasks.push({ memoryId, direction: 'download' });
          break;
        case 'synced':
          tasks.push({ memoryId, direction: 'skip' });
          break;
        case 'conflict':
          break;
      }
    }

    return tasks;
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(memoryId: string, state: MemorySyncState): Promise<boolean> {
    switch (this.config.conflictResolution) {
      case 'local_wins':
        await this.uploadMemory(memoryId);
        return true;

      case 'remote_wins':
        await this.downloadMemory(memoryId);
        return true;

      case 'newest_wins':
        if (state.localModified > state.remoteModified) {
          await this.uploadMemory(memoryId);
        } else {
          await this.downloadMemory(memoryId);
        }
        return true;

      case 'manual':
        return false;

      default:
        return false;
    }
  }

  /**
   * 上传记忆
   */
  private async uploadMemory(memoryId: string, content?: string): Promise<void> {
    if (!this.config.serverUrl) {
      throw new Error('Server URL not configured');
    }

    if (this.config.enableSecretScan && content) {
      const validation = this.secretScanner.validate(content);
      if (!validation.valid) {
        throw new Error(validation.message);
      }
    }

    const url = `${this.config.serverUrl}/teams/${this.config.teamId}/memories/${memoryId}`;
    const etag = this.etagCache.get(memoryId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (etag) {
      headers['If-Match'] = etag;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const newEtag = response.headers.get('ETag');
    if (newEtag) {
      this.etagCache.set(memoryId, newEtag);
    }
  }

  /**
   * 下载记忆
   */
  private async downloadMemory(memoryId: string, content?: string): Promise<void> {
    if (!this.config.serverUrl) {
      throw new Error('Server URL not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    const response = await fetch(
      `${this.config.serverUrl}/teams/${this.config.teamId}/memories/${memoryId}`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    const newEtag = response.headers.get('ETag') || data.metadata?.etag;
    if (newEtag) {
      this.etagCache.set(memoryId, newEtag);
    }
  }

  /**
   * 更新ETag缓存
   */
  private updateEtagCache(memories: Map<string, ServerMemoryEntry>, _baseEtag: string): void {
    const entries = Array.from(memories.entries());
    for (const [memoryId, entry] of entries) {
      if (entry.metadata.etag) {
        this.etagCache.set(memoryId, entry.metadata.etag);
      }
    }
  }

  /**
   * 获取同步状态
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * 获取上次同步时间
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /**
   * 获取记忆同步状态
   */
  getMemoryStates(): Map<string, MemorySyncState> {
    return new Map(this.memoryStates);
  }

  /**
   * 添加监听器
   */
  addListener(listener: (status: SyncStatus, result?: SyncResult) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: (status: SyncStatus, result?: SyncResult) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(status: SyncStatus, result?: SyncResult): void {
    for (const listener of this.listeners) {
      try {
        listener(status, result);
      } catch (error) {
        logger.error('Error in sync listener:', error);
      }
    }
  }

  /**
   * 设置秘密扫描器
   */
  setSecretScanner(scanner: MemorySecretScanner): void {
    this.secretScanner = scanner;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TeamMemorySyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): TeamMemorySyncConfig {
    return { ...this.config };
  }

  /**
   * 强制完全同步
   */
  async fullSync(): Promise<SyncResult> {
    this.etagCache.clear();
    this.memoryStates.clear();
    return this.sync();
  }
}

/**
 * 导出默认实例
 */
export const defaultTeamMemorySyncService = new TeamMemorySyncService();
