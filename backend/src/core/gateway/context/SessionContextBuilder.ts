/**
 * SessionContextBuilder 会话上下文构建器
 * 对标 Hermes gateway/session.py
 * 构建注入到 system prompt 中的会话上下文，让 Agent 感知消息来源
 */

import type { ChannelSession } from '../../../channels/session/ChannelSessionManager';
import type { MessageContext } from '../../../channels/types/IChannel';

/**
 * 会话上下文信息（构建后的输出）
 */
export interface BuiltSessionContext {
  /** 格式化的上下文文本 */
  text: string;

  /** 渠道类型 */
  channelType: string;

  /** 用户标识 */
  userId: string;

  /** 对话标识 */
  conversationId: string;

  /** 轮次编号 */
  turnNumber: number;
}

/**
 * 上下文注入位置
 */
export type InjectionPosition = 'header' | 'footer';

/**
 * 上下文构建配置
 */
export interface SessionContextConfig {
  /** 是否在上下文中包含渠道名称 */
  includeChannelName: boolean;

  /** 是否在上下文中包含用户名称 */
  includeUserName: boolean;

  /** 是否在上下文中包含轮次信息 */
  includeTurnNumber: boolean;

  /** 是否在上下文中包含时间信息 */
  includeTimestamp: boolean;

  /** 上下文注入位置：header（提示词开头）或 footer（提示词末尾） */
  injectionPosition: InjectionPosition;

  /** 自定义渠道显示名称映射 */
  channelDisplayNames?: Record<string, string>;
}

/**
 * 默认上下文配置
 */
const DEFAULT_CONFIG: SessionContextConfig = {
  includeChannelName: true,
  includeUserName: true,
  includeTurnNumber: true,
  includeTimestamp: false,
  injectionPosition: 'header',
  channelDisplayNames: {
    wecom: '企业微信',
    feishu: '飞书',
    dingtalk: '钉钉',
    wechat: '微信',
    qq: 'QQ',
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    irc: 'IRC',
    nostr: 'Nostr',
    line: 'LINE',
    web: 'Web',
  },
};

/**
 * 会话上下文构建器
 * 将会话/渠道/用户信息构建为结构化的上下文文本，
 * 可注入到 system prompt 中，让 Agent 感知消息来源
 */
export class SessionContextBuilder {
  private config: SessionContextConfig;

  /**
   * @param config 上下文构建配置
   */
  constructor(config?: Partial<SessionContextConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(partial: Partial<SessionContextConfig>): void {
    Object.assign(this.config, partial);
  }

  /**
   * 获取当前配置
   */
  getConfig(): SessionContextConfig {
    return { ...this.config };
  }

  /**
   * 从会话和消息上下文构建会话上下文
   *
   * @param session 通道会话
   * @param message 消息上下文
   * @param turnNumber 当前轮次编号
   * @returns 构建的会话上下文
   */
  build(
    session: ChannelSession,
    message: MessageContext,
    turnNumber: number = 0
  ): BuiltSessionContext {
    const parts: string[] = [];
    const channelName = this.getChannelDisplayName(session.channelId);

    parts.push('<session_context>');
    parts.push(`  来源渠道: ${channelName}`);

    if (this.config.includeUserName && message.senderName) {
      parts.push(`  用户: ${message.senderName}`);
    }

    parts.push(`  用户ID: ${message.senderId}`);

    if (this.config.includeChannelName) {
      parts.push(`  会话ID: ${session.id}`);
    }

    if (this.config.includeTurnNumber) {
      parts.push(`  轮次: #${turnNumber}`);
    }

    if (this.config.includeTimestamp) {
      const timeStr = new Date(message.timestamp).toISOString();
      parts.push(`  时间: ${timeStr}`);
    }

    parts.push('</session_context>');

    return {
      text: parts.join('\n'),
      channelType: session.channelId,
      userId: message.senderId,
      conversationId: session.conversationId,
      turnNumber,
    };
  }

  /**
   * 构建轻量级上下文（简洁模式，仅包含关键信息）
   *
   * @param session 通道会话
   * @param message 消息上下文
   * @returns 构建的会话上下文
   */
  buildBrief(
    session: ChannelSession,
    message: MessageContext
  ): BuiltSessionContext {
    const channelName = this.getChannelDisplayName(session.channelId);
    const text = `[来自 ${channelName}${message.senderName ? ` 用户 ${message.senderName}` : ''}]`;

    return {
      text,
      channelType: session.channelId,
      userId: message.senderId,
      conversationId: session.conversationId,
      turnNumber: 0,
    };
  }

  /**
   * 将上下文注入到 system prompt 中
   *
   * @param prompt 原始 system prompt
   * @param context 构建的会话上下文
   * @returns 注入后的 system prompt
   */
  inject(prompt: string, context: BuiltSessionContext): string {
    if (this.config.injectionPosition === 'header') {
      return `${context.text}\n\n${prompt}`;
    }
    return `${prompt}\n\n${context.text}`;
  }

  /**
   * 从消息上下文提取会话上下文（无需 ChannelSession 的快捷方式）
   *
   * @param message 消息上下文
   * @param channelName 渠道名称
   * @returns 构建的会话上下文
   */
  buildFromMessage(message: MessageContext, channelName?: string): BuiltSessionContext {
    const name = channelName || this.getChannelDisplayName(message.channelId);

    const text = [
      '<session_context>',
      `  来源渠道: ${name}`,
    ];

    if (this.config.includeUserName && message.senderName) {
      text.push(`  用户: ${message.senderName}`);
    }

    text.push(`  用户ID: ${message.senderId}`);
    text.push('</session_context>');

    return {
      text: text.join('\n'),
      channelType: message.channelId,
      userId: message.senderId,
      conversationId: message.conversationId || message.senderId,
      turnNumber: 0,
    };
  }

  /**
   * 获取渠道显示名称
   */
  private getChannelDisplayName(channelId: string): string {
    return this.config.channelDisplayNames?.[channelId] || channelId;
  }
}
