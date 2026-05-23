/**
 * 统一会话网关
 * 整合所有Session相关模块，提供统一入口
 */

import { randomUUID } from 'crypto';

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
} from './lifecycle/index.js';

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

  constructor(config?: SessionGatewayConfig) {
    this.config = config ?? {};

    this.storage = StorageFactory.createStorage(
      this.config.storageConfig ?? { type: StorageType.MEMORY }
    );

    this.transcriptManager = createTranscriptManager(
      this.storage,
      this.config.transcriptConfig
    );

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
   * 初始化网关
   */
  async initialize(): Promise<void> {
    await this.storage.initialize();
    await this.transcriptManager.initialize();
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

    return session;
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<UnifiedSession | null> {
    return this.storage.getSession(sessionId);
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
    await this.storage.deleteSession(sessionId);
    await this.transcriptManager.deleteTranscript(sessionId);

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
   * 列出会话
   */
  async listSessions(filter?: SessionFilter): Promise<UnifiedSession[]> {
    return this.storage.listSessions(filter);
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

    const session = await this.getSession(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      await this.updateSession(session);
    }
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
      model ?? 'deepseek-chat'
    );

    if (!preResult.proceed) {
      return { success: false, error: preResult.reason };
    }

    const record = await this.compactionBridge.performCompact(
      sessionLike,
      model ?? 'deepseek-chat',
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
