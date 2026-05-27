/**
 * 消息类型
 */
export type MessageType = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 会话消息接口
 */
export interface SessionMessage {
  /**
   * 消息唯一标识符
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType;

  /**
   * 消息内容
   */
  content: string;

  /**
   * 消息创建时间
   */
  createdAt: Date;

  /**
   * 父消息ID
   */
  parentId?: string;

  /**
   * 工具执行结果
   */
  toolResult?: any;
}

/**
 * 会话消息类
 */
export class SessionMessage implements SessionMessage {
  /**
   * 创建一个新的会话消息实例
   * @param id 消息ID
   * @param type 消息类型
   * @param content 消息内容
   * @param createdAt 消息创建时间
   * @param parentId 父消息ID
   * @param toolResult 工具执行结果
   */
  constructor(
    public id: string,
    public type: MessageType,
    public content: string,
    public createdAt: Date = new Date(),
    public parentId?: string,
    public toolResult?: any
  ) {}

  /**
   * 设置工具执行结果
   * @param result 工具执行结果
   */
  setToolResult(result: any): void {
    this.toolResult = result;
  }

  /**
   * 序列化消息
   * @returns 序列化后的消息对象
   */
  toJSON(): object {
    return {
      id: this.id,
      type: this.type,
      content: this.content,
      createdAt: this.createdAt.toISOString(),
      parentId: this.parentId,
      toolResult: this.toolResult,
    };
  }

  /**
   * 从JSON创建消息
   * @param data JSON数据
   * @returns 消息实例
   */
  static fromJSON(data: any): SessionMessage {
    return new SessionMessage(
      data.id,
      data.type,
      data.content,
      new Date(data.createdAt),
      data.parentId,
      data.toolResult
    );
  }
}
