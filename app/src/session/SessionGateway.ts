/**
 * 统一会话网关
 * 整合所有Session相关模块，提供统一入口
 */

import { randomUUID } from 'crypto';
import path from 'path';

import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
// E-4（2026-08-23，T-G）：会话删除时清理 PDCA 旁路轨迹文件
import { TrajectoryTrailRecorder } from './trajectory/TrajectoryTrailRecorder';
import { resolveSessionsDir, resolveDataDir } from '@modules/core';
import { asyncContextStorage } from '../context/AsyncContextStorage';
import { resolveContextWindow } from '../context/window/ContextWindowResolver';
import { FileCheckpointStorage } from '../query/FileCheckpointStorage.js';
import type { SessionContext } from '../context/types/Context';
import {
  createTranscriptManager,
  TranscriptManager,
} from './TranscriptManager.js';
import type { TranscriptManagerConfig } from './TranscriptManager.js';
import {
  createRemoteSessionManager,
  RemoteSessionManager,
} from './remote/RemoteSessionManager.js';
import type {
  RemoteSessionConfig,
  RemoteSessionCallbacks,
} from './remote/RemoteSessionManager.js';
import {
  createSessionsWebSocket,
  SessionsWebSocket,
} from './websocket/SessionsWebSocket.js';
import type {
  SessionsWebSocketConfig,
  SessionsWebSocketCallbacks,
} from './websocket/SessionsWebSocket.js';
import { StorageFactory } from './storage/StorageFactory.js';
import { EventLogStorage } from './storage/EventLogStorage.js';
import type { UnifiedSessionStorage } from './storage/UnifiedStorage.js';
import type { StorageConfig } from './storage/UnifiedStorage.js';

// 确保 FILESYSTEM 存储实现被注册（SessionGateway 默认使用）
import './storage/FileSystemUnifiedStorage.js';

import { CrashRecoveryManager } from './recovery/CrashRecoveryManager.js';
import type { CrashRecoveryResult } from './recovery/CrashRecoveryManager.js';

import { SessionType, SessionStatus } from './types/Session.js';
import type { LiriEvent } from '@modules/chat/types/events';
import { StorageType } from './storage/UnifiedStorage.js';
import type {
  UnifiedSession,
  SessionFilter,
  SessionStats,
  CreateSessionParams,
} from './types/Session.js';
import type {
  UnifiedMessage,
  MessageType,
  MessageRole,
  SDKMessage,
  PermissionRequest,
  PermissionResponse,
} from './types/Message.js';
import type { Transcript } from './types/Transcript.js';
import type { FTSDocument, FTSSearchResult } from './FTS5SearchEngine.js';
import { getFTS5SearchEngine } from './FTS5SearchEngine.js';

import { SessionTokenTracker } from './TokenTracker.js';
import type { PruningDecider } from './pruning/PruningDecider.js';
import type { PruningResult } from './pruning/PruningStrategy.js';
import type { SessionCompactionBridge } from './compaction/SessionCompactionBridge.js';
import { createWiredCompactionBridge } from './compaction/ServiceAdapters.js';
import { SessionKeyFactory } from './key/SessionKeyFactory.js';
import type { SessionKeyFactoryConfig } from './key/SessionKeyFactory.js';
import { SessionRouter } from './key/SessionRouter.js';
import type { SessionSource } from './key/SessionSource.js';
import {
  SessionLifecycleEventBus,
  createSessionLifecycleEvent,
  SessionLifecycleEvent,
} from './lifecycle/index.js';
import { SessionStore } from './SessionStore.js';
import type { SessionStoreOptions } from './SessionStore.js';
import { SessionPruner } from './SessionPruner.js';
import type { PrunerOptions, PruneResult } from './SessionPruner.js';
import { SessionLock } from './SessionLock.js';
import type { LockOptions, LockAcquireResult } from './SessionLock.js';
import { PriorityManager } from './qos/PriorityManager.js';
import type {
  SessionPriorityLevel,
  SessionPriority,
  QoSLevel,
} from './qos/SessionPriority.js';
import { QoSEnforcer } from './qos/QoSEnforcer.js';
import { BudgetTracker } from './budget/BudgetTracker.js';
import { BudgetEnforcer } from './budget/BudgetEnforcer.js';
import type {
  SessionTokenBudgetConfig,
  BudgetDecision,
  BudgetPeriod,
} from './budget/BudgetTypes.js';
import { SessionArchiver } from './archive/SessionArchiver.js';
import type { ArchivableSession } from './archive/SessionArchiver.js';
import type {
  ArchiveResult,
  ArchiveTrigger,
  ArchiveMetadata,
} from './archive/ArchiveTypes.js';
import { UnifiedStorageAdapter } from './storage/UnifiedStorageAdapter.js';

const logger = getLogger('session:gateway');

/**
 * 网关配置
 */
export interface SessionGatewayConfig {
  storageConfig?: StorageConfig;
  transcriptConfig?: TranscriptManagerConfig;
  remoteConfig?: {
    wsUrl?: string;
    orgUuid?: string;
  };
  keyFactoryConfig?: SessionKeyFactoryConfig;
  wireServices?: boolean;
}

/**
 * D3（2026-08-24）：检测 events[1..boundary] 内是否存在未闭合 turn
 *
 * 用栈配对（turn/end 与最近的 turn/start 匹配），对齐 deepseek-harness OPEN_TURN 拒绝。
 * @returns 最后一个未闭合的 turn/start；全部闭合返回 null
 */
function findOpenTurn(
  events: LiriEvent[],
  boundary: number
): { seq: number; turn?: unknown } | null {
  const stack: { seq: number; turn?: unknown }[] = [];
  for (const e of events) {
    if (e.seq > boundary) break;
    if (e.type === 'turn/start') {
      const data = e.data as { turn?: unknown } | undefined;
      stack.push({ seq: e.seq, turn: data?.turn });
    } else if (e.type === 'turn/end') {
      stack.pop();
    }
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * 会话网关
 */
export class SessionGateway {
  private storage: UnifiedSessionStorage;
  private transcriptManager: TranscriptManager;
  private remoteSessions: Map<string, RemoteSessionManager> = new Map();
  private webSockets: Map<string, SessionsWebSocket> = new Map();
  private config: SessionGatewayConfig;

  private tokenTracker: SessionTokenTracker | null = null;
  private pruningDecider: PruningDecider | null = null;
  private compactionBridge: SessionCompactionBridge | null = null;
  private keyFactory: SessionKeyFactory | null = null;
  private sessionRouter: SessionRouter | null = null;
  private eventBus: SessionLifecycleEventBus | null = null;
  private crashRecoveryManager: CrashRecoveryManager;
  private initialized = false;
  private static readonly FTS_SAVE_INTERVAL_MS = 60_000;
  private ftsSaveInterval: ReturnType<typeof setInterval> | null = null;

  // Phase A: 从 SessionManager 收敛的组件
  private sessionStore: SessionStore | null = null;
  private pruner: SessionPruner | null = null;
  private prunerInterval: ReturnType<typeof setInterval> | null = null;
  private lock: SessionLock | null = null;
  private priorityManager: PriorityManager | null = null;
  private qosEnforcer: QoSEnforcer | null = null;
  private budgetTracker: BudgetTracker | null = null;
  private budgetEnforcer: BudgetEnforcer | null = null;
  private archiver: SessionArchiver | null = null;

  constructor(config?: SessionGatewayConfig) {
    this.config = config ?? {};

    this.storage = StorageFactory.createStorage(
      this.config.storageConfig ?? {
        type: StorageType.FILESYSTEM,
        basePath: resolveSessionsDir(),
      }
    );

    this.transcriptManager = createTranscriptManager(
      this.storage,
      this.config.transcriptConfig
    );

    this.crashRecoveryManager = new CrashRecoveryManager({
      storage: this.storage,
    });

    if (this.config.keyFactoryConfig) {
      this.keyFactory = new SessionKeyFactory(this.config.keyFactoryConfig);
    }

    if (this.config.wireServices) {
      const tracker = new SessionTokenTracker();
      // P2-2.8 Phase 2: 订阅 COST_RECORDED 实现被动数据同步
      tracker.subscribeToCostEvents();
      this.setTokenTracker(tracker);
      this.setCompactionBridge(createWiredCompactionBridge());
    }
  }

  /**
   * 设置令牌追踪器
   */
  setTokenTracker(tracker: SessionTokenTracker): void {
    this.tokenTracker = tracker;
  }

  /**
   * 设置修剪决策器
   */
  setPruningDecider(decider: PruningDecider): void {
    this.pruningDecider = decider;
  }

  /**
   * 设置压缩桥接
   */
  setCompactionBridge(bridge: SessionCompactionBridge): void {
    this.compactionBridge = bridge;
  }

  /**
   * 设置会话 Key 工厂
   */
  setKeyFactory(factory: SessionKeyFactory): void {
    this.keyFactory = factory;
  }

  /**
   * 设置会话路由器
   */
  setSessionRouter(router: SessionRouter): void {
    this.sessionRouter = router;
  }

  /**
   * 获取会话路由器
   */
  getSessionRouter(): SessionRouter | null {
    return this.sessionRouter;
  }

  /**
   * 设置生命周期事件总线
   */
  setEventBus(bus: SessionLifecycleEventBus): void {
    this.eventBus = bus;
  }

  /**
   * 获取生命周期事件总线
   */
  getEventBus(): SessionLifecycleEventBus | null {
    return this.eventBus;
  }

  /**
   * 一键注入真实服务（TokenTracker + CompactionBridge + CheckpointService + SessionRouter）
   * 适用于 ChatManager / SessionHandler 等使用方，免去手动装配
   */
  wireWithRealServices(): this {
    const tracker = new SessionTokenTracker();
    // P2-2.8 Phase 2: 订阅 COST_RECORDED 实现被动数据同步
    tracker.subscribeToCostEvents();
    this.setTokenTracker(tracker);
    this.setCompactionBridge(createWiredCompactionBridge());
    return this;
  }

  /**
   * 设置会话缓存层
   */
  setSessionStore(store: SessionStore): void {
    this.sessionStore = store;
  }

  /**
   * 获取会话缓存层
   */
  getSessionStore(): SessionStore | null {
    return this.sessionStore;
  }

  /**
   * 设置会话修剪器
   */
  setSessionPruner(pruner: SessionPruner): void {
    this.pruner = pruner;
  }

  /**
   * 设置并发锁
   */
  setSessionLock(lock: SessionLock): void {
    this.lock = lock;
  }

  /**
   * 设置优先级管理器
   */
  setPriorityManager(manager: PriorityManager): void {
    this.priorityManager = manager;
  }

  /**
   * 获取优先级管理器
   */
  getPriorityManager(): PriorityManager | null {
    return this.priorityManager;
  }

  /**
   * 设置 QoS 执行器
   */
  setQoSEnforcer(enforcer: QoSEnforcer): void {
    this.qosEnforcer = enforcer;
  }

  /**
   * 获取 QoS 执行器
   */
  getQoSEnforcer(): QoSEnforcer | null {
    return this.qosEnforcer;
  }

  /**
   * 设置令牌预算追踪器
   */
  setBudgetTracker(tracker: BudgetTracker): void {
    this.budgetTracker = tracker;
  }

  /**
   * 获取令牌预算追踪器
   */
  getBudgetTracker(): BudgetTracker | null {
    return this.budgetTracker;
  }

  /**
   * 设置令牌预算执行器
   */
  setBudgetEnforcer(enforcer: BudgetEnforcer): void {
    this.budgetEnforcer = enforcer;
  }

  /**
   * 获取令牌预算执行器
   */
  getBudgetEnforcer(): BudgetEnforcer | null {
    return this.budgetEnforcer;
  }

  /**
   * 设置会话归档器
   */
  setSessionArchiver(archiver: SessionArchiver): void {
    this.archiver = archiver;
  }

  /**
   * 一键注入所有服务
   * 在 wireWithRealServices 基础上，自动装配缓存、修剪、锁、优先级/QoS、预算、归档等所有组件
   */
  wireWithFullServices(options?: {
    storeOptions?: SessionStoreOptions;
    prunerOptions?: PrunerOptions;
  }): this {
    this.wireWithRealServices();

    const adapter = new UnifiedStorageAdapter(this.storage);
    this.setSessionStore(
      new SessionStore({
        storage: adapter,
        ...options?.storeOptions,
      })
    );

    this.setSessionPruner(
      new SessionPruner(
        adapter,
        options?.prunerOptions,
        // 联动清理被剪枝会话的检查点（按 sessionId 精确匹配，不匹配则无操作）
        (id: string) => new FileCheckpointStorage().deleteSessionCheckpoints(id)
      )
    );
    this.setSessionLock(new SessionLock());
    this.setPriorityManager(new PriorityManager());
    this.setQoSEnforcer(new QoSEnforcer());

    const budgetTracker = new BudgetTracker();
    this.setBudgetTracker(budgetTracker);
    this.setBudgetEnforcer(new BudgetEnforcer(budgetTracker));

    this.setSessionArchiver(new SessionArchiver());

    return this;
  }

  /**
   * 初始化网关
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.storage.initialize();
    await this.transcriptManager.initialize();
    await this.crashRecoveryManager.initialize();

    const crashResult = await this.crashRecoveryManager.recoverAfterCrash();
    if (crashResult.totalChecked > 0) {
      logger.info('会话崩溃恢复完毕', {
        totalChecked: crashResult.totalChecked,
        paused: crashResult.pausedSessions,
        failed: crashResult.failedSessions,
      });
    }

    await this.rebuildFTSIndex();
    this.startFTSIndexPersistence();

    // 迁移：为已有 session 计算 roundCount（幂等）
    await this.migrateRoundCount();

    if (this.eventBus) {
      this.eventBus.on('message:created', (event: SessionLifecycleEvent) => {
        const { messageId, type, role, content, sessionKey } =
          event.metadata ?? {};
        if (messageId && typeof content === 'string') {
          getFTS5SearchEngine().index({
            id: `msg_${messageId}`,
            title: '',
            category: 'message',
            content: content,
            timestamp: event.timestamp,
            metadata: {
              messageId,
              sessionId: event.sessionId,
              sessionKey,
              type,
              role,
            },
          });
        }
      });

      this.eventBus.on('session:deleted', (event: SessionLifecycleEvent) => {
        // BUG-3 修复：消费 deleteSession 携带的 messageIds（删除前已取），
        // 不再删除后重新 getMessages（会得空数组导致 FTS 索引残留）。
        const messageIds: string[] =
          (event.metadata?.messageIds as string[]) ?? [];
        const engine = getFTS5SearchEngine();
        for (const msgId of messageIds) {
          engine.remove(`msg_${msgId}`);
        }
      });

      // 单条/批量消息删除时的 FTS5 索引清理
      this.eventBus.on('messages:deleted', (event: SessionLifecycleEvent) => {
        const messageIds: string[] =
          (event.metadata?.messageIds as string[]) ?? [];
        const engine = getFTS5SearchEngine();
        for (const msgId of messageIds) {
          engine.remove(`msg_${msgId}`);
        }
      });
    }

    // 启动定时修剪（如果有修剪器）
    if (this.pruner) {
      await this.executePrune();
      this.startPruneInterval();
    }

    // 初始化归档器
    if (this.archiver) {
      await this.archiver.initialize();
    }
  }

  /**
   * 创建会话
   */
  async createSession(
    params: CreateSessionParams & {
      userId?: string;
      chatType?: string;
      sessionSource?: SessionSource;
    } = {}
  ): Promise<UnifiedSession> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionGateway.createSession');
    const startedAt = Date.now();
    // 入口日志：记录创建请求的参数摘要（排除大字段），用于排查 id 来源与重复创建
    logger.debug('createSession:入口', {
      id: params.id ?? null,
      type: params.type ?? SessionType.LOCAL,
      title: params.title ?? null,
      userId: params.userId ?? null,
      sessionSource: params.sessionSource ?? null,
      chatType: params.chatType ?? null,
      metadataKeys: params.metadata ? Object.keys(params.metadata) : [],
    });

    try {
      let sessionId = params.id;

      if (!sessionId && this.sessionRouter && params.sessionSource) {
        sessionId = this.sessionRouter.route(params.sessionSource);
        logger.debug('createSession:sessionId 由 sessionRouter 路由生成', {
          sessionId,
          sessionSource: params.sessionSource,
        });
      } else if (!sessionId && this.keyFactory) {
        sessionId = this.keyFactory
          .create({
            userId: params.userId,
            chatType: params.chatType as any,
          })
          .toString();
        logger.debug('createSession:sessionId 由 keyFactory 生成', {
          sessionId,
          userId: params.userId,
          chatType: params.chatType,
        });
      }

      sessionId = sessionId ?? randomUUID();
      if (params.id && params.id === sessionId) {
        logger.debug('createSession:使用调用方指定 id', { sessionId });
      } else if (sessionId && !params.id) {
        logger.debug('createSession:fallback randomUUID 生成', { sessionId });
      }
      const now = Date.now();

      const session: UnifiedSession = {
        id: sessionId,
        type: params.type ?? SessionType.LOCAL,
        title: params.title,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        status: SessionStatus.ACTIVE,
        metadata: {
          ...params.metadata,
          sessionType: params.type ?? SessionType.LOCAL,
        },
      };

      // 落盘前：检查是否重复创建（同 id 已存在）
      const preExists = await this.storage.sessionIdExists(sessionId);
      // R1-3 修复：preExists 时升级 warn——存储层 createSession 对同 id 静默覆盖
      // （sessions.set + persistSession，且清空消息缓存）。若调用方重复提交同一 id
      // 会覆盖既有会话，warn 便于排查（不做行为变更，避免破坏既有幂等语义）。
      if (preExists) {
        logger.warn('createSession:检测到同 id 会话已存在，即将覆盖', {
          sessionId,
        });
      } else {
        logger.debug('createSession:落盘前存在性检查通过', {
          sessionId,
          preExists,
        });
      }
      await this.storage.createSession(session);
      logger.debug('createSession:storage.createSession 完成', {
        sessionId,
        costMs: Date.now() - startedAt,
      });

      this.eventBus?.emit(
        createSessionLifecycleEvent('session:created', session.id, {
          sessionKey: session.id,
          metadata: { userId: params.userId, type: params.type },
        })
      );
      logger.debug('createSession:已 emit session:created 事件', {
        sessionId: session.id,
      });

      logger.info('会话已创建', {
        sessionId: session.id,
        preExists,
        costMs: Date.now() - startedAt,
      });
      otel.endSpan(span);
      return session;
    } catch (e) {
      logger.warn('createSession:失败', {
        params: {
          id: params.id ?? null,
          type: params.type,
          userId: params.userId,
        },
        error: e instanceof Error ? e.message : String(e),
        costMs: Date.now() - startedAt,
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:gateway',
        action: 'createSession',
        rethrow: true,
      });
      throw e;
    }
  }

  /**
   * D3（2026-08-24）：事件级 fork——从任意历史 seq（boundary）fork 出子会话
   *
   * 流程：
   *   1. 读源会话 + 源事件（read 自动触发 D4 崩溃修复，保证复制一致性）
   *   2. 校验 boundary（默认 = tailSeq；须为 [1..tailSeq] 内整数）
   *   3. open turn 校验：seq ≤ boundary 内存在未闭合 turn/start → 拒绝
   *   4. createSession 建子会话（metadata 注入 parentSessionId/seedLength 血缘）
   *   5. copyPrefixTo 复制 [1..boundary] 前缀事件（保留原 seq，子会话继承祖先 seq 空间）
   *
   * 返回结果对象（不抛错，对齐本类既有模式）；HTTP 层据此映射 4xx/201
   */
  async forkSession(
    sourceId: string,
    options: { boundary?: number; childTitle?: string; childId?: string } = {}
  ): Promise<{
    success: boolean;
    session?: UnifiedSession;
    boundary?: number;
    copied?: number;
    error?: string;
  }> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionGateway.forkSession');
    const startedAt = Date.now();
    logger.debug('forkSession:入口', {
      sourceId,
      boundary: options.boundary ?? null,
      childTitle: options.childTitle ?? null,
    });

    try {
      const source = await this.getSession(sourceId);
      if (!source) {
        return {
          success: false,
          error: `source session not found: ${sourceId}`,
        };
      }

      // 事件日志路径与存储层对齐：从 storageConfig.basePath（<root>/sessions/<hash>）
      // 派生 sessionsRoot=<root>/sessions + worktreeHash=<hash>；未配置时走 EventLogStorage 默认路径
      const basePath = this.config.storageConfig?.basePath;
      const sessionsRoot = basePath ? path.dirname(basePath) : undefined;
      const worktreeHash = basePath ? path.basename(basePath) : 'default';
      const sourceLog = new EventLogStorage(
        sourceId,
        worktreeHash,
        sessionsRoot
      );
      const events = await sourceLog.read();
      const tailSeq = await sourceLog.getTailSeq();

      const boundary = options.boundary ?? tailSeq;
      if (!Number.isInteger(boundary) || boundary <= 0 || boundary > tailSeq) {
        return {
          success: false,
          error: `invalid boundary: ${boundary} (tailSeq=${tailSeq})`,
        };
      }

      // open turn 校验：boundary 落在未闭合轮次内 → 拒绝（复制残缺 turn 无意义）
      const openTurn = findOpenTurn(events, boundary);
      if (openTurn) {
        return {
          success: false,
          error: `open turn at seq ${openTurn.seq} blocks fork boundary ${boundary}`,
        };
      }

      // 创建子会话（血缘注入 metadata，复用 createSession 的落盘 + session:created 事件）
      const child = await this.createSession({
        id: options.childId,
        title: options.childTitle,
        metadata: {
          parentSessionId: sourceId,
          seedLength: boundary,
        },
      });

      // 复制前缀事件到子会话（保留原 seq）
      const childLog = new EventLogStorage(
        child.id,
        worktreeHash,
        sessionsRoot
      );
      const copy = await sourceLog.copyPrefixTo(childLog, boundary);
      if (!copy.ok) {
        return {
          success: false,
          session: child,
          boundary,
          copied: copy.copied,
          error: `copy prefix failed: ${copy.reason ?? 'unknown'}`,
        };
      }

      logger.info('会话 fork 完成', {
        sourceId,
        childId: child.id,
        boundary,
        copied: copy.copied,
        costMs: Date.now() - startedAt,
      });
      otel.endSpan(span);
      return {
        success: true,
        session: child,
        boundary,
        copied: copy.copied,
      };
    } catch (e) {
      logger.warn('forkSession:失败', {
        sourceId,
        options,
        error: e instanceof Error ? e.message : String(e),
        costMs: Date.now() - startedAt,
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:gateway',
        action: 'forkSession',
      }).catch(() => {});
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<UnifiedSession | null> {
    return this.storage.getSession(sessionId);
  }

  /**
   * 在异步上下文中注入会话信息后执行回调
   * 深层调用链可通过 getCurrentSessionContext() 获取当前会话
   */
  async runWithSession<T>(
    sessionId: string,
    userId: string,
    fn: () => Promise<T>,
    extra?: { agentName?: string; channelType?: string }
  ): Promise<T> {
    const ctx: SessionContext = {
      type: 'session',
      createdAt: new Date(),
      sessionId,
      userId,
      agentName: extra?.agentName,
      channelType: extra?.channelType,
    };
    return asyncContextStorage.run({ session: ctx }, fn);
  }

  /**
   * 更新会话
   */
  async updateSession(session: UnifiedSession): Promise<void> {
    session.updatedAt = Date.now();
    session.lastActivityAt = Date.now();
    await this.storage.updateSession(session);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const startedAt = Date.now();
    logger.debug('deleteSession:入口，新链存储', { sessionId });

    const messages = await this.storage.getMessages(sessionId);
    // BUG-3 修复：删除前记录 messageIds，供 FTS5 索引清理使用——
    // 原实现监听器在删除后重新 getMessages 得到空数组，导致索引残留（幽灵数据）。
    const messageIds = messages.map((m) => m.id);
    logger.debug('deleteSession:已读取消息（删除前）', {
      sessionId,
      messageCount: messages.length,
      messageIds,
    });

    await this.storage.deleteSession(sessionId);
    logger.debug('deleteSession:storage.deleteSession 完成', {
      sessionId,
      costMs: Date.now() - startedAt,
    });

    // E-4（2026-08-23，T-G）：清理 PDCA 旁路轨迹文件（会话外诊断数据，随会话删除）
    void TrajectoryTrailRecorder.cleanup(sessionId);

    await this.transcriptManager.deleteTranscript(sessionId);
    logger.debug('deleteSession:transcript 已删除', {
      sessionId,
    });

    // BUG-3 修复：事件名统一为复数 messages:deleted（原单数 message:deleted 孤发无人消费），
    // 携带 messageIds 供 :456 监听器清理 FTS5 索引。
    this.eventBus?.emit(
      createSessionLifecycleEvent('messages:deleted', sessionId, {
        sessionKey: sessionId,
        metadata: { messageIds, messageCount: messages.length },
      })
    );
    logger.debug('deleteSession:已 emit messages:deleted 事件', {
      sessionId,
      messageCount: messages.length,
    });

    this.eventBus?.emit(
      createSessionLifecycleEvent('session:deleted', sessionId, {
        sessionKey: sessionId,
        metadata: { messageIds, messageCount: messages.length },
      })
    );
    logger.debug('deleteSession:已 emit session:deleted 事件', {
      sessionId,
      messageCount: messages.length,
    });

    const remoteSession = this.remoteSessions.get(sessionId);
    if (remoteSession) {
      remoteSession.disconnect();
      this.remoteSessions.delete(sessionId);
      logger.info('deleteSession:已断开远程会话连接', { sessionId });
    }

    const ws = this.webSockets.get(sessionId);
    if (ws) {
      ws.close();
      this.webSockets.delete(sessionId);
      logger.info('deleteSession:已关闭 WebSocket 订阅', { sessionId });
    }

    logger.info('deleteSession:完成', {
      sessionId,
      messageCount: messages.length,
      costMs: Date.now() - startedAt,
    });
  }

  /**
   * 列出会话（全量加载）
   */
  async listSessions(filter?: SessionFilter): Promise<UnifiedSession[]> {
    return this.storage.listSessions(filter);
  }

  /**
   * 轻量列出会话元数据 — 只扫描文件头 64KB，不加载完整 JSON
   * 比 listSessions 快 5-10x，适合侧边栏列表渲染
   */
  async listLiteSessions(): Promise<
    Array<{ id: string; title?: string; status?: string; updatedAt?: string }>
  > {
    const { readdirSync, statSync } = require('fs');
    const { join } = require('path');
    const { readLiteSessionMeta } =
      await import('./storage/LiteSessionReader.js');
    const sessionsDir = resolveSessionsDir();
    logger.debug('listLiteSessions:开始扫描会话目录', { sessionsDir });

    let entries: string[];
    try {
      entries = readdirSync(sessionsDir);
    } catch (err) {
      logger.warn('listLiteSessions:会话目录读取失败，返回空列表', {
        sessionsDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
    logger.debug('listLiteSessions:目录条目总数', {
      sessionsDir,
      entryCount: entries.length,
    });

    let skippedHidden = 0;
    let statFailed = 0;
    let dirCount = 0;
    let fileCount = 0;
    let metaNull = 0;

    // R1-4 修复：用 Map 按 id 去重（目录布局为当前布局，优先；旧布局文件兜底），
    // 避免迁移中间态（{id}/session.json 与 {id}.json 并存）产出重复 id。
    const resultMap = new Map<
      string,
      { title?: string; status?: string; updatedAt?: string }
    >();

    for (const entry of entries) {
      if (entry.startsWith('.')) {
        skippedHidden++;
        continue; // 跳过隐藏文件/迁移标记
      }
      const fullPath = join(sessionsDir, entry);
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch (err) {
        statFailed++;
        logger.debug('listLiteSessions:条目 stat 失败，跳过', {
          entry,
          fullPath,
          error: err instanceof Error ? err.message : String(err),
        });
        continue; // 条目已消失（并发删除），跳过
      }

      if (isDir) {
        // 当前存储布局：每会话一个子目录 {sessionId}/session.json
        dirCount++;
        const sessionId = entry;
        const meta = readLiteSessionMeta(join(fullPath, 'session.json'));
        if (meta) {
          logger.debug('listLiteSessions:子目录命中会话元数据', {
            sessionId,
            fullPath,
            meta,
          });
          resultMap.set(sessionId, meta);
        } else {
          metaNull++;
          logger.debug('listLiteSessions:子目录未解析出元数据，跳过', {
            sessionId,
            fullPath,
          });
        }
      } else {
        // 兼容旧布局：直接 JSON 文件 {sessionId}.json
        fileCount++;
        const sessionId = entry.replace(/\.json$/i, '');
        const meta = readLiteSessionMeta(fullPath);
        if (meta) {
          logger.debug('listLiteSessions:直接文件命中会话元数据', {
            sessionId,
            fullPath,
            meta,
          });
          // 目录布局已命中时保留目录版本，旧文件仅作兜底
          if (!resultMap.has(sessionId)) {
            resultMap.set(sessionId, meta);
          }
        } else {
          metaNull++;
          logger.debug('listLiteSessions:直接文件未解析出元数据，跳过', {
            sessionId,
            fullPath,
          });
        }
      }
    }

    const results = [...resultMap.entries()].map(([id, meta]) => ({
      id,
      ...meta,
    }));

    logger.info('listLiteSessions:扫描完成', {
      sessionsDir,
      entryCount: entries.length,
      resultCount: results.length,
      skippedHidden,
      statFailed,
      dirCount,
      fileCount,
      metaNull,
    });
    return results;
  }

  /**
   * 搜索会话
   */
  async searchSessions(query: string): Promise<UnifiedSession[]> {
    return this.storage.searchSessions(query);
  }

  /**
   * 发送消息
   */
  async sendMessage(sessionId: string, message: UnifiedMessage): Promise<void> {
    await this.storage.addMessage(sessionId, message);
    await this.transcriptManager.recordMessage(sessionId, message);

    this.eventBus?.emit(
      createSessionLifecycleEvent('message:created', sessionId, {
        sessionKey: sessionId,
        metadata: {
          messageId: message.id,
          type: message.type,
          role: message.role,
          content: message.content,
        },
      })
    );

    const session = await this.getSession(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      await this.updateSession(session);
    }
  }

  /**
   * 将消息索引到 FTS5 全文搜索引擎
   */
  private indexMessageToFTS(sessionId: string, message: UnifiedMessage): void {
    try {
      const content =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);
      const doc: FTSDocument = {
        id: `msg_${message.id}`,
        title: `会话 ${sessionId} 的消息`,
        content,
        category: 'message',
        timestamp: message.timestamp ?? Date.now(),
        metadata: {
          sessionId,
          messageId: message.id,
          type: message.type,
          role: message.role,
        },
      };
      getFTS5SearchEngine().index(doc);
    } catch (err) {
      // KB-FTS-INDEX-LOG（2026-08-29）：单条消息索引失败静默 → 搜索漏索引无日志
      logger.warn('FTS 索引写入失败', {
        sessionId,
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 恢复会话状态（PAUSED → ACTIVE）。
   * 中断治理（2026-08-15）：接通 CrashRecoveryManager.resumeSession 的恢复出口，
   * 供前端 resume / 会话重新激活时调用，paused 会话不再永久冻结。
   */
  async resumeSession(sessionId: string): Promise<UnifiedSession | null> {
    return this.crashRecoveryManager.resumeSession(sessionId);
  }

  /**
   * 在启动时重建 FTS5 索引（从持久化文件加载，或从存储全量重建）
   */
  private async rebuildFTSIndex(): Promise<void> {
    const engine = getFTS5SearchEngine();

    engine.loadFromDisk();

    if (engine.getStats().documentCount === 0) {
      const sessions = await this.storage.listSessions();
      let indexedCount = 0;

      for (const session of sessions) {
        const messages = await this.storage.getMessages(session.id);
        for (const msg of messages) {
          this.indexMessageToFTS(session.id, msg);
          indexedCount++;
        }
      }

      if (indexedCount > 0) {
        logger.info('FTS5 索引已从存储重建', { indexedCount });
      }
    }
  }

  /**
   * 迁移：为已有 session 计算 roundCount（幂等）
   * 仅当 metadata.roundCount 不存在时计算
   */
  private async migrateRoundCount(): Promise<void> {
    try {
      const sessions = await this.storage.listSessions();
      let migratedCount = 0;

      for (const s of sessions) {
        const metadata = s.metadata as Record<string, unknown> | undefined;
        if (metadata && metadata.roundCount == null) {
          const messages = await this.storage.getMessages(s.id);
          const userMsgCount = messages.filter((m) => m.role === 'user').length;
          metadata.roundCount = userMsgCount;
          // #15 修复：改用接口的 updateSession（原 (this.storage as any).saveSession?.()
          // 对 UnifiedSessionStorage 为 undefined，可选调用静默 no-op，迁移从未落盘）
          await this.storage.updateSession(s);
          migratedCount++;
        }
      }

      if (migratedCount > 0) {
        logger.info('roundCount 迁移完成', { migratedCount });
      }
    } catch (err) {
      logger.warn('roundCount 迁移失败（非致命）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 获取 FTS5 索引持久化路径
   */
  private getFTSIndexPath(): string {
    return path.join(resolveDataDir(), 'fts-index.json');
  }

  /**
   * 启动 FTS5 索引定期磁盘持久化
   */
  private startFTSIndexPersistence(): void {
    const savePath = this.getFTSIndexPath();

    this.ftsSaveInterval = setInterval(() => {
      try {
        getFTS5SearchEngine().saveToDisk(savePath);
      } catch (err) {
        // KB-FTS-SAVE-LOG（2026-08-29）：定时持久化失败静默 → 索引丢失无任何痕迹
        logger.warn('FTS 索引定期持久化失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, SessionGateway.FTS_SAVE_INTERVAL_MS);
    // P1-14 修复：unref 避免进程被 FTS 定时器钉住（close() 仍会 clear）
    this.ftsSaveInterval.unref();
  }

  /**
   * 获取消息
   */
  async getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<UnifiedMessage[]> {
    return this.storage.getMessages(sessionId, options);
  }

  /**
   * 更新消息（按 ID 替换，不追加）
   */
  async updateMessage(
    sessionId: string,
    messageId: string,
    message: UnifiedMessage
  ): Promise<void> {
    await this.storage.updateMessage(sessionId, messageId, message);
  }

  /**
   * 软删除单条消息 + 发布事件
   */
  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.storage.deleteMessage(sessionId, messageId);
    this.eventBus?.emit(
      createSessionLifecycleEvent('messages:deleted', sessionId, {
        metadata: { messageIds: [messageId] },
      })
    );
  }

  /**
   * 批量软删除消息 + 发布事件
   */
  async deleteMessages(sessionId: string, messageIds: string[]): Promise<void> {
    await this.storage.deleteMessages(sessionId, messageIds);
    if (messageIds.length > 0) {
      this.eventBus?.emit(
        createSessionLifecycleEvent('messages:deleted', sessionId, {
          metadata: { messageIds },
        })
      );
    }
  }

  /**
   * 加载Transcript
   */
  async loadTranscript(sessionId: string): Promise<Transcript | null> {
    return this.transcriptManager.loadTranscript(sessionId);
  }

  /**
   * 创建WebSocket连接
   */
  createWebSocket(
    sessionId: string,
    config: {
      url: string;
      getAccessToken: () => string;
      orgUuid?: string;
    },
    callbacks: SessionsWebSocketCallbacks
  ): SessionsWebSocket {
    const existingWs = this.webSockets.get(sessionId);
    if (existingWs) {
      existingWs.close();
    }

    const wsConfig: SessionsWebSocketConfig = {
      url: config.url,
      sessionId,
      orgUuid: config.orgUuid,
      getAccessToken: config.getAccessToken,
    };

    const ws = createSessionsWebSocket(wsConfig, callbacks);
    this.webSockets.set(sessionId, ws);
    return ws;
  }

  /**
   * 创建远程会话
   */
  createRemoteSession(
    config: RemoteSessionConfig,
    callbacks: RemoteSessionCallbacks
  ): RemoteSessionManager {
    const existingRemote = this.remoteSessions.get(config.sessionId);
    if (existingRemote) {
      existingRemote.disconnect();
    }

    const remoteSession = createRemoteSessionManager(config, callbacks);
    this.remoteSessions.set(config.sessionId, remoteSession);
    return remoteSession;
  }

  /**
   * 获取会话统计
   */
  async getSessionStats(sessionId?: string): Promise<SessionStats> {
    if (sessionId) {
      return this.storage.getSessionStats(sessionId);
    }

    const sessions = await this.listSessions();
    const stats: SessionStats = {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === SessionStatus.ACTIVE)
        .length,
      archivedSessions: sessions.filter(
        (s) => s.status === SessionStatus.ARCHIVED
      ).length,
      averageSessionDuration: 0,
      totalMessages: 0,
    };

    let totalDuration = 0;
    for (const session of sessions) {
      const sessionStats = await this.storage.getSessionStats(session.id);
      totalDuration += sessionStats.averageSessionDuration;
      stats.totalMessages += sessionStats.totalMessages;
    }

    if (sessions.length > 0) {
      stats.averageSessionDuration = totalDuration / sessions.length;
    }

    return stats;
  }

  /**
   * 获取Transcript统计
   */
  async getTranscriptStats(sessionId: string) {
    return this.transcriptManager.getTranscriptStats(sessionId);
  }

  /**
   * 搜索Transcript
   */
  async searchTranscript(sessionId: string, query: string) {
    return this.transcriptManager.searchTranscript(sessionId, query);
  }

  /**
   * 全文搜索消息（基于 FTS5SearchEngine）
   * @param query 搜索关键词
   * @param sessionId 按会话过滤（可选）
   * @param limit 最大结果数
   * @returns 搜索结果列表
   */
  searchMessagesFTS(
    query: string,
    sessionId?: string,
    limit?: number
  ): FTSSearchResult[] {
    const engine = getFTS5SearchEngine();
    return engine.search(
      query,
      'message',
      limit,
      sessionId ? (doc) => doc.metadata?.sessionId === sessionId : undefined
    );
  }

  /**
   * 记录令牌用量
   */
  recordTokenUsage(
    sessionId: string,
    input: {
      promptTokens?: number;
      completionTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      totalTokens?: number;
    }
  ): void {
    if (!this.tokenTracker) return;
    this.tokenTracker.recordUsage(sessionId, {
      inputTokens: input.promptTokens ?? 0,
      outputTokens: input.completionTokens ?? 0,
      cacheReadInputTokens: input.cacheReadTokens,
      cacheCreationInputTokens: input.cacheCreationTokens,
    });
  }

  /**
   * 获取令牌用量
   */
  getTokenUsage(sessionId: string) {
    return this.tokenTracker?.getUsage(sessionId) ?? null;
  }

  /**
   * 检查是否需要修剪上下文
   * @returns 修剪结果，若无修剪决策器则返回 null
   */
  async checkPruning(sessionId: string): Promise<PruningResult | null> {
    if (!this.pruningDecider) return null;

    const session = await this.getSession(sessionId);
    if (!session) return null;

    const messages = await this.getMessages(sessionId);
    const tokenUsage = this.tokenTracker?.getUsage(sessionId);
    // P1-fix（H2）：totalTokens 已是累计值（TokenTracker.accumulateTokenUsage
    // 累加 input/output/cache 等），再叠加 inputTokens + outputTokens 导致
    // 约 3 倍重复计数，触发过早修剪。
    const totalTokens = tokenUsage?.totalTokens ?? 0;

    const decision = this.pruningDecider.decide({
      session: {
        id: sessionId,
        messages:
          messages as never as import('../session/models/SessionMessage').SessionMessage[],
        metadata:
          session.metadata as never as import('../session/models/SessionMetadata').SessionMetadata,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      } as import('../session/models/Session').Session,
      tokenUsage: totalTokens,
      // L3-fix: 从模型注册表解析上下文窗口（model_registry 事实来源），
      // 原 200000 硬编码违反 model-usage 规则（模型属性必须读 DB）。
      modelContextWindow: resolveContextWindow(
        (session.metadata as { model?: string } | undefined)?.model ?? ''
      ).tokens,
    });

    if (decision.action === 'skip') return null;

    return {
      prunedMessageCount: decision.results.reduce(
        (s, r) => s + r.prunedMessageCount,
        0
      ),
      prunedTokenEstimate: decision.results.reduce(
        (s, r) => s + r.prunedTokenEstimate,
        0
      ),
      messagesRemaining: decision.results.reduce(
        (s, r) => s + r.messagesRemaining,
        0
      ),
      reason: decision.reason,
    };
  }

  /**
   * 执行会话压缩
   */
  async compactSession(
    sessionId: string,
    model?: string
  ): Promise<{
    success: boolean;
    record?: import('../session/compaction/CompactionRecord').CompactionRecord;
    error?: string;
  } | null> {
    if (!this.compactionBridge) return null;

    logger.debug('compactSession:SessionGateway 入口，compactionBridge 链', {
      sessionId,
    });

    const session = await this.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const messages = await this.getMessages(sessionId);
    const sessionLike = {
      id: sessionId,
      messages:
        messages as never as import('../session/models/SessionMessage').SessionMessage[],
      metadata:
        session.metadata as never as import('../session/models/SessionMetadata').SessionMetadata,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
    } as import('../session/models/Session').Session;

    const preResult = await this.compactionBridge.beforeCompact(
      sessionLike,
      model ?? ''
    );

    if (!preResult.proceed) {
      return { success: false, error: preResult.reason };
    }

    const record = await this.compactionBridge.performCompact(
      sessionLike,
      model ?? '',
      'manual'
    );

    return { success: record.success, record, error: record.error };
  }

  /**
   * 获取压缩历史
   */
  getCompactionHistory(sessionId: string) {
    return this.compactionBridge?.getCompactionHistory(sessionId) ?? [];
  }

  // ========== 缓存层 ==========

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    sessions: number;
    metadata: number;
    messages: number;
  } | null {
    return this.sessionStore?.getCacheStats() ?? null;
  }

  // ========== 修剪逻辑 ==========

  /**
   * 内部：执行一次修剪
   */
  private async executePrune(): Promise<PruneResult | null> {
    if (!this.pruner) return null;
    return this.pruner.prune();
  }

  /**
   * 内部：启动定时修剪
   */
  private startPruneInterval(intervalMs: number = 300_000): void {
    this.stopPruneInterval();
    this.prunerInterval = setInterval(async () => {
      try {
        await this.executePrune();
      } catch (err) {
        await handleError(err, {
          module: 'sessions:gateway',
          action: '定时修剪执行失败',
        });
      }
    }, intervalMs);
    this.prunerInterval.unref();
  }

  /**
   * 内部：停止定时修剪
   */
  private stopPruneInterval(): void {
    if (this.prunerInterval) {
      clearInterval(this.prunerInterval);
      this.prunerInterval = null;
    }
  }

  /**
   * 立即执行修剪
   */
  async pruneNow(): Promise<PruneResult | null> {
    return this.executePrune();
  }

  /**
   * 获取修剪预估
   */
  async getPruneEstimate(): Promise<{
    total: number;
    ageCandidates: number;
    countCandidates: number;
    activeSessions: number;
  } | null> {
    if (!this.pruner) return null;
    return this.pruner.getPruneEstimate();
  }

  /**
   * 设置修剪选项
   */
  setPrunerOptions(options: Partial<PrunerOptions>): void {
    this.pruner?.updateOptions(options);
  }

  // ========== 并发锁 ==========

  /**
   * 获取会话锁
   */
  getSessionLock(): SessionLock | null {
    return this.lock;
  }

  /**
   * 获取锁
   */
  async acquireLock(
    sessionId: string,
    options?: LockOptions
  ): Promise<LockAcquireResult> {
    if (!this.lock) {
      this.lock = new SessionLock(options);
    }
    return this.lock.acquire(sessionId, options?.timeout);
  }

  /**
   * 释放锁
   */
  async releaseLock(sessionId: string): Promise<boolean> {
    if (!this.lock) return false;
    return this.lock.release(sessionId);
  }

  /**
   * 检查会话是否被锁定
   */
  async isLocked(sessionId: string): Promise<boolean> {
    if (!this.lock) return false;
    return this.lock.isLocked(sessionId);
  }

  // ========== 优先级 / QoS ==========

  /**
   * 设置会话优先级
   */
  setSessionPriority(
    sessionId: string,
    level: SessionPriorityLevel,
    qos?: QoSLevel
  ): void {
    if (!this.priorityManager) {
      this.priorityManager = new PriorityManager();
    }
    this.priorityManager.setPriority(sessionId, level, qos);

    if (this.qosEnforcer) {
      const priority = this.priorityManager.getPriority(sessionId);
      this.qosEnforcer.registerSession(sessionId, priority);
      this.qosEnforcer.updatePriority(sessionId, priority);
    }
  }

  /**
   * 获取会话优先级
   */
  getSessionPriority(sessionId: string): SessionPriority {
    if (!this.priorityManager) {
      this.priorityManager = new PriorityManager();
    }
    return this.priorityManager.getPriority(sessionId);
  }

  // ========== 令牌预算 ==========

  /**
   * 设置会话预算
   */
  setSessionBudget(sessionId: string, config: SessionTokenBudgetConfig): void {
    if (!this.budgetEnforcer) {
      const tracker = new BudgetTracker();
      this.budgetTracker = tracker;
      this.budgetEnforcer = new BudgetEnforcer(tracker);
    }
    this.budgetEnforcer.setBudgetConfig(sessionId, config);
  }

  /**
   * 记录词元消耗
   */
  recordTokenConsumption(
    sessionId: string,
    tokens: number,
    period: BudgetPeriod = 'per_session'
  ): void {
    this.budgetTracker?.recordConsumption(sessionId, tokens, period);
  }

  /**
   * 检查预算
   */
  checkBudget(sessionId: string, estimatedTokens?: number): BudgetDecision {
    if (!this.budgetEnforcer) {
      return {
        action: 'allow' as const,
        reason: 'No budget configured',
        currentUsage: 0,
        limit: 0,
        percentage: 0,
      };
    }
    return this.budgetEnforcer.evaluate(sessionId, estimatedTokens);
  }

  /**
   * 检查是否可在预算内继续
   */
  canProceedWithBudget(sessionId: string, estimatedTokens?: number): boolean {
    if (!this.budgetEnforcer) return true;
    return this.budgetEnforcer.canProceed(sessionId, estimatedTokens);
  }

  // ========== 归档 ==========

  /**
   * 归档会话
   */
  async archiveSession(
    sessionId: string,
    trigger: ArchiveTrigger = 'manual'
  ): Promise<ArchiveResult | null> {
    if (!this.archiver) return null;

    const session = await this.getSession(sessionId);
    if (!session) {
      return {
        sessionId,
        success: false,
        archivedAt: Date.now(),
        error: 'Session not found',
      };
    }

    const messages = await this.getMessages(sessionId);

    const archivable: ArchivableSession = {
      id: sessionId,
      status: session.status,
      messageCount: messages.length,
      totalTokens: this.tokenTracker?.getUsage(sessionId)?.totalTokens ?? 0,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastActivityAt: session.lastActivityAt,
      toUnifiedSession: () => session,
      toUnifiedMessages: () => messages,
    };

    return this.archiver.archiveSession(archivable, trigger);
  }

  /**
   * 列出已归档的会话
   */
  async listArchivedSessions(): Promise<ArchiveMetadata[]> {
    if (!this.archiver) return [];
    return this.archiver.listArchived();
  }

  /**
   * 获取归档统计
   */
  async getArchiveStats(): Promise<{
    count: number;
    totalSize: number;
    oldestArchive: number;
    newestArchive: number;
  } | null> {
    if (!this.archiver) return null;
    return this.archiver.getStorageStats();
  }

  /**
   * 清理旧会话
   */
  async cleanupOldSessions(maxAge: number): Promise<void> {
    await this.transcriptManager.cleanupOldTranscripts(maxAge);
  }

  /**
   * 关闭网关
   */
  async close(): Promise<void> {
    this.initialized = false;

    if (this.ftsSaveInterval) {
      clearInterval(this.ftsSaveInterval);
      this.ftsSaveInterval = null;
    }

    // 停止定时修剪
    this.stopPruneInterval();

    // 停止自动归档
    this.archiver?.stopAutoArchive();

    // 释放所有锁
    await this.lock?.releaseAll();

    try {
      getFTS5SearchEngine().saveToDisk(this.getFTSIndexPath());
    } catch (err) {
      // KB-FTS-CLOSE-LOG（2026-08-29）：关闭时 FTS 索引持久化失败静默 → 索引损坏无从排查
      logger.warn('FTS 索引关闭持久化失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const remoteSession of this.remoteSessions.values()) {
      remoteSession.disconnect();
    }
    this.remoteSessions.clear();

    for (const ws of this.webSockets.values()) {
      ws.close();
    }
    this.webSockets.clear();

    await this.transcriptManager.close();
  }

  /**
   * 获取存储实例
   */
  getStorage(): UnifiedSessionStorage {
    return this.storage;
  }

  /**
   * 获取Transcript管理器
   */
  getTranscriptManager(): TranscriptManager {
    return this.transcriptManager;
  }

  /**
   * 获取远程会话管理器
   */
  getRemoteSession(sessionId: string): RemoteSessionManager | undefined {
    return this.remoteSessions.get(sessionId);
  }

  /**
   * 获取WebSocket
   */
  getWebSocket(sessionId: string): SessionsWebSocket | undefined {
    return this.webSockets.get(sessionId);
  }
}

/**
 * 创建会话网关
 */
export function createSessionGateway(
  config?: SessionGatewayConfig
): SessionGateway {
  return new SessionGateway(config);
}
