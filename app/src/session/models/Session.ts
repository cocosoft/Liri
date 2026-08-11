import type { SessionMetadata } from './SessionMetadata';
import type { SessionMessage } from './SessionMessage';
import type { SessionState } from './SessionState';
import type { SessionSource } from '../key/SessionSource';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('session:models:session');

/**
 * 会话模型接口
 */
export interface Session {
  /**
   * 会话唯一标识符
   */
  id: string;

  /**
   * 会话创建时间
   */
  createdAt: Date;

  /**
   * 会话更新时间
   */
  updatedAt: Date;

  /**
   * 会话元数据
   */
  metadata: SessionMetadata;

  /**
   * 会话状态
   */
  state: SessionState;

  /**
   * 会话消息列表
   */
  messages: SessionMessage[];

  /**
   * 会话来源信息
   */
  source?: SessionSource;
}

/**
 * 会话模型类
 */
export class Session implements Session {
  /**
   * 创建一个新的会话实例
   * @param id 会话ID
   * @param metadata 会话元数据
   * @param state 会话状态
   * @param messages 会话消息列表
   */
  constructor(
    public id: string,
    public metadata: SessionMetadata,
    public state: SessionState,
    public messages: SessionMessage[] = [],
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
    public source?: SessionSource
  ) {}

  /**
   * 更新会话
   */
  update(): void {
    this.updatedAt = new Date();
  }

  /**
   * 添加消息到会话
   * @param message 会话消息
   */
  addMessage(message: SessionMessage): void {
    this.messages.push(message);
    this.update();
  }

  /**
   * 更新会话元数据
   * @param metadata 会话元数据
   */
  updateMetadata(metadata: Partial<SessionMetadata>): void {
    if (metadata.title !== undefined) this.metadata.title = metadata.title;
    if (metadata.tags !== undefined) this.metadata.tags = metadata.tags;
    if (metadata.mode !== undefined) this.metadata.mode = metadata.mode;
    if (metadata.worktreeState !== undefined)
      this.metadata.worktreeState = metadata.worktreeState;
    if (metadata.prLink !== undefined) this.metadata.prLink = metadata.prLink;
    this.update();
  }

  /**
   * 更新会话状态
   * @param state 会话状态
   */
  updateState(state: Partial<SessionState>): void {
    const from = this.state.currentState;
    if (state.currentState !== undefined)
      this.state.currentState = state.currentState;
    if (state.history !== undefined) this.state.history = state.history;
    if (state.config !== undefined) this.state.config = state.config;
    this.update();

    if (state.currentState !== undefined && state.currentState !== from) {
      logger.debug('会话状态切换（Session 层）', {
        sessionId: this.id,
        from,
        to: state.currentState,
      });
    }
  }

  /**
   * 序列化会话
   * @returns 序列化后的会话对象
   */
  toJSON(): object {
    return {
      id: this.id,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      metadata: this.metadata.toJSON(),
      state: this.state.toJSON(),
      messages: this.messages.map((message) => message.toJSON()),
      source: this.source ?? undefined,
    };
  }

  /**
   * 从JSON创建会话
   * @param data JSON数据
   * @returns 会话实例
   */
  static fromJSON(data: any): Session {
    return new Session(
      data.id,
      data.metadata,
      data.state,
      data.messages || [],
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.source
    );
  }
}
