import type { Session } from './models/Session';
import type { SessionMessage } from './models/SessionMessage';
import type { SessionMetadata } from './models/SessionMetadata';

/**
 * 消息加载选项
 */
export interface MessageLoadOptions {
  limit?: number;
  offset?: number;
  since?: Date;
  until?: Date;
  types?: string[];
}

/**
 * 会话列表选项
 */
export interface SessionListOptions {
  limit?: number;
  offset?: number;
  since?: Date;
  until?: Date;
  tags?: string[];
  mode?: string;
}

/**
 * 会话搜索选项
 */
export interface SessionSearchOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
  mode?: string;
}

/**
 * 会话清理选项
 */
export interface SessionCleanupOptions {
  days?: number;
  maxSessions?: number;
  includeActive?: boolean;
}

/**
 * 会话存储接口
 */
export interface SessionStorage {
  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: Session): Promise<void>;

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  loadSession(sessionId: string): Promise<Session | null>;

  /**
   * 保存消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  saveMessage(sessionId: string, message: SessionMessage): Promise<void>;

  /**
   * 加载消息
   * @param sessionId 会话ID
   * @param options 加载选项
   * @returns 消息列表
   */
  loadMessages(
    sessionId: string,
    options?: MessageLoadOptions
  ): Promise<SessionMessage[]>;

  /**
   * 保存元数据
   * @param sessionId 会话ID
   * @param metadata 元数据对象
   */
  saveMetadata(sessionId: string, metadata: SessionMetadata): Promise<void>;

  /**
   * 加载元数据
   * @param sessionId 会话ID
   * @returns 元数据对象或null
   */
  loadMetadata(sessionId: string): Promise<SessionMetadata | null>;

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * 列出会话
   * @param options 列表选项
   * @returns 会话ID列表
   */
  listSessions(options?: SessionListOptions): Promise<string[]>;

  /**
   * 检查会话是否存在
   * @param sessionId 会话ID
   * @returns 是否存在
   */
  sessionExists(sessionId: string): Promise<boolean>;

  /**
   * 压缩会话
   * @param sessionId 会话ID
   */
  compactSession(sessionId: string): Promise<void>;
}
