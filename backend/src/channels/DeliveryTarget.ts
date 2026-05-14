/**
 * DeliveryTarget 消息投递目标
 * 对标 Hermes gateway/ 的 DeliveryTarget 数据结构
 * 格式: platform:chat_id:thread_id
 */
import type { ChannelId } from './types/IChannel';

/**
 * 消息投递目标
 */
export class DeliveryTarget {
  /** 目标平台 */
  readonly platform: ChannelId;
  /** 聊天/会话 ID */
  readonly chatId: string;
  /** 线程 ID（可选） */
  readonly threadId: string | null;

  /**
   * 构造函数
   * @param platform 目标平台
   * @param chatId 聊天/会话 ID
   * @param threadId 线程 ID（可选）
   */
  constructor(platform: ChannelId, chatId: string, threadId?: string) {
    this.platform = platform;
    this.chatId = chatId;
    this.threadId = threadId || null;
  }

  /**
   * 从字符串解析 DeliveryTarget
   * 格式: "platform:chat_id" 或 "platform:chat_id:thread_id"
   * @param targetStr 目标字符串
   * @returns DeliveryTarget 实例
   */
  static parse(targetStr: string): DeliveryTarget | null {
    const parts = targetStr.split(':');

    if (parts.length < 2) {
      return null;
    }

    const platform = parts[0] as ChannelId;
    const chatId = parts[1];

    if (!platform || !chatId) {
      return null;
    }

    const threadId = parts.length >= 3 ? parts[2] : undefined;

    return new DeliveryTarget(platform, chatId, threadId);
  }

  /**
   * 序列化为字符串
   * @returns "platform:chat_id" 或 "platform:chat_id:thread_id"
   */
  toString(): string {
    if (this.threadId) {
      return `${this.platform}:${this.chatId}:${this.threadId}`;
    }

    return `${this.platform}:${this.chatId}`;
  }

  /**
   * 判断两个目标是否相等
   * @param other 另一个目标
   * @returns 是否相等
   */
  equals(other: DeliveryTarget): boolean {
    return (
      this.platform === other.platform &&
      this.chatId === other.chatId &&
      this.threadId === other.threadId
    );
  }

  /**
   * 判断是否为同一平台和会话（忽略线程）
   * @param other 另一个目标
   * @returns 是否为同一平台和会话
   */
  sameConversation(other: DeliveryTarget): boolean {
    return this.platform === other.platform && this.chatId === other.chatId;
  }

  /**
   * 创建此目标的副本，指定新的线程 ID
   * @param newThreadId 新线程 ID
   * @returns 新的 DeliveryTarget
   */
  withThread(newThreadId: string): DeliveryTarget {
    return new DeliveryTarget(this.platform, this.chatId, newThreadId);
  }

  /**
   * 创建此目标的副本，指定新的聊天 ID
   * @param newChatId 新聊天 ID
   * @returns 新的 DeliveryTarget
   */
  withChat(newChatId: string): DeliveryTarget {
    return new DeliveryTarget(
      this.platform,
      newChatId,
      this.threadId || undefined
    );
  }

  /**
   * 从 MessageContext 创建 origin 模式的目标
   * @param platform 来源平台
   * @param conversationId 会话 ID
   * @returns DeliveryTarget
   */
  static fromOrigin(
    platform: ChannelId,
    conversationId: string
  ): DeliveryTarget {
    return new DeliveryTarget(platform, conversationId);
  }
}
