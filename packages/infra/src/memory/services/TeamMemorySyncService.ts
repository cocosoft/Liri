/**
 * 团队记忆同步服务
 * 负责团队记忆的完整同步流程
 */

import { join } from 'path';
import { resolveDataDir } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import {
  MemorySecretScanner,
  defaultMemorySecretScanner,
} from '../scanners/MemorySecretScanner';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { configManager } from '@openliri/infra/config';

const logger = getLogger('memory:services:teamMemorySyncService');

/**
 * 同步方向
 */
export type SyncDirection = 'upload' | 'download' | 'bidirectional' | 'skip';

/**
 * 冲突解决策略
 */
export type ConflictResolution =
  | 'local_wins'
  | 'remote_wins'
  | 'manual'
  | 'newest_wins';

/**
 * 同步状态
 */
export enum SyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  SUCCESS = 'success',
  ERROR = 'error',
  CONFLICT = 'conflict',
  /** 未配置 `serverUrl`（Phase 0）：明确"不可同步"，**不得**当作成功 */
  NOT_CONFIGURED = 'not_configured',
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
  status:
    | 'synced'
    | 'local_newer'
    | 'remote_newer'
    | 'local_only'
    | 'remote_only'
    | 'conflict';
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
  /**
   * 服务端路径前缀（Phase 2N-0，2026-11-25）：默认 `/teams`。
   * 若部署需要 `/v1` 等前缀，只改这一处（契约见 `team-memory-sync.md` §3.2）。
   */
  apiPrefix: string;
}

/**
 * HTTP 状态 ⇒ 结构化错误码（Phase 2N-0）。
 * 客户端按码分支（412/409 走冲突候选），**不做字符串匹配**（CS02）。
 */
export type TeamMemoryHttpErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PRECONDITION_REQUIRED'
  | 'PRECONDITION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR';

export function classifyTeamMemoryHttpStatus(
  status: number
): TeamMemoryHttpErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 412:
      return 'PRECONDITION_FAILED';
    case 428:
      return 'PRECONDITION_REQUIRED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR';
  }
}

/**
 * 默认配置
 */

const DEFAULT_CONFIG: TeamMemorySyncConfig = {
  serverUrl: '',
  teamId: 'default',
  localDir: join(resolveDataDir(), 'team-memory'),
  syncInterval: 300000,
  conflictResolution: 'local_wins',
  enableSecretScan: true,
  maxConcurrent: 5,
  timeout: 30000,
  incremental: true,
  apiPrefix: '/teams',
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
  /**
   * Bearer 令牌（Phase 2N-0，2026-11-25）：由 app 侧从 `credentials.json` 注入。
   * **不放进 `TeamMemorySyncConfig`** —— 避免 `getConfig()`/日志意外带出明文。
   */
  private authToken: string | null = null;
  private listeners: Array<(status: SyncStatus, result?: SyncResult) => void> =
    [];

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
    // Phase 0：未配置服务端 ⇒ 不启动定时同步（避免"看起来在同步"的假象）
    if (!this.config.serverUrl) {
      logger.warn(
        'TeamMemorySyncService：serverUrl 未配置，不启动自动同步（NOT_CONFIGURED）'
      );
      return;
    }

    this.syncTimer = setInterval(() => {
      this.sync().catch((error) => {
        void handleError(error, { module: 'memory:sync', action: 'auto_sync' });
      });
    }, this.config.syncInterval);
    // 不阻塞进程退出（周期性团队记忆同步，可放弃）
    this.syncTimer.unref?.();

    logger.info(
      `TeamMemorySyncService started with interval ${this.config.syncInterval}ms`
    );
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

    // Phase 0：未配置服务端 ⇒ 显式 NOT_CONFIGURED，且**不发起网络请求**
    // （`fetchRemoteMemories` 在 serverUrl 为空时会静默返回空表 ⇒ 旧实现会伪造"同步成功"）
    if (!this.config.serverUrl) {
      this.status = SyncStatus.NOT_CONFIGURED;
      this.notifyListeners(this.status);
      logger.warn('团队记忆同步未配置 serverUrl，跳过（NOT_CONFIGURED）');
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        skipped: 0,
        conflicts: [],
        errors: ['NOT_CONFIGURED: memory.teamSync.serverUrl 未配置'],
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

      const uploadTasks = syncTasks.filter((t) => t.direction === 'upload');
      for (const task of uploadTasks) {
        try {
          await this.uploadMemory(task.memoryId, task.content);
          result.uploaded++;
        } catch (error) {
          result.errors.push(`Upload failed for ${task.memoryId}: ${error}`);
        }
      }

      const downloadTasks = syncTasks.filter((t) => t.direction === 'download');
      for (const task of downloadTasks) {
        try {
          await this.downloadMemory(task.memoryId, task.content);
          result.downloaded++;
        } catch (error) {
          result.errors.push(`Download failed for ${task.memoryId}: ${error}`);
        }
      }

      result.skipped = syncTasks.filter((t) => t.direction === 'skip').length;

      result.success = result.errors.length === 0;
      this.status = result.success ? SyncStatus.SUCCESS : SyncStatus.ERROR;
    } catch (error) {
      await handleError(error, { module: 'memory:sync', action: 'full_sync' });
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
  private async getLocalMemories(): Promise<
    Map<string, { content: string; modified: number; etag: string }>
  > {
    const memories = new Map<
      string,
      { content: string; modified: number; etag: string }
    >();
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

      const response = await fetch(
        `${this.config.serverUrl}${this.config.apiPrefix}/${this.config.teamId}/memories`,
        {
          signal: controller.signal,
          headers: this.buildHeaders(),
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        throw this.httpError(response.status, response.statusText);
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
      await handleError(error, {
        module: 'memory:services:teamSync',
        action: 'fetch_remote',
      });
      // Phase 2N-0：**上抛**（fail-closed）—— 旧实现吞错后返回空表，会让 401/网络故障
      // 伪装成"远端为空"，进而把本地全量当成新增上传。
      throw error;
    }

    return memories;
  }

  /**
   * 比较本地和远程记忆
   */
  private compareMemories(
    localMemories: Map<
      string,
      { content: string; modified: number; etag: string }
    >,
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
        remoteModified: remote
          ? new Date(remote.metadata.modifiedAt).getTime()
          : 0,
        status: 'local_only',
      };

      if (remote) {
        if (local.etag === remote.metadata.etag) {
          state.status = 'synced';
        } else if (
          local.modified > new Date(remote.metadata.modifiedAt).getTime()
        ) {
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
  private buildSyncTasks(): Array<{
    memoryId: string;
    direction: SyncDirection;
    content?: string;
  }> {
    const tasks: Array<{
      memoryId: string;
      direction: SyncDirection;
      content?: string;
    }> = [];

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
  private async resolveConflict(
    memoryId: string,
    state: MemorySyncState
  ): Promise<boolean> {
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
  private async uploadMemory(
    memoryId: string,
    content?: string
  ): Promise<void> {
    if (!this.config.serverUrl) {
      throw new AppError(
        'Server URL not configured',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (this.config.enableSecretScan && content) {
      const validation = this.secretScanner.validate(content);
      if (!validation.valid) {
        throw new AppError(
          validation.message ?? 'Secret scan failed',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    const url = `${this.config.serverUrl}${this.config.apiPrefix}/${this.config.teamId}/memories/${memoryId}`;
    const etag = this.etagCache.get(memoryId);

    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : {}),
    });

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
      throw this.httpError(response.status, response.statusText);
    }

    const newEtag = response.headers.get('ETag');
    if (newEtag) {
      this.etagCache.set(memoryId, newEtag);
    }
  }

  /**
   * 下载记忆
   */
  private async downloadMemory(
    memoryId: string,
    content?: string
  ): Promise<void> {
    if (!this.config.serverUrl) {
      throw new AppError(
        'Server URL not configured',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    const response = await fetch(
      `${this.config.serverUrl}${this.config.apiPrefix}/${this.config.teamId}/memories/${memoryId}`,
      {
        signal: controller.signal,
        headers: this.buildHeaders(),
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      throw this.httpError(response.status, response.statusText);
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
  private updateEtagCache(
    memories: Map<string, ServerMemoryEntry>,
    _baseEtag: string
  ): void {
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
  addListener(
    listener: (status: SyncStatus, result?: SyncResult) => void
  ): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(
    listener: (status: SyncStatus, result?: SyncResult) => void
  ): void {
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
        void handleError(error, {
          module: 'memory:sync',
          action: 'notify_listener',
        });
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
   * 设置 Bearer 令牌（Phase 2N-0）；传 `null` 清除。
   * 令牌缺失时仍可发起请求（服务端应回 401），由同步结果如实呈现，不伪造成功。
   */
  setAuthToken(token: string | null): void {
    this.authToken = token && token.trim() ? token.trim() : null;
  }

  /** 统一请求头（含 Bearer；令牌永不进日志） */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/json',
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...(extra ?? {}),
    };
  }

  /** HTTP 非 2xx ⇒ 结构化 AppError（errorCode = 分类码） */
  private httpError(status: number, statusText: string): AppError {
    const code = classifyTeamMemoryHttpStatus(status);
    return new AppError(
      `HTTP ${status} ${code}: ${statusText}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      code
    );
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
/**
 * 是否启用团队记忆同步（Phase 0，2026-11-25）。
 * 默认 `false` —— 未开启时行为零变更（不启动定时器、不发请求）。
 */
export function isTeamMemorySyncEnabled(): boolean {
  return (
    configManager.getValue<boolean>('memory.teamSync.enabled', false) === true
  );
}

/**
 * 从 `config.json#memory.teamSync` 解析同步配置。
 * `serverUrl` 为空 ⇒ 调用方应视为 `NOT_CONFIGURED`（不伪造成功）。
 */
export function resolveTeamMemorySyncConfig(): Partial<TeamMemorySyncConfig> {
  const intervalSec = configManager.getValue<number>(
    'memory.teamSync.intervalSec',
    300
  );
  const teamId = configManager.getValue<string>(
    'memory.teamSync.teamId',
    'default'
  );
  return {
    serverUrl:
      configManager.getValue<string>('memory.teamSync.serverUrl', '') ?? '',
    teamId: typeof teamId === 'string' && teamId.trim() ? teamId.trim() : 'default',
    syncInterval:
      (typeof intervalSec === 'number' && intervalSec > 0 ? intervalSec : 300) *
      1000,
  };
}

export const defaultTeamMemorySyncService = new TeamMemorySyncService();
