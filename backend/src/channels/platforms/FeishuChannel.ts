/**
 * FeishuChannel 飞书通道适配器
 * 对标 OpenClaw Feishu 支持
 * 飞书开放平台 API 集成
 */
import {
  BasePlatformAdapter,
  PLATFORM_MESSAGE_FORMATS,
  type PlatformType,
} from './BasePlatformAdapter';

export interface FeishuConfig {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
}

export interface FeishuMessage {
  openId: string;
  chatId: string;
  content: string;
  msgType: 'text' | 'post' | 'image' | 'file' | 'interactive';
  msgId: string;
  rootId?: string;
  parentId?: string;
  createTime: number;
}

export class FeishuChannel extends BasePlatformAdapter {
  private lastMessage: FeishuMessage | null = null;

  constructor(config?: Partial<FeishuConfig>) {
    super('feishu' as PlatformType, {
      enabled: config?.enabled ?? false,
      appId: config?.appId,
      appSecret: config?.appSecret,
      verificationToken: config?.verificationToken,
      encryptKey: config?.encryptKey,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as FeishuConfig;
    if (!cfg.enabled || !cfg.appId || !cfg.appSecret) return false;

    this.connected = true;
    this.emitEvent('connected', { appId: cfg.appId });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('message_sent', {
      chatId: target,
      content: truncated,
    });

    return true;
  }

  async sendInteractiveCard(
    chatId: string,
    title: string,
    elements: Array<{ tag: string; text: string }>
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('interactive_card_sent', {
      chatId,
      title,
      elementCount: elements.length,
    });

    return true;
  }

  handleIncomingMessage(message: FeishuMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      openId: message.openId,
      chatId: message.chatId,
      content: message.content,
      msgId: message.msgId,
      threadId: message.rootId,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      format: PLATFORM_MESSAGE_FORMATS[this.platform],
      capabilities: {
        threading: true,
        interactiveCard: true,
        markdown: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const feishuChannel = new FeishuChannel();
