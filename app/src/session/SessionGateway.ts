/**
 * 统一会话网关
 * 整合所有Session相关模块，提供统一入口
 */

import { randomUUID } from 'crypto';
import path from 'path';

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { resolveSessionsDir, resolveDataDir } from '@modules/core';
import { asyncContextStorage } from '../context/AsyncContextStorage';
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
import type { UnifiedSessionStorage } from './storage/UnifiedStorage.js';
import type { StorageConfig } from './storage/UnifiedStorage.js';

// 确保 FILESYSTEM 存储实现被注册（SessionGateway 默认使用）
import './storage/FileSystemUnifiedStorage.js';

import { CrashRecoveryManager } from './recovery/CrashRecoveryManager.js';
import type { CrashRecoveryResult } from './recovery/CrashRecoveryManager.js';

import { SessionType, SessionStatus } from './types/Session.js';
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

const logger = new Logger({ module: 'session:gateway', level: LogLevel.INFO });

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
      this.setTokenTracker(new SessionTokenTracker());
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
    this.setTokenTracker(new SessionTokenTracker());
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

    this.setSessionPruner(new SessionPruner(adapter, options?.prunerOptions));
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
        const sessionId = event.sessionId;
        this.storage.getMessages(sessionId).then((messages) => {
          const engine = getFTS5SearchEngine();
          for (const msg of messages) {
            engine.remove(`msg_${msg.id}`);
          }
        });
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

    try {
      let sessionId = params.id;

      if (!sessionId && this.sessionRouter && params.sessionSource) {
        sessionId = this.sessionRouter.route(params.sessionSource);
      } else if (!sessionId && this.keyFactory) {
        sessionId = this.keyFactory
          .create({
            userId: params.userId,
            chatType: params.chatType as any,
          })
          .toString();
      }

      sessionId = sessionId ?? randomUUID();
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

      await this.storage.createSession(session);

      this.eventBus?.emit(
        createSessionLifecycleEvent('session:created', session.id, {
          sessionKey: session.id,
          metadata: { userId: params.userId, type: params.type },
        })
      );

      logger.info('会话已创建', { sessionId: session.id });
      otel.endSpan(span);
      return session;
    } catch (e) {
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
    const messages = await this.storage.getMessages(sessionId);

    await this.storage.deleteSession(sessionId);
    await this.transcriptManager.deleteTranscript(sessionId);

    this.eventBus?.emit(
      createSessionLifecycleEvent('message:deleted', sessionId, {
        sessionKey: sessionId,
        metadata: { messageCount: messages.length },
      })
    );

    this.eventBus?.emit(
      createSessionLifecycleEvent('session:deleted', sessionId, {
        sessionKey: sessionId,
      })
    );

    const remoteSession = this.remoteSessions.get(sessionId);
    if (remoteSession) {
      remoteSession.disconnect();
      this.remoteSessions.delete(sessionId);
    }

    const ws = this.webSockets.get(sessionId);
    if (ws) {
      ws.close();
      this.webSockets.delete(sessionId);
    }
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
    const { readdirSync } = require('node:fs');
    const { join } = require('path');
    const { readLiteSessionMeta } =
      await import('./storage/LiteSessionReader.js');
    const sessionsDir = resolveSessionsDir();

    try {
      const entries = readdirSync(sessionsDir);
      const results: Array<{
        id: string;
        title?: string;
        status?: string;
        updatedAt?: string;
      }> = [];

      for (const entry of entries) {
        if (entry.startsWith('.')) continue; // 跳过隐藏文件/迁移标记
        const fullPath = join(sessionsDir, entry);
        // 跳过目录和会话存储目录（directories have items inside）
        const { statSync } = require('node:fs');
        const isDir = (() => {
          try {
            return statSync(fullPath).isDirectory();
          } catch {
            return false;
          }
        })();
        if (!isDir) {
          // 直接 JSON 文件：提取文件名作为 ID
          const sessionId = entry.replace(/\.json$/i, '');
          const meta = readLiteSessionMeta(fullPath);
          if (meta) {
            results.push({ id: sessionId, ...meta });
          }
        }
      }

      return results;
    } catch {
      return [];
    }
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
    } catch {
      // FTS5 索引失败不应影响消息写入主流程
    }
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
      } catch {
        // 持久化失败不影响主流程
      }
    }, SessionGateway.FTS_SAVE_INTERVAL_MS);
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
    const totalTokens =
      (tokenUsage?.totalTokens ?? 0) +
      (tokenUsage?.inputTokens ?? 0) +
      (tokenUsage?.outputTokens ?? 0);

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
      modelContextWindow: 200000,
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
        logger.error('定时修剪执行失败', { error: String(err) });
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
    } catch {
      // 关闭时持久化失败不影响后续关闭流程
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
