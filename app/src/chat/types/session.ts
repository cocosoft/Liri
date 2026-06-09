/**
 * 会话状态
 *
 * @deprecated 使用 {@link DataSessionStatus} — 从 `@modules/core/data-models` 导入
 */
export enum SessionState {
  /**
   * 活跃
   */
  ACTIVE = 'active',

  /**
   * 已暂停
   */
  PAUSED = 'paused',

  /**
   * 已结束
   */
  ENDED = 'ended',

  /**
   * 已归档
   */
  ARCHIVED = 'archived',
}

/**
 * 会话元数据
 *
 * @deprecated 使用 {@link DataSessionMetadata} — 从 `@modules/core/data-models` 导入
 */
export interface SessionMetadata {
  /**
   * 会话标题
   */
  title: string;

  /**
   * 会话描述
   */
  description?: string;

  /**
   * 会话标签
   */
  tags?: string[];

  /**
   * 会话模式
   */
  mode?: string;

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 创建者
   */
  creator?: string;

  /**
   * 最后活动时间
   */
  lastActivityAt?: Date;

  /**
   * 总消息数
   */
  totalMessages?: number;

  /**
   * 总token数
   */
  totalTokens?: number;

  /**
   * 总成本
   */
  totalCost?: number;

  /**
   * 自定义元数据
   */
  [key: string]: any;
}

/**
 * 会话接口
 *
 * @deprecated 使用 {@link DataSession} — 从 `@modules/core/data-models` 导入
 */
export interface ChatSession {
  /**
   * 会话ID
   */
  id: string;

  /**
   * 会话标题
   */
  title?: string;

  /**
   * 会话状态
   */
  state: SessionState;

  /**
   * 会话元数据
   */
  metadata: SessionMetadata;

  /**
   * 消息列表
   */
  messages: Message[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 结束时间
   */
  endedAt?: Date;

  /**
   * 归档时间
   */
  archivedAt?: Date;

  /**
   * 最后修改时间
   */
  lastModifiedAt?: number;
}

/**
 * 会话存储接口
 */
export interface SessionStorage {
  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: ChatSession): Promise<void>;

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  loadSession(sessionId: string): Promise<ChatSession | null>;

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  loadSessions(): Promise<ChatSession[]>;

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * 更新会话
   * @param session 会话对象
   */
  updateSession(session: ChatSession): Promise<void>;

  /**
   * 保存消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  saveMessage(sessionId: string, message: Message): Promise<void>;

  /**
   * 加载消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  loadMessages(sessionId: string): Promise<Message[]>;
}

/**
 * 创建会话的参数
 *
 * @deprecated 使用 {@link DataCreateSessionParams} — 从 `@modules/core/data-models` 导入
 */
export interface CreateSessionParams {
  /**
   * 会话标题
   */
  title: string;

  /**
   * 会话描述
   */
  description?: string;

  /**
   * 会话标签
   */
  tags?: string[];

  /**
   * 会话模式
   */
  mode?: string;

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 创建者
   */
  creator?: string;

  /**
   * 初始消息
   */
  initialMessages?: Message[];

  /**
   * 自定义元数据
   */
  metadata?: Record<string, unknown>;
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
   * 创建会话检查点
   * @param sessionId 会话ID
   * @param label 检查点标签（可选）
   */
  createCheckpoint?(sessionId: string, label?: string): Promise<string>;

  /**
   * 列出会话检查点
   * @param sessionId 会话ID
   */
  listCheckpoints?(
    sessionId: string
  ): Promise<Array<{ id: string; label?: string; createdAt: number }>>;

  /**
   * 回滚到指定检查点
   * @param checkpointId 检查点ID
   */
  rollbackToCheckpoint?(checkpointId: string): Promise<void>;
}

/**
 * 从Message类型导入
 */
import type { Message } from './message';
