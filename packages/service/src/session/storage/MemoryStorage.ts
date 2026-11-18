import type { Session } from '../models/Session';
import type { SessionMessage } from '../models/SessionMessage';
import type { SessionMetadata } from '../models/SessionMetadata';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from '../SessionStorage';

/**
 * 内存存储实现
 * 用于临时会话存储，不持久化到磁盘
 */
export class MemoryStorage implements SessionStorage {
  /**
   * 会话存储
   */
  private sessions: Map<string, Session> = new Map();

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 保存消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  async saveMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.addMessage(message);
      this.sessions.set(sessionId, session);
    }
    // @ignore-catch: 会话不存在时消息静默丢弃（内存存储无持久化依赖，本文件无 logger；
    // 调用方应先 saveSession——若需排查顺序 bug 可在上层校验）
  }

  /**
   * 加载消息
   * @param sessionId 会话ID
   * @param options 加载选项
   * @returns 消息列表
   */
  async loadMessages(
    sessionId: string,
    options?: MessageLoadOptions
  ): Promise<SessionMessage[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    let messages = [...session.messages];

    // 应用过滤选项
    if (options) {
      if (options.since) {
        messages = messages.filter((msg) => msg.createdAt >= options.since!);
      }

      if (options.until) {
        messages = messages.filter((msg) => msg.createdAt <= options.until!);
      }

      if (options.types) {
        messages = messages.filter((msg) => options.types!.includes(msg.type));
      }

      // 应用分页选项
      if (options.offset) {
        messages = messages.slice(options.offset);
      }

      if (options.limit) {
        messages = messages.slice(0, options.limit);
      }
    }

    return messages;
  }

  /**
   * 保存元数据
   * @param sessionId 会话ID
   * @param metadata 元数据对象
   */
  async saveMetadata(
    sessionId: string,
    metadata: SessionMetadata
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updateMetadata(metadata);
      this.sessions.set(sessionId, session);
    }
    // @ignore-catch: 会话不存在时元数据静默丢弃（内存存储无持久化依赖，本文件无 logger）
  }

  /**
   * 加载元数据
   * @param sessionId 会话ID
   * @returns 元数据对象或null
   */
  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const session = this.sessions.get(sessionId);
    return session?.metadata || null;
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /**
   * 列出会话
   * @param options 列表选项
   * @returns 会话ID列表
   */
  async listSessions(options?: SessionListOptions): Promise<string[]> {
    let sessionIds = Array.from(this.sessions.keys());
    let sessions = Array.from(this.sessions.values());

    // 应用过滤选项
    if (options) {
      if (options.since) {
        sessions = sessions.filter(
          (session) => session.createdAt >= options.since!
        );
      }

      if (options.until) {
        sessions = sessions.filter(
          (session) => session.createdAt <= options.until!
        );
      }

      if (options.tags) {
        sessions = sessions.filter((session) =>
          options.tags!.some((tag) => session.metadata.tags.includes(tag))
        );
      }

      if (options.mode) {
        sessions = sessions.filter(
          (session) => session.metadata.mode === options.mode
        );
      }

      sessionIds = sessions.map((session) => session.id);

      // 应用分页选项
      if (options.offset) {
        sessionIds = sessionIds.slice(options.offset);
      }

      if (options.limit) {
        sessionIds = sessionIds.slice(0, options.limit);
      }
    }

    return sessionIds;
  }

  /**
   * 检查会话是否存在
   * @param sessionId 会话ID
   * @returns 是否存在
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  /**
   * 压缩会话
   * @param sessionId 会话ID
   */
  async compactSession(sessionId: string): Promise<void> {
    // 内存存储不需要压缩
  }

  /**
   * 清空所有会话
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * 获取会话数量
   * @returns 会话数量
   */
  size(): number {
    return this.sessions.size;
  }
}
