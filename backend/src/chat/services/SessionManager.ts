/**
 * 会话管理器
 * 负责会话的创建、管理、保存和加载
 */
import type {
  ChatSession,
  SessionState,
  SessionMetadata,
  CreateSessionParams,
  SessionStorage,
} from '../types/session';
import type { Message } from '../types/message';
import { SessionState as SessionStateEnum } from '../types/session';
import type { SessionCheckpoint, CheckpointDiff } from '../types/checkpoint';
import {
  SessionCheckpointService,
  getCheckpointService,
} from './SessionCheckpointService';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 内存会话存储
 */
class MemorySessionStorage implements SessionStorage {
  private sessions: Map<string, ChatSession> = new Map();
  private messages: Map<string, Message[]> = new Map();

  async saveSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, session);
    this.messages.set(session.id, session.messages);
  }

  async loadSession(sessionId: string): Promise<ChatSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async loadSessions(): Promise<ChatSession[]> {
    return Array.from(this.sessions.values());
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
  }

  async updateSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, session);
    this.messages.set(session.id, session.messages);
  }

  async saveMessage(sessionId: string, message: Message): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      session.metadata.totalMessages = session.messages.length;
      this.sessions.set(sessionId, session);
      this.messages.set(sessionId, session.messages);
    }
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    return this.messages.get(sessionId) || [];
  }
}

/**
 * 会话管理器接口
 */
export interface SessionManager {
  /**
   * 创建会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession;

  /**
   * 获取会话
   * @param sessionId 会话ID
   * @returns 会话对象或undefined
   */
  getSession(sessionId: string): ChatSession | undefined;

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[];

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void;

  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: ChatSession): Promise<void>;

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或undefined
   */
  loadSession(sessionId: string): Promise<ChatSession | undefined>;

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  loadSessions(): Promise<ChatSession[]>;

  /**
   * 更新会话
   * @param session 会话对象
   */
  updateSession(session: ChatSession): void;

  /**
   * 添加消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void;

  /**
   * 获取当前会话
   * @returns 当前会话对象或undefined
   */
  getCurrentSession(): ChatSession | undefined;

  /**
   * 设置当前会话
   * @param sessionId 会话ID
   */
  setCurrentSession(sessionId: string): void;

  /**
   * 暂停会话
   * @param sessionId 会话ID
   */
  pauseSession(sessionId: string): void;

  /**
   * 恢复会话
   * @param sessionId 会话ID
   */
  resumeSession(sessionId: string): void;

  /**
   * 结束会话
   * @param sessionId 会话ID
   */
  endSession(sessionId: string): void;

  /**
   * 归档会话
   * @param sessionId 会话ID
   */
  archiveSession(sessionId: string): void;

  /**
   * 搜索会话
   * @param query 搜索查询
   * @returns 会话列表
   */
  searchSessions(query: string): ChatSession[];

  /**
   * 获取会话统计信息
   * @returns 会话统计信息
   */
  getSessionStats(): {
    total: number;
    active: number;
    paused: number;
    ended: number;
    archived: number;
  };

  /**
   * 创建会话检查点
   * @param sessionId 会话ID
   * @param label 检查点标签（可选）
   * @returns 检查点ID
   */
  createCheckpoint(sessionId: string, label?: string): Promise<string>;

  /**
   * 列出会话检查点
   * @param sessionId 会话ID
   * @returns 检查点列表
   */
  listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]>;

  /**
   * 回滚到指定检查点
   * @param checkpointId 检查点ID
   * @returns 回滚后的会话数据和差异信息
   */
  rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: CheckpointDiff;
  }>;

  /**
   * 删除检查点
   * @param checkpointId 检查点ID
   */
  deleteCheckpoint(checkpointId: string): Promise<void>;

  /**
   * 删除会话的所有检查点
   * @param sessionId 会话ID
   */
  deleteSessionCheckpoints(sessionId: string): Promise<void>;

  /**
   * 获取最新的检查点
   * @param sessionId 会话ID
   * @returns 最新的检查点或null
   */
  getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | null>;

  /**
   * 自动创建检查点
   * @param sessionId 会话ID
   */
  autoCreateCheckpoint(sessionId: string): Promise<SessionCheckpoint | null>;
}

/**
 * 会话管理器实现
 */
export class SessionManagerImpl implements SessionManager {
  /**
   * 会话存储
   */
  private storage: SessionStorage;

  /**
   * 会话缓存
   */
  private sessions: Map<string, ChatSession> = new Map();

  /**
   * 当前会话ID
   */
  private currentSessionId: string | undefined;

  /**
   * 检查点服务
   */
  private checkpointService: SessionCheckpointService;

  /**
   * 构造函数
   * @param storage 会话存储
   */
  constructor(storage?: SessionStorage) {
    this.storage = storage || new MemorySessionStorage();
    this.checkpointService = getCheckpointService();
    this.loadSessionsFromStorage();
  }

  /**
   * 从存储加载会话
   */
  private async loadSessionsFromStorage(): Promise<void> {
    const sessions = await this.storage.loadSessions();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
  }

  /**
   * 生成会话ID
   * @returns 会话ID
   */
  private generateSessionId(): string {
    return (
      'session_' +
      Date.now().toString(36) +
      Math.random().toString(36).substr(2)
    );
  }

  /**
   * 创建会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession {
    const now = new Date();
    const session: ChatSession = {
      id: this.generateSessionId(),
      state: SessionStateEnum.ACTIVE,
      metadata: {
        title: params.title,
        description: params.description,
        tags: params.tags,
        mode: params.mode,
        model: params.model,
        creator: params.creator,
        lastActivityAt: now,
        totalMessages: params.initialMessages?.length || 0,
        totalTokens: 0,
        totalCost: 0,
        ...params.metadata,
      },
      messages: params.initialMessages || [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    this.storage.saveSession(session);
    this.setCurrentSession(session.id);

    return session;
  }

  /**
   * 获取会话
   * @param sessionId 会话ID
   * @returns 会话对象或undefined
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.storage.deleteSession(sessionId);

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = undefined;
    }
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, session);
    await this.storage.saveSession(session);
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或undefined
   */
  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    const session = await this.storage.loadSession(sessionId);
    if (session) {
      this.sessions.set(sessionId, session);
    }
    return session || undefined;
  }

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  async loadSessions(): Promise<ChatSession[]> {
    const sessions = await this.storage.loadSessions();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
    return sessions;
  }

  /**
   * 更新会话
   * @param session 会话对象
   */
  updateSession(session: ChatSession): void {
    session.updatedAt = new Date();
    this.sessions.set(session.id, session);
    this.storage.saveSession(session);
  }

  /**
   * 添加消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      session.metadata.totalMessages = session.messages.length;
      this.sessions.set(sessionId, session);
      // 不需要调用storage.saveMessage，因为我们已经更新了session并保存了整个session
      this.storage.updateSession(session);
    }
  }

  /**
   * 获取当前会话
   * @returns 当前会话对象或undefined
   */
  getCurrentSession(): ChatSession | undefined {
    if (!this.currentSessionId) {
      return undefined;
    }
    return this.sessions.get(this.currentSessionId);
  }

  /**
   * 设置当前会话
   * @param sessionId 会话ID
   */
  setCurrentSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.currentSessionId = sessionId;
    }
  }

  /**
   * 暂停会话
   * @param sessionId 会话ID
   */
  pauseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = SessionStateEnum.PAUSED;
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      this.storage.saveSession(session);
    }
  }

  /**
   * 恢复会话
   * @param sessionId 会话ID
   */
  resumeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = SessionStateEnum.ACTIVE;
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      this.sessions.set(sessionId, session);
      this.storage.saveSession(session);
    }
  }

  /**
   * 结束会话
   * @param sessionId 会话ID
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = SessionStateEnum.ENDED;
      session.endedAt = new Date();
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      this.storage.saveSession(session);
    }
  }

  /**
   * 归档会话
   * @param sessionId 会话ID
   */
  archiveSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = SessionStateEnum.ARCHIVED;
      session.archivedAt = new Date();
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      this.storage.saveSession(session);
    }
  }

  /**
   * 搜索会话
   * @param query 搜索查询
   * @returns 会话列表
   */
  searchSessions(query: string): ChatSession[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.sessions.values()).filter((session) => {
      return (
        session.metadata.title.toLowerCase().includes(queryLower) ||
        (session.metadata.description &&
          session.metadata.description.toLowerCase().includes(queryLower)) ||
        (session.metadata.tags &&
          session.metadata.tags.some((tag) =>
            tag.toLowerCase().includes(queryLower)
          ))
      );
    });
  }

  /**
   * 获取会话统计信息
   * @returns 会话统计信息
   */
  getSessionStats(): {
    total: number;
    active: number;
    paused: number;
    ended: number;
    archived: number;
  } {
    const sessions = this.getSessions();
    const stats = {
      total: sessions.length,
      active: 0,
      paused: 0,
      ended: 0,
      archived: 0,
    };

    for (const session of sessions) {
      switch (session.state) {
        case SessionStateEnum.ACTIVE:
          stats.active++;
          break;
        case SessionStateEnum.PAUSED:
          stats.paused++;
          break;
        case SessionStateEnum.ENDED:
          stats.ended++;
          break;
        case SessionStateEnum.ARCHIVED:
          stats.archived++;
          break;
      }
    }

    return stats;
  }

  async createCheckpoint(sessionId: string, label?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError(
        `Session not found: ${sessionId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const cp = await this.checkpointService.saveCheckpointWithData(
      sessionId,
      session.messages,
      session.metadata,
      session.state,
      label
    );

    return cp.id;
  }

  async listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    return this.checkpointService.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: CheckpointDiff;
  }> {
    const checkpoint = await this.checkpointService.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new AppError(
        `Checkpoint not found: ${checkpointId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const currentSession = this.sessions.get(checkpoint.sessionId);
    if (!currentSession) {
      throw new AppError(
        `Session not found: ${checkpoint.sessionId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const result = await this.checkpointService.rollbackToCheckpoint(
      checkpointId,
      {
        messages: currentSession.messages,
        metadata: currentSession.metadata,
        state: currentSession.state,
      }
    );

    const restoredSession: ChatSession = {
      ...currentSession,
      messages: result.messages,
      metadata: result.metadata,
      state: result.state,
      updatedAt: new Date(),
    };

    this.sessions.set(restoredSession.id, restoredSession);
    await this.storage.saveSession(restoredSession);

    return { session: restoredSession, diff: result.diff };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await this.checkpointService.deleteCheckpoint(checkpointId);
  }

  async deleteSessionCheckpoints(sessionId: string): Promise<void> {
    await this.checkpointService.deleteSessionCheckpoints(sessionId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpoint | null> {
    return this.checkpointService.getLatestCheckpoint(sessionId);
  }

  async autoCreateCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpoint | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    try {
      return await this.checkpointService.autoCreateCheckpoint(
        sessionId,
        session.messages,
        session.metadata,
        session.state
      );
    } catch (error) {
      return null;
    }
  }
}

/**
 * 创建会话管理器实例
 * @param storage 会话存储
 * @returns 会话管理器实例
 */
export function createSessionManager(storage?: SessionStorage): SessionManager {
  return new SessionManagerImpl(storage);
}
