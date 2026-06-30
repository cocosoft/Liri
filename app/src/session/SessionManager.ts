import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { SessionStore } from './SessionStore';
import { SessionPruner } from './SessionPruner';
import type { PrunerOptions } from './SessionPruner';
import { SessionLock } from './SessionLock';
import type { LockOptions } from './SessionLock';
import { SessionMigration } from './SessionMigration';
import { FileSystemStorage } from './storage/FileSystemStorage';
import type { SessionStorage } from './SessionStorage';
import type { SessionCompactionBridge } from './compaction/SessionCompactionBridge';
import { PriorityManager } from './qos/PriorityManager';
import { QoSEnforcer } from './qos/QoSEnforcer';
import type {
  SessionPriority,
  SessionPriorityLevel,
  QoSLevel,
} from './qos/SessionPriority';
import { BudgetTracker } from './budget/BudgetTracker';
import { BudgetEnforcer } from './budget/BudgetEnforcer';
import { resolvePyappHome } from '@modules/core';
import type {
  SessionTokenBudgetConfig,
  BudgetDecision,
  BudgetPeriod,
} from './budget/BudgetTypes';
import { SessionArchiver } from './archive/SessionArchiver';
import type {
  ArchiveConfig,
  ArchiveResult,
  RestoreResult,
  ArchiveMetadata,
} from './archive/ArchiveTypes';
import { MessageRole, ContentBlockType } from './types/Message';
import type { UnifiedMessage } from './types/Message';

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
  enableCompactionMonitor?: boolean;
  compactionMonitorIntervalMs?: number;
}

/**
 * @deprecated 请使用 SessionGateway + SessionManagerAdapter 替代。
 * SessionGateway 提供统一会话接口，支持 FTS5 搜索和跨 Agent 聚合。
 * 迁移路径：new SessionManagerAdapter(new SessionGateway())
 */
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
  private compactionMonitorInterval: ReturnType<typeof setInterval> | null =
    null;
  private compactionBridge: SessionCompactionBridge | null = null;
  private initialized = false;
  readonly priorityManager = new PriorityManager();
  readonly qosEnforcer = new QoSEnforcer();
  readonly budgetTracker = new BudgetTracker();
  readonly budgetEnforcer = new BudgetEnforcer(this.budgetTracker);
  private _archiver: SessionArchiver | null = null;

  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      storageRootDir:
        config.storageRootDir ??
        require('path').join(resolvePyappHome(), 'sessions'),
      maxCacheSize: config.maxCacheSize ?? 100,
      enablePruner: config.enablePruner ?? true,
      enableMigration: config.enableMigration ?? true,
      enableLock: config.enableLock ?? true,
      enableCompactionMonitor: config.enableCompactionMonitor ?? false,
      compactionMonitorIntervalMs:
        config.compactionMonitorIntervalMs ?? 30 * 60 * 1000,
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

  /**
   * 设置压缩桥接
   */
  setCompactionBridge(bridge: SessionCompactionBridge): void {
    this.compactionBridge = bridge;
  }

  /**
   * 获取压缩桥接
   */
  getCompactionBridge(): SessionCompactionBridge | null {
    return this.compactionBridge;
  }

  /**
   * 设置会话优先级
   */
  setSessionPriority(
    sessionId: string,
    level: SessionPriorityLevel,
    qos?: QoSLevel
  ): void {
    this.priorityManager.setPriority(sessionId, level, qos);
    this.qosEnforcer.registerSession(
      sessionId,
      this.priorityManager.getPriority(sessionId)
    );
  }

  /**
   * 获取会话优先级
   */
  getSessionPriority(sessionId: string): SessionPriority {
    return this.priorityManager.getPriority(sessionId);
  }

  /**
   * 获取 QoS 执行器
   */
  getQoSEnforcer(): QoSEnforcer {
    return this.qosEnforcer;
  }

  /**
   * 获取优先级管理器
   */
  getPriorityManager(): PriorityManager {
    return this.priorityManager;
  }

  /**
   * 设置会话预算配置
   */
  setSessionBudget(sessionId: string, config: SessionTokenBudgetConfig): void {
    this.budgetEnforcer.setBudgetConfig(sessionId, config);
  }

  /**
   * 记录会话令牌消耗
   */
  recordTokenConsumption(
    sessionId: string,
    tokens: number,
    period?: BudgetPeriod
  ): void {
    this.budgetTracker.recordConsumption(sessionId, tokens, period);
  }

  /**
   * 检查预算状态
   */
  checkBudget(sessionId: string, estimatedTokens?: number): BudgetDecision {
    return this.budgetEnforcer.evaluate(sessionId, estimatedTokens);
  }

  /**
   * 检查能否继续（预算内）
   */
  canProceedWithBudget(sessionId: string, estimatedTokens?: number): boolean {
    return this.budgetEnforcer.canProceed(sessionId, estimatedTokens);
  }

  /**
   * 获取预算追踪器
   */
  getBudgetTracker(): BudgetTracker {
    return this.budgetTracker;
  }

  /**
   * 获取预算执行器
   */
  getBudgetEnforcer(): BudgetEnforcer {
    return this.budgetEnforcer;
  }

  /**
   * 获取归档管理器（延迟初始化）
   */
  getArchiver(config?: Partial<ArchiveConfig>): SessionArchiver {
    if (!this._archiver) {
      this._archiver = new SessionArchiver(config);
    }
    return this._archiver;
  }

  /**
   * 设置归档配置
   */
  setArchiver(archiver: SessionArchiver): void {
    this._archiver = archiver;
  }

  /**
   * 归档会话
   */
  async archiveSession(
    sessionId: string,
    trigger?: import('./archive/ArchiveTypes').ArchiveTrigger
  ): Promise<ArchiveResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionManager.archiveSession', {
      'session.id': sessionId,
    });

    try {
      const archiver = this.getArchiver();
      await archiver.initialize();

      const session = await this.store.loadSession(sessionId);
      if (!session) {
        otel.endSpan(span);
        return {
          sessionId,
          success: false,
          archivedAt: Date.now(),
          error: 'Session not found',
        };
      }

      const result = await archiver.archiveSession(
        {
          id: session.id,
          status: session.state.currentState,
          messageCount: (session.messages ?? []).filter(
            (m) => m.type === 'user' || m.type === 'assistant'
          ).length,
          totalTokens: session.metadata?.tokenUsage?.totalTokens ?? 0,
          createdAt: session.createdAt.getTime(),
          updatedAt: session.updatedAt.getTime(),
          lastActivityAt: session.updatedAt.getTime(),
          toUnifiedSession() {
            return {
              id: session.id,
              type: 'local' as never,
              createdAt: session.createdAt.getTime(),
              updatedAt: session.updatedAt.getTime(),
              lastActivityAt: session.updatedAt.getTime(),
              status: session.state.currentState as never,
              metadata: {},
            };
          },
          toUnifiedMessages(): UnifiedMessage[] {
            return (session.messages ?? []).map((m) => ({
              id: m.id,
              sessionId: session.id,
              type: 'assistant' as never,
              role:
                m.type === 'tool'
                  ? MessageRole.TOOL
                  : m.type === 'user'
                    ? MessageRole.USER
                    : MessageRole.ASSISTANT,
              content: [{ type: ContentBlockType.TEXT, text: m.content }],
              timestamp: m.createdAt.getTime(),
            }));
          },
        },
        trigger
      );

      otel.endSpan(span);
      return result;
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:manager',
        action: 'archiveSession',
        rethrow: false,
      });
      return {
        sessionId,
        success: false,
        archivedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * 获取归档列表
   */
  async listArchivedSessions(): Promise<ArchiveMetadata[]> {
    const archiver = this.getArchiver();
    await archiver.initialize();
    return archiver.listArchived();
  }

  /**
   * 获取归档存储统计
   */
  async getArchiveStats(): Promise<{
    count: number;
    totalSize: number;
    oldestArchive: number;
    newestArchive: number;
  }> {
    const archiver = this.getArchiver();
    await archiver.initialize();
    return archiver.getStorageStats();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('SessionManager initializing');

    if (this.config.enablePruner) {
      this.startPruner();
    }

    if (this.config.enableCompactionMonitor && this.compactionBridge) {
      this.startCompactionMonitor();
    }

    this.initialized = true;
    logger.info('SessionManager initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    logger.info('SessionManager shutting down');

    this.stopPruner();
    this.stopCompactionMonitor();

    if (this.config.enableLock) {
      await this.lock.releaseAll();
    }

    this.store.clearCache();
    this.initialized = false;

    logger.info('SessionManager shut down');
  }

  /**
   * 手动触发所有活跃会话的压缩检查
   */
  async compactNow(): Promise<
    { sessionId: string; success: boolean; error?: string }[]
  > {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionManager.compactNow');

    try {
      if (!this.compactionBridge) {
        logger.warn('CompactionBridge not set, cannot compact');
        otel.endSpan(span);
        return [];
      }

      const sessionIds = await this.store.listSessions();
      const results: { sessionId: string; success: boolean; error?: string }[] =
        [];

      for (const sessionId of sessionIds) {
        try {
          const session = await this.store.loadSession(sessionId);
          if (!session) continue;
          if (session.state.currentState !== 'active') continue;

          const bridgeResult = await this.compactionBridge.beforeCompact(
            session,
            ''
          );
          if (!bridgeResult.proceed) continue;

          const record = await this.compactionBridge.performCompact(
            session,
            '',
            'manual'
          );
          results.push({
            sessionId,
            success: record.success,
            error: record.error,
          });
        } catch (e) {
          results.push({ sessionId, success: false, error: String(e) });
          await handleError(e, {
            module: 'session:manager',
            action: 'compactNow:single',
            rethrow: false,
          });
        }
      }

      otel.endSpan(span);
      return results;
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:manager',
        action: 'compactNow',
        rethrow: false,
      });
      return [];
    }
  }

  async pruneNow(): Promise<import('./SessionPruner').PruneResult> {
    try {
      return await this.pruner.prune();
    } catch (e) {
      await handleError(e, {
        module: 'session:manager',
        action: 'pruneNow',
        rethrow: false,
      });
      throw e;
    }
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

  private startCompactionMonitor(): void {
    this.stopCompactionMonitor();
    this.compactionMonitorInterval = setInterval(() => {
      this.compactNow();
    }, this.config.compactionMonitorIntervalMs);
    this.compactionMonitorInterval.unref();
  }

  private stopCompactionMonitor(): void {
    if (this.compactionMonitorInterval) {
      clearInterval(this.compactionMonitorInterval);
      this.compactionMonitorInterval = null;
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
