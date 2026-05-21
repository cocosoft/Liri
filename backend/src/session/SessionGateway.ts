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

  constructor(config?: SessionGatewayConfig) {
    this.config = config ?? {};

    this.storage = StorageFactory.createStorage(
      this.config.storageConfig ?? { type: StorageType.MEMORY }
    );

    this.transcriptManager = createTranscriptManager(
      this.storage,
      this.config.transcriptConfig
    );
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
    params: CreateSessionParams = {}
  ): Promise<UnifiedSession> {
    const sessionId = params.id ?? randomUUID();
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
