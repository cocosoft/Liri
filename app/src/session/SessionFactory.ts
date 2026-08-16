import { v4 as uuidv4 } from 'uuid';
import { Session } from './models/Session';
import { SessionMetadata } from './models/SessionMetadata';
import { SessionState } from './models/SessionState';
import type { SessionMessage } from './models/SessionMessage';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from './SessionStorage';
import { MemoryStorage } from './storage/MemoryStorage';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { SessionSource } from './key/SessionSource';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:factory');

/**
 * 会话工厂
 * 用于创建和管理会话
 */
export class SessionFactory {
  /**
   * 存储实例
   */
  private storage: SessionStorage;

  /**
   * 构造函数
   * @param storage 存储实例
   */
  constructor(storage: SessionStorage = new MemoryStorage()) {
    this.storage = storage;
  }

  /**
   * 创建新会话
   * @param options 会话选项
   * @returns 会话实例
   */
  async createSession(options?: {
    title?: string;
    tags?: string[];
    mode?: string;
    initialState?: string;
    source?: SessionSource;
  }): Promise<Session> {
    const id = uuidv4();
    const title =
      options?.title?.trim() || `Session ${new Date().toISOString()}`;
    const metadata = new SessionMetadata(
      title,
      options?.tags || [],
      options?.mode || 'default'
    );
    const state = new SessionState(options?.initialState || 'idle');
    const session = new Session(
      id,
      metadata,
      state,
      [],
      undefined,
      undefined,
      options?.source
    );

    await this.storage.saveSession(session);
    return session;
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话实例或null
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    return this.storage.loadSession(sessionId);
  }

  /**
   * 保存会话
   * @param session 会话实例
   */
  async saveSession(session: Session): Promise<void> {
    session.update();
    await this.storage.saveSession(session);
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.deleteSession(sessionId);
  }

  /**
   * 列出会话
   * @param options 列表选项
   * @returns 会话ID列表
   */
  async listSessions(options?: SessionListOptions): Promise<string[]> {
    return this.storage.listSessions(options);
  }

  /**
   * 检查会话是否存在
   * @param sessionId 会话ID
   * @returns 是否存在
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    return this.storage.sessionExists(sessionId);
  }

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param message 消息实例
   */
  async addMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new AppError(
        `Session ${sessionId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    session.addMessage(message);
    await this.saveSession(session);
  }

  /**
   * 加载会话消息
   * @param sessionId 会话ID
   * @param options 加载选项
   * @returns 消息列表
   */
  async loadMessages(
    sessionId: string,
    options?: MessageLoadOptions
  ): Promise<SessionMessage[]> {
    return this.storage.loadMessages(sessionId, options);
  }

  /**
   * 更新会话元数据
   * @param sessionId 会话ID
   * @param metadata 元数据对象
   */
  async updateMetadata(
    sessionId: string,
    metadata: Partial<SessionMetadata>
  ): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new AppError(
        `Session ${sessionId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    session.updateMetadata(metadata);
    // P2-33 修复：session.json（saveSession）是权威主文件，已内嵌最新元数据。
    // 随后的 saveMetadata 是派生缓存文件（metadata.json），写失败不影响主数据正确性
    // （下次保存自愈），故仅告警不抛出，避免"两次写非原子"把操作标记为失败。
    await this.saveSession(session);
    try {
      await this.storage.saveMetadata(sessionId, session.metadata);
    } catch (err) {
      logger.warn('元数据缓存写失败（session.json 已是最新）', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 压缩会话
   * @param sessionId 会话ID
   */
  async compactSession(sessionId: string): Promise<void> {
    await this.storage.compactSession(sessionId);
  }

  /**
   * 获取存储实例
   * @returns 存储实例
   */
  getStorage(): SessionStorage {
    return this.storage;
  }

  /**
   * 设置存储实例
   * @param storage 存储实例
   */
  setStorage(storage: SessionStorage): void {
    this.storage = storage;
  }
}
