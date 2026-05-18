/**
 * WeChatChannel 微信通道适配器
 * 对标 OpenClaw WeChat 支持
 * 企业微信 + 个人微信双模式
 */
import {
  BasePlatformAdapter,
  PLATFORM_MESSAGE_FORMATS,
  type PlatformType,
} from './BasePlatformAdapter';

export interface WeChatConfig {
  enabled: boolean;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  token?: string;
  encodingAESKey?: string;
  personalMode: boolean;
}

export interface WeChatMessage {
  fromUser: string;
  toUser: string;
  content: string;
  msgType: 'text' | 'image' | 'voice' | 'video' | 'file' | 'event';
  msgId: string;
  createTime: number;
}

export class WeChatChannel extends BasePlatformAdapter {
  private lastMessage: WeChatMessage | null = null;

  constructor(config?: Partial<WeChatConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      corpId: config?.corpId,
      corpSecret: config?.corpSecret,
      agentId: config?.agentId,
      token: config?.token,
      encodingAESKey: config?.encodingAESKey,
      personalMode: config?.personalMode ?? false,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as WeChatConfig;
    if (!cfg.enabled) return false;

    if (!cfg.personalMode && (!cfg.corpId || !cfg.corpSecret)) return false;
    if (cfg.personalMode && !cfg.token) return false;

    this.connected = true;
    this.emitEvent('connected', {
      mode: cfg.personalMode ? 'personal' : 'corp',
    });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('message_sent', { target, content: truncated });

    return true;
  }

  handleIncomingMessage(message: WeChatMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      fromUser: message.fromUser,
      content: message.content,
      msgId: message.msgId,
    });
  }

  getStatus(): Record<string, unknown> {
    const cfg = this._config as unknown as WeChatConfig;

    return {
      connected: this.connected,
      platform: this.platform,
      mode: cfg.personalMode ? 'personal' : 'corp',
      format: PLATFORM_MESSAGE_FORMATS[this.platform],
      lastMessage: this.lastMessage,
    };
  }
}

export const wechatChannel = new WeChatChannel();
