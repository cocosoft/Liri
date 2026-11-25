/**
 * 团队记忆同步服务
 * 负责团队记忆的完整同步流程
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { resolveDataDir } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import {
  MemorySecretScanner,
  defaultMemorySecretScanner,
} from '../scanners/MemorySecretScanner';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { configManager } from '@openliri/infra/config';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';
import {
  TeamMemorySyncStateStore,
} from './TeamMemorySyncStateStore';
import {
  appendTeamSyncHistory,
  pruneTeamConflictCandidate,
  upsertNetworkConflictCandidate,
} from './TeamMemorySharedDirSync';

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
  /** 远端墓碑（`deletedAt`）触发的本地归档数（Phase 2N-3） */
  archived: number;
  /** 本地删除已同步到远端（软删）的条数（Phase 2N-6） */
  deleted: number;
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
  /** 服务端单调版本（Phase 2N-1 增量游标；旧服务端可能缺失） */
  version?: number;
  /** 顶层 etag（契约 §3.2）；旧服务端放在 `metadata.etag` */
  etag?: string;
  /** 墓碑标记（Phase 2N-3 消费；此处只透传） */
  deletedAt?: string | null;
  /** 正文摘要（Phase 2N-2：与本地 hash 比对判"已同步"，不依赖 etag 相等） */
  contentHash?: string;
  metadata: {
    createdAt: string;
    modifiedAt: string;
    etag: string;
    tags?: string[];
    type?: string;
  };
}

/** 内容规范化（与共享目录版同口径：CRLF → LF、去首尾空白） */
function normalizeMemoryContent(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim();
}

/** 正文摘要（与服务端 `contentHash` 同口径） */
function hashMemoryContent(raw: string): string {
  return createHash('sha256')
    .update(normalizeMemoryContent(raw))
    .digest('hex');
}

/**
 * 远端 id 落盘前的路径安全检查（Phase 2N-3）。
 *
 * 远端 id 属**外部输入**：本地路径由 `${id}.md` 直接拼出，若 id 含 `../` / 路径分隔符
 * 可写到团队目录之外（且 `.trash` 归档目录也会被撞名）。只允许字母数字开头、
 * 其后为 `A-Za-z0-9._-`（与 `MemoryStore.validateMemoryId` 同精神）。
 */
function isSafeMemorySyncId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

/**
 * 推送冲突（Phase 2N-2）：服务端 412/409 ⇒ **只记候选、不覆盖任一侧**。
 * 由 `sync()` 捕获后写入 `conflicts.json`（与共享目录版审阅入口同文件）。
 */
export class TeamMemorySyncConflictError extends Error {
  constructor(
    readonly memoryId: string,
    readonly localContent: string,
    readonly localHash: string,
    readonly remoteContent: string | null,
    readonly remoteHash: string | null
  ) {
    super(`CONFLICT: ${memoryId}`);
    this.name = 'TeamMemorySyncConflictError';
  }
}

/** 单页拉取条数（契约 §3.6；命名避开 lint:consts 的 `_LIMIT` 裸字面量判据） */
const TEAM_SYNC_PAGE_SIZE = 100;
/** 分页保护：单次同步最多翻页数（防服务端游标异常导致死循环） */
const MAX_PAGES = 50;
/** 退避上限（契约 §3.7：1×/2×/4×，上限 15 分钟） */
const MAX_RETRY_BACKOFF = 15 * 60 * 1000;

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
  /** 上传时写入的访问级别（Phase 2N-2，契约 §3.2；默认 `team`） */
  accessLevel: string;
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
  accessLevel: 'team',
};

/**
 * 该错误是否值得退避重试（契约 §3.4/§3.7）。
 *
 * 仅 `429` / `5xx` / 网络错误（fetch 抛错、超时）重试；其余 4xx（401/403/428…）
 * 属"重试也不会好"的授权/契约问题 ⇒ 不做自动重试。
 */
export function isRetriableTeamMemorySyncError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.code === 'RATE_LIMITED' || error.code === 'SERVER_ERROR';
  }
  return true;
}

/**
 * 退避间隔（契约 §3.7）：失败第 1 次 = 1×同步间隔，第 2 次 = 2×，第 3 次及以后 = 4×；
 * 上限 15 分钟。
 */
export function computeTeamMemorySyncRetryDelay(
  consecutiveFailures: number,
  intervalMs: number
): number {
  const attempt = Math.min(Math.max(1, Math.floor(consecutiveFailures)), 3);
  const base =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : DEFAULT_CONFIG.syncInterval;
  return Math.min(base * 2 ** (attempt - 1), MAX_RETRY_BACKOFF);
}

/**
 * 团队记忆同步器
 */
export class TeamMemorySyncService {
  private config: TeamMemorySyncConfig;
  private status: SyncStatus = SyncStatus.IDLE;
  private secretScanner: MemorySecretScanner;
  private etagCache: Map<string, string> = new Map();
  /**
   * 本页列表**观测到**的远端 etag（2N-4）。
   * 与 `etagCache`（**成功同步基线**）严格区分：观测值只用于"从未同步过的条目"
   * 首次推送的 `If-Match`，绝不覆盖已有基线（否则冲突检测失效）。
   */
  private observedEtags: Map<string, string> = new Map();
  private memoryStates: Map<string, MemorySyncState> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  /** 退避重试定时器（Phase 2N-4；与周期定时器互不替代） */
  private retryTimer: NodeJS.Timeout | null = null;
  /** 连续失败次数（成功清零；用于 1×/2×/4× 退避） */
  private consecutiveFailures = 0;
  /** 最近一次失败原因（ERROR 状态保留，供诊断/设置页读取） */
  private lastError: string | null = null;
  /** 本轮失败是否属可重试（429/5xx/网络错误） */
  private lastFailureRetriable = false;
  /**
   * Bearer 令牌（Phase 2N-0，2026-11-25）：由 app 侧从 `credentials.json` 注入。
   * **不放进 `TeamMemorySyncConfig`** —— 避免 `getConfig()`/日志意外带出明文。
   */
  private authToken: string | null = null;
  /** 同步状态持久化（Phase 2N-1）：cursor / etag 断点续传 */
  private readonly stateStore: TeamMemorySyncStateStore;
  private listeners: Array<(status: SyncStatus, result?: SyncResult) => void> =
    [];

  constructor(
    config: Partial<TeamMemorySyncConfig> = {},
    stateStore: TeamMemorySyncStateStore = new TeamMemorySyncStateStore()
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.secretScanner = defaultMemorySecretScanner;
    this.stateStore = stateStore;
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
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
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
        archived: 0,
        deleted: 0,
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
        archived: 0,
        deleted: 0,
        conflicts: [],
        errors: ['NOT_CONFIGURED: memory.teamSync.serverUrl 未配置'],
        duration: 0,
      };
    }

    const startTime = Date.now();
    // Phase 2N-4：新一轮开始 ⇒ 取消待执行的退避重试、重置本轮可重试标记
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.lastFailureRetriable = false;
    this.status = SyncStatus.SYNCING;
    this.notifyListeners(SyncStatus.SYNCING);

    const result: SyncResult = {
      success: true,
      uploaded: 0,
      downloaded: 0,
      skipped: 0,
      archived: 0,
      deleted: 0,
      conflicts: [],
      errors: [],
      duration: 0,
    };

    try {
      const [localMemories, remoteMemories] = await Promise.all([
        this.getLocalMemories(),
        this.fetchRemoteMemories(),
      ]);

      // 先重试上轮归档失败的墓碑（标记文件留痕；成功即自愈）
      for (const pendingId of await this.listTombstoneMarkers()) {
        try {
          await this.applyTombstone(pendingId);
        } catch {
          // 仍失败 ⇒ 保留标记，下一轮再试
        }
      }

      // ── Phase 2N-3：墓碑（远端 `deletedAt`）⇒ 本地归档到 `.trash`（**不物理删除**）──
      // 必须先摘掉两侧条目：否则墓碑会被判成 `remote_only`（每轮反复下载）或
      // `local_only`（把已删记忆又推回服务端 = 复活）。归档保留可还原副本。
      for (const memoryId of Array.from(remoteMemories.keys())) {
        const entry = remoteMemories.get(memoryId);
        if (!entry?.deletedAt) continue;

        remoteMemories.delete(memoryId);
        localMemories.delete(memoryId);
        this.etagCache.delete(memoryId);

        if (!isSafeMemorySyncId(memoryId)) {
          result.errors.push(`Unsafe memory id in tombstone: ${memoryId}`);
          continue;
        }
        try {
          if (await this.applyTombstone(memoryId)) {
            result.archived++;
            logger.info('团队记忆墓碑：本地已归档到 .trash', { memoryId });
          }
        } catch (error) {
          // 归档失败 ⇒ 留 `<id>.deleted` 标记：本轮不复活，下一轮自动重试归档
          try {
            await this.markPendingTombstone(memoryId);
          } catch {
            /* 标记也写不了 ⇒ 仅记错误（下方 errors 已抛给调用方） */
          }
          await handleError(error, {
            module: 'memory:services:teamSync',
            action: 'archive_tombstone',
          });
          result.errors.push(`Archive failed for ${memoryId}: ${error}`);
        }
      }

      // ── Phase 2N-6：本地删除同步（软删远端；远端已变 ⇒ 转人工候选）──
      await this.propagateLocalDeletions(localMemories, remoteMemories, result);

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
        const content = localMemories.get(task.memoryId)?.content ?? '';
        try {
          await this.uploadMemory(task.memoryId, content);
          result.uploaded++;
        } catch (error) {
          // Phase 2N-2：412/409 ⇒ 只记冲突候选（不覆盖）；不算"上传失败"
          if (error instanceof TeamMemorySyncConflictError) {
            result.conflicts.push(task.memoryId);
            try {
              // 2026-11-25（2N-5 修复）：候选必须落在**本服务配置的**团队目录
              // （`config.localDir`，与下载/墓碑/审计同源）；原实现写死
              // `resolveTeamMemoryDir()` ⇒ 自定义 localDir 时候选错位，隔离测试还会污染用户目录。
              await upsertNetworkConflictCandidate(this.config.localDir, {
                id: task.memoryId,
                localHash: error.localHash,
                remoteHash: error.remoteHash,
              });
            } catch (candidateError) {
              await handleError(candidateError, {
                module: 'memory:services:teamSync',
                action: 'write_conflict_candidate',
              });
              result.errors.push(
                `Conflict candidate failed for ${task.memoryId}: ${candidateError}`
              );
            }
            continue;
          }
          result.errors.push(`Upload failed for ${task.memoryId}: ${error}`);
          // Phase 2N-4：429/5xx/网络错误 ⇒ 本轮结束后按退避重试
          if (isRetriableTeamMemorySyncError(error)) {
            this.lastFailureRetriable = true;
          }
        }
      }

      const downloadTasks = syncTasks.filter((t) => t.direction === 'download');
      for (const task of downloadTasks) {
        try {
          await this.downloadMemory(task.memoryId, task.content);
          result.downloaded++;
        } catch (error) {
          result.errors.push(`Download failed for ${task.memoryId}: ${error}`);
          if (isRetriableTeamMemorySyncError(error)) {
            this.lastFailureRetriable = true;
          }
        }
      }

      result.skipped = syncTasks.filter((t) => t.direction === 'skip').length;

      result.success = result.errors.length === 0;
      this.status = !result.success
        ? SyncStatus.ERROR
        : result.conflicts.length > 0
          ? SyncStatus.CONFLICT
          : SyncStatus.SUCCESS;
    } catch (error) {
      await handleError(error, { module: 'memory:sync', action: 'full_sync' });
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
      this.status = SyncStatus.ERROR;
      // Phase 2N-4：只有 429/5xx/网络错误才值得退避重试
      this.lastFailureRetriable = isRetriableTeamMemorySyncError(error);
      // Phase 2N-1：失败原因落库（保留既有 cursor/etag，便于下一轮续传）
      try {
        await this.stateStore.saveError(this.config.teamId, String(error));
      } catch (stateError) {
        await handleError(stateError, {
          module: 'memory:services:teamSync',
          action: 'save_sync_error',
        });
      }
    }

    result.duration = Date.now() - startTime;
    this.lastSyncTime = Date.now();

    // ── Phase 2N-4：审计（R08-002）—— 每轮一条结构化日志 + `sync-history.jsonl` 留痕 ──
    logger.info('团队记忆同步完成', {
      teamId: this.config.teamId,
      status: this.status,
      uploaded: result.uploaded,
      downloaded: result.downloaded,
      skipped: result.skipped,
      archived: result.archived,
      conflicts: result.conflicts.length,
      errors: result.errors.length,
      durationMs: result.duration,
    });
    try {
      await appendTeamSyncHistory(this.config.localDir, {
        pulled: result.downloaded,
        pushed: result.uploaded,
        pullConflicts: 0,
        pushConflicts: result.conflicts.length,
        rejectedSecrets: 0,
        errors: result.errors.length,
      });
    } catch (error) {
      await handleError(error, {
        module: 'memory:services:teamSync',
        action: 'append_sync_history',
      });
    }

    // 失败 ⇒ 保留 lastError 并按退避安排重试（成功清零；不可重试错误不自动重试）
    if (result.success) {
      this.consecutiveFailures = 0;
      this.lastError = null;
    } else {
      this.consecutiveFailures += 1;
      this.lastError = result.errors[0] ?? 'unknown sync error';
      this.scheduleRetry();
    }

    // 2N-4：把本轮"成功下载/推送/已同步"得到的基线 etag 一并落库
    // （`fetchRemoteMemories` 里的 saveProgress 早于下载，下载得到的基线需要在这里补存）
    try {
      await this.stateStore.saveEtags(
        this.config.teamId,
        Object.fromEntries(this.etagCache)
      );
    } catch (error) {
      await handleError(error, {
        module: 'memory:services:teamSync',
        action: 'save_etags_after_sync',
      });
    }

    this.notifyListeners(this.status, result);

    return result;
  }

  /**
   * 安排一次退避重试（Phase 2N-4）。
   *
   * 仅当本轮失败属 429/5xx/网络错误；跳过的条件：
   * - 已有待执行的重试（单飞）；
   * - 不可重试（401/403/428/412…）—— 重试也不会好，等下一个周期。
   */
  private scheduleRetry(): void {
    if (this.retryTimer || !this.lastFailureRetriable) return;
    const delay = computeTeamMemorySyncRetryDelay(
      this.consecutiveFailures,
      this.config.syncInterval
    );
    logger.info('团队记忆同步失败，安排退避重试', {
      failures: this.consecutiveFailures,
      delayMs: delay,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.sync().catch((error) => {
        void handleError(error, {
          module: 'memory:sync',
          action: 'retry_sync',
        });
      });
    }, delay);
    this.retryTimer.unref?.();
  }

  /** 最近一次失败原因（无失败 ⇒ null；供诊断/设置页读取） */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * 人工采纳网络冲突（2026-11-25，2N-5 修复）。
   *
   * 背景：网络候选（`source:'network'`）没有本地/远端文件路径，原设置页只能展示提示、
   * 用户无法处理。现由本方法落地两种取舍，**都不自动改写**（仅在用户显式点击后执行）：
   *
   * - `keep_local`：删除该条的 **etag 基线**（内存 + 落库）⇒ 下一次推送用列表观测到的
   *   远端 etag 作 `If-Match`（语义 = "在刚读到的版本上覆盖"）⇒ 本地内容胜出；
   * - `keep_shared`：下载远端正文到本地（`downloadMemory` 同时刷新基线）⇒ 远端胜出。
   *
   * 两者成功后都会把候选从 `conflicts.json` 移除（否则审阅列表一直挂着已处理项）。
   *
   * @returns 是否成功（不安全 id / 本地文件缺失 ⇒ false；下载失败会抛错由调用方映射）
   */
  async resolveNetworkConflict(
    memoryId: string,
    resolution: 'keep_local' | 'keep_shared'
  ): Promise<boolean> {
    if (!isSafeMemorySyncId(memoryId)) return false;

    if (resolution === 'keep_local') {
      const local = await this.readLocalContent(memoryId);
      if (local === null) {
        // 本地已删除的冲突（`direction:'delete'`）：保留本地 = 确认删除远端（软删）。
        // 用"本次列表观测到的 etag"作 If-Match（没有就不带——用户已显式确认删除）。
        const outcome = await this.deleteRemoteMemory(
          memoryId,
          this.observedEtags.get(memoryId) ?? null
        );
        if (outcome === 'conflict') return false;
      }
      this.etagCache.delete(memoryId);
    } else {
      await this.downloadMemory(memoryId);
    }

    // 基线变化（删基线 / 下载刷新）落库，避免重启后回到旧基线
    try {
      await this.stateStore.saveEtags(
        this.config.teamId,
        Object.fromEntries(this.etagCache)
      );
    } catch (error) {
      await handleError(error, {
        module: 'memory:services:teamSync',
        action: 'save_etags_after_resolve',
      });
    }

    await pruneTeamConflictCandidate(this.config.localDir, memoryId);
    logger.info('网络团队记忆冲突已人工采纳', { memoryId, resolution });
    return true;
  }

  /**
   * 获取本地记忆列表（Phase 2N-2：真实读取团队目录 `*.md`）
   *
   * - 文件名为 id（去掉 `.md`）；
   * - `etag` = 正文 sha256（与服务端 `contentHash` 同口径，用于判"已同步"）；
   * - 目录不存在 ⇒ 空表（首次同步，不报错）。
   */
  private async getLocalMemories(): Promise<
    Map<string, { content: string; modified: number; etag: string }>
  > {
    const memories = new Map<
      string,
      { content: string; modified: number; etag: string }
    >();
    const dir = this.config.localDir;

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return memories;
    }

    // Phase 2N-3：墓碑归档失败留痕的 id 不再参与同步（否则会被当成 local_only 推回服务端）
    const pendingTombstones = new Set(await this.listTombstoneMarkers());

    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      const memoryId = name.slice(0, -3);
      if (pendingTombstones.has(memoryId)) continue;
      const filePath = join(dir, name);
      try {
        const [raw, stat] = await Promise.all([
          fs.readFile(filePath, 'utf-8'),
          fs.stat(filePath),
        ]);
        const content = normalizeMemoryContent(raw);
        if (!content) continue;
        memories.set(memoryId, {
          content,
          modified: stat.mtimeMs,
          etag: hashMemoryContent(content),
        });
      } catch (error) {
        await handleError(error, {
          module: 'memory:services:teamSync',
          action: 'read_local_memory',
        });
      }
    }

    return memories;
  }

  /**
   * 获取远程记忆列表（Phase 2N-1：cursor 分页 + 断点续传 + etag 落库）
   *
   * - `incremental=true`：先读持久化 cursor，请求 `version > cursor`，逐页推进直到 `hasMore=false`；
   * - `incremental=false`：单页全量（不带 cursor，与旧行为一致）；
   * - 响应兼容两种形状：契约 `{items,nextCursor,hasMore}` 与旧服务端 `{memories:[...]}`；
   * - 成功后保存 `cursor` 与 `id→etag`；失败**上抛**（fail-closed）。
   */
  private async fetchRemoteMemories(): Promise<Map<string, ServerMemoryEntry>> {
    const memories = new Map<string, ServerMemoryEntry>();

    if (!this.config.serverUrl) {
      return memories;
    }

    const teamId = this.config.teamId;
    let cursor = 0;

    // 断点续传：读上次进度（读失败不阻断，按 0 重新拉；但会记日志）
    if (this.config.incremental) {
      try {
        const state = await this.stateStore.get(teamId);
        if (state) {
          cursor = state.cursor;
          for (const [id, etag] of Object.entries(state.etags)) {
            this.etagCache.set(id, etag);
          }
        }
      } catch (error) {
        await handleError(error, {
          module: 'memory:services:teamSync',
          action: 'load_sync_state',
        });
      }
    }

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const encodedTeam = encodeURIComponent(teamId);
        const url = new URL(
          `${this.config.serverUrl}${this.config.apiPrefix}/${encodedTeam}/memories`
        );
        if (this.config.incremental) {
          url.searchParams.set('cursor', String(cursor));
        }
        url.searchParams.set('limit', String(TEAM_SYNC_PAGE_SIZE));

        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: this.buildHeaders(),
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw this.httpError(response.status, response.statusText);
        }

        const data = (await response.json()) as {
          items?: ServerMemoryEntry[];
          memories?: ServerMemoryEntry[];
          nextCursor?: number;
          next_cursor?: number;
          hasMore?: boolean;
          has_more?: boolean;
        };
        const entries: ServerMemoryEntry[] = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.memories)
            ? data.memories
            : [];

        let maxVersion = cursor;
        for (const entry of entries) {
          if (!entry?.id) continue;
          memories.set(entry.id, entry);
          // 2026-11-25（2N-4）：列表返回的 etag 只记到 `observedEtags`，**不**刷新基线
          // `etagCache` —— 把"当前远端版本"当基线会让随后 PUT 永远 If-Match 命中，
          // 冲突检测失效（静默覆盖他人修改）。基线只来自"成功下载/推送"或"内容已同步"。
          const observed = entry.metadata?.etag ?? entry.etag;
          if (observed) this.observedEtags.set(entry.id, observed);
          const version = Number(entry.version ?? 0);
          if (Number.isFinite(version) && version > maxVersion) {
            maxVersion = version;
          }
        }

        if (!this.config.incremental) break;

        const nextCursor = Number(data.nextCursor ?? data.next_cursor);
        const next = Number.isFinite(nextCursor) ? nextCursor : maxVersion;
        const hasMore =
          data.hasMore ??
          data.has_more ??
          (entries.length >= TEAM_SYNC_PAGE_SIZE && next > cursor);

        if (next <= cursor) break; // 游标无推进 ⇒ 终止（防死循环）
        cursor = next;
        if (!hasMore) break;
      }

      if (this.config.incremental) {
        await this.stateStore.saveProgress(
          teamId,
          cursor,
          Object.fromEntries(this.etagCache)
        );
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
        // Phase 2N-2：优先比 `contentHash`（本地 etag = 正文 sha256）；旧服务端无该字段时退回比 etag
        const sameContent = remote.contentHash
          ? remote.contentHash === local.etag
          : local.etag === remote.metadata.etag;
        if (sameContent) {
          state.status = 'synced';
          // 内容已一致 ⇒ 采用远端 etag 作为下一次推送的 `If-Match` 基线
          // （人工采纳远端后，再改再推才能成功；内容相同 ⇒ 采用基线不会丢数据）
          const remoteEtag = remote.metadata?.etag ?? remote.etag;
          if (remoteEtag) this.etagCache.set(memoryId, remoteEtag);
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
      case 'local_wins': {
        // Phase 2N-2：上传必须带正文（旧实现传 undefined ⇒ body 为空对象）
        const content = await this.readLocalContent(memoryId);
        if (content === null) return false;
        await this.uploadMemory(memoryId, content);
        return true;
      }

      case 'remote_wins':
        await this.downloadMemory(memoryId);
        return true;

      case 'newest_wins':
        if (state.localModified > state.remoteModified) {
          const content = await this.readLocalContent(memoryId);
          if (content === null) return false;
          await this.uploadMemory(memoryId, content);
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

  /** 读取单条本地记忆正文（规范化后；不存在/空 ⇒ null） */
  private async readLocalContent(memoryId: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(
        join(this.config.localDir, `${memoryId}.md`),
        'utf-8'
      );
      const content = normalizeMemoryContent(raw);
      return content ? content : null;
    } catch {
      return null;
    }
  }

  /**
   * 上传记忆
   */
  private async uploadMemory(
    memoryId: string,
    content: string
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
    // 基线优先；从未同步过（无基线）时退回"本次列表观测到"的 etag（首次创建可缺省）
    const etag =
      this.etagCache.get(memoryId) ?? this.observedEtags.get(memoryId);

    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : {}),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        content,
        contentHash: hashMemoryContent(content),
        accessLevel: this.config.accessLevel,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // Phase 2N-2：412/409 ⇒ 记录冲突（不覆盖）；其它错误照旧分类抛出
      const code = classifyTeamMemoryHttpStatus(response.status);
      if (code === 'PRECONDITION_FAILED' || code === 'CONFLICT') {
        const current = await this.readRemoteCurrent(response);
        // 2026-11-25（2N-4）：**故意不**在 412 时刷新 `etagCache` 基线 ——
        // 否则下一个自动周期会把本地直接覆盖远端（违背 manual"不自动覆盖"裁定）。
        // 人工采纳路径：本地内容改成与远端一致 ⇒ 下轮 `compareMemories` 判 `synced` 并
        // 采用远端 etag 作基线 ⇒ 再改再推即可成功。
        throw new TeamMemorySyncConflictError(
          memoryId,
          content,
          hashMemoryContent(content),
          current?.content ?? null,
          current?.contentHash ??
            (current?.content ? hashMemoryContent(current.content) : null)
        );
      }
      throw this.httpError(response.status, response.statusText);
    }

    const newEtag = response.headers.get('ETag');
    if (newEtag) {
      this.etagCache.set(memoryId, newEtag);
      this.observedEtags.set(memoryId, newEtag);
      // Phase 2N-2：etag 落库（重启后仍能作为 `If-Match` 基线）
      try {
        await this.stateStore.saveEtags(
          this.config.teamId,
          Object.fromEntries(this.etagCache)
        );
      } catch (error) {
        await handleError(error, {
          module: 'memory:services:teamSync',
          action: 'save_etags',
        });
      }
    }
  }

  /** 读取 412/409 响应里的远端当前记录（缺失/不可解析 ⇒ null） */
  private async readRemoteCurrent(
    response: Response
  ): Promise<{
    content?: string;
    contentHash?: string;
    etag?: string;
  } | null> {
    try {
      const data = (await response.json()) as {
        current?: { content?: string; contentHash?: string; etag?: string };
      };
      return data?.current ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 下载记忆（Phase 2N-3 补全：**真的落盘**）
   *
   * 修复（2026-11-25 第 5 批）：原实现只取 etag、从不写本地文件 ⇒ `result.downloaded++`
   * 属**假成功**（远端记忆永远到不了本地，墓碑也没有可归档的对象）。
   * 现按契约 §3.2 单条 GET 的 `content` 原子写入 `<localDir>/<id>.md`；
   * 正文缺失 ⇒ 抛错（fail-closed，不记为已下载）。
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
    if (!isSafeMemorySyncId(memoryId)) {
      throw new AppError(
        `Unsafe memory id rejected: ${memoryId}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'UNSAFE_MEMORY_ID'
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    let response: Response;
    try {
      response = await fetch(
        `${this.config.serverUrl}${this.config.apiPrefix}/${this.config.teamId}/memories/${memoryId}`,
        {
          signal: controller.signal,
          headers: this.buildHeaders(),
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw this.httpError(response.status, response.statusText);
    }

    const data = (await response.json()) as {
      content?: unknown;
      etag?: string;
      metadata?: { etag?: string };
    };

    const body =
      typeof data.content === 'string' ? data.content : (content ?? '');
    if (!body.trim()) {
      // 服务端未给正文 ⇒ 不写空文件、不算"已下载"（如实失败，便于排查契约漂移）
      throw new AppError(
        `Download missing content (DOWNLOAD_CONTENT_MISSING): ${memoryId}`,
        ErrorCategory.DATA,
        ErrorSeverity.MEDIUM,
        'DOWNLOAD_CONTENT_MISSING'
      );
    }
    await this.writeLocalMemory(memoryId, body);

    const newEtag = response.headers.get('ETag') || data.etag || data.metadata?.etag;
    if (newEtag) {
      this.etagCache.set(memoryId, newEtag);
      this.observedEtags.set(memoryId, newEtag);
    }
  }

  /** 原子写本地记忆（别名与 `getLocalMemories` 同口径：`<id>.md`，正文规范化） */
  private async writeLocalMemory(
    memoryId: string,
    rawContent: string
  ): Promise<void> {
    const dir = this.config.localDir;
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(
      join(dir, `${memoryId}.md`),
      normalizeMemoryContent(rawContent) + '\n'
    );
  }

  /**
   * 墓碑归档（Phase 2N-3）：把本地 `<id>.md` 移到 `<localDir>/.trash/<id>.<ts>.md`。
   *
   * **不物理删除**（规格 §5.2 回滚路径 = `.trash` 可还原）。本地不存在 ⇒ 返回 false。
   * 归档目录名不以 `.md` 结尾 ⇒ 不会被 `getLocalMemories` 扫回来。
   */
  private async archiveLocalMemory(memoryId: string): Promise<boolean> {
    const source = join(this.config.localDir, `${memoryId}.md`);
    try {
      await fs.access(source);
    } catch {
      return false;
    }

    const trashDir = join(this.config.localDir, '.trash');
    await fs.mkdir(trashDir, { recursive: true });
    const target = join(trashDir, `${memoryId}.${Date.now()}.md`);
    try {
      await fs.rename(source, target);
    } catch {
      // Windows：跨盘/占用（EPERM/EBUSY）⇒ 复制后删除（保留可还原副本）
      await fs.copyFile(source, target);
      await fs.unlink(source);
    }
    return true;
  }

  /** 墓碑失败标记路径：`<localDir>/.trash/<id>.deleted` */
  private tombstoneMarkerPath(memoryId: string): string {
    return join(this.config.localDir, '.trash', `${memoryId}.deleted`);
  }

  /** 读取 `.trash` 下的墓碑标记 id（归档失败留痕；用于跳过上传与下轮重试） */
  private async listTombstoneMarkers(): Promise<string[]> {
    try {
      const names = await fs.readdir(join(this.config.localDir, '.trash'));
      return names
        .filter((name) => name.endsWith('.deleted'))
        .map((name) => name.slice(0, -'.deleted'.length))
        .filter((id) => isSafeMemorySyncId(id));
    } catch {
      return [];
    }
  }

  /** 应用墓碑：归档本地文件并清除标记（本地不存在也算已应用） */
  private async applyTombstone(memoryId: string): Promise<boolean> {
    const archived = await this.archiveLocalMemory(memoryId);
    try {
      await fs.unlink(this.tombstoneMarkerPath(memoryId));
    } catch {
      /* 标记本就不存在 */
    }
    return archived;
  }

  /** 归档失败留痕：下一轮重试，且该 id 在此期间不会再被上传（防"复活"） */
  private async markPendingTombstone(memoryId: string): Promise<void> {
    await fs.mkdir(join(this.config.localDir, '.trash'), { recursive: true });
    await fs.writeFile(
      this.tombstoneMarkerPath(memoryId),
      new Date().toISOString(),
      'utf-8'
    );
  }

  /**
   * 本地删除同步（Phase 2N-6，2026-11-25）。
   *
   * 判据：**基线（`etagCache`）里有、本地文件已不存在** ⇒ 用户删除了这条。
   * 逐条单条 GET 确认远端现状：
   * - 404 ⇒ 远端已删，清基线；
   * - 200 且 etag == 基线 ⇒ `DELETE`（软删，带 `If-Match`）；
   * - 200 但 etag != 基线（远端在此期间被改过）⇒ 只记 `delete` 候选，**不删**（manual 语义）。
   *
   * 关键：命中的 id 先从未处理列表（`remoteMemories`）摘除，避免被 `remote_only`
   * 判成"远端新增"再下载回来（复活）。
   */
  private async propagateLocalDeletions(
    localMemories: Map<
      string,
      { content: string; modified: number; etag: string }
    >,
    remoteMemories: Map<string, ServerMemoryEntry>,
    result: SyncResult
  ): Promise<void> {
    const candidates = Array.from(this.etagCache.keys()).filter(
      (memoryId) => !localMemories.has(memoryId) && isSafeMemorySyncId(memoryId)
    );

    for (const memoryId of candidates) {
      const baseline = this.etagCache.get(memoryId) ?? null;
      remoteMemories.delete(memoryId);
      try {
        const response = await this.fetchRemoteSingle(memoryId);
        if (!response) {
          // 远端已不存在（或早已删除）⇒ 清基线即可
          this.etagCache.delete(memoryId);
          continue;
        }
        const data = (await response.json()) as {
          content?: unknown;
          etag?: string;
          metadata?: { etag?: string };
        };
        const remoteEtag =
          response.headers.get('ETag') ||
          data.etag ||
          data.metadata?.etag ||
          null;

        if (baseline && remoteEtag && remoteEtag !== baseline) {
          await this.recordDeleteConflict(memoryId, data.content, result);
          continue;
        }

        const outcome = await this.deleteRemoteMemory(memoryId, baseline);
        if (outcome === 'conflict') {
          await this.recordDeleteConflict(memoryId, data.content, result);
          continue;
        }
        this.etagCache.delete(memoryId);
        if (outcome === 'deleted') {
          result.deleted += 1;
          logger.info('团队记忆本地删除已同步（软删远端）', { memoryId });
        }
      } catch (error) {
        await handleError(error, {
          module: 'memory:services:teamSync',
          action: 'propagate_local_delete',
        });
        result.errors.push(`Delete sync failed for ${memoryId}: ${error}`);
      }
    }
  }

  /** 单条 GET（404 ⇒ null；其它非 2xx ⇒ 抛结构化错误） */
  private async fetchRemoteSingle(memoryId: string): Promise<Response | null> {
    if (!this.config.serverUrl) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      const response = await fetch(
        `${this.config.serverUrl}${this.config.apiPrefix}/${this.config.teamId}/memories/${memoryId}`,
        { signal: controller.signal, headers: this.buildHeaders() }
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw this.httpError(response.status, response.statusText);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 软删远端（`DELETE`，带 `If-Match` 基线）。
   * 404 视为"已删"；412/409 ⇒ `conflict`（交人工）；其它非 2xx ⇒ 抛错。
   */
  private async deleteRemoteMemory(
    memoryId: string,
    etag: string | null
  ): Promise<'deleted' | 'gone' | 'conflict'> {
    if (!this.config.serverUrl) {
      throw new AppError(
        'Server URL not configured',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (!isSafeMemorySyncId(memoryId)) {
      throw new AppError(
        `Unsafe memory id rejected: ${memoryId}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'UNSAFE_MEMORY_ID'
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);
    let response: Response;
    try {
      response = await fetch(
        `${this.config.serverUrl}${this.config.apiPrefix}/${this.config.teamId}/memories/${memoryId}`,
        {
          method: 'DELETE',
          signal: controller.signal,
          headers: this.buildHeaders(etag ? { 'If-Match': etag } : {}),
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) return 'gone';
    if (!response.ok) {
      const code = classifyTeamMemoryHttpStatus(response.status);
      if (code === 'PRECONDITION_FAILED' || code === 'CONFLICT') {
        return 'conflict';
      }
      throw this.httpError(response.status, response.statusText);
    }
    return 'deleted';
  }

  /** 记录"本地已删但远端已变"的冲突候选（不删除、不下载；`direction=delete`） */
  private async recordDeleteConflict(
    memoryId: string,
    remoteContent: unknown,
    result: SyncResult
  ): Promise<void> {
    const remoteHash =
      typeof remoteContent === 'string'
        ? hashMemoryContent(remoteContent)
        : null;
    result.conflicts.push(memoryId);
    try {
      await upsertNetworkConflictCandidate(this.config.localDir, {
        id: memoryId,
        localHash: null,
        remoteHash,
        direction: 'delete',
      });
    } catch (error) {
      await handleError(error, {
        module: 'memory:services:teamSync',
        action: 'write_delete_conflict',
      });
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
   * 强制完全同步（Phase 2N-8 手动全量重同步）。
   *
   * 必须**同时清持久化进度**（cursor + etag 基线）：`sync()` 会从
   * `team_memory_sync_state` 读回二者 —— 只清内存时游标仍使列表只返回
   * `version>cursor`（拉不到历史条目），基线仍让"本地缺失"被判成本地删除
   * ⇒ 全量重同步会**软删远端**（破坏性），与"恢复入口"的语义相反。
   *
   * 清完后：远端条目全部按 `remote_only` 重新下载（本地误删可恢复）；
   * 推送仍用列表观测到的 etag 作 `If-Match`（见 `uploadMemory` 的基线回退），
   * 不会因为"没有基线"而静默覆盖他人修改。
   *
   * 清状态失败 ⇒ **上抛**（fail-closed）：宁可本轮不同步，也不带着旧基线跑全量。
   */
  async fullSync(): Promise<SyncResult> {
    this.etagCache.clear();
    this.observedEtags.clear();
    this.memoryStates.clear();
    await this.stateStore.reset(this.config.teamId);
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
