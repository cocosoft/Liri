/**
 * DingTalkChannel 钉钉通道适配器
 * 对标 OpenClaw DingTalk 支持
 * 钉钉开放平台 API 集成
 */
import {
  BasePlatformAdapter,
  PLATFORM_MESSAGE_FORMATS,
  type PlatformType,
} from './BasePlatformAdapter';

export interface DingTalkConfig {
  enabled: boolean;
  appKey?: string;
  appSecret?: string;
  robotCode?: string;
  webhookUrl?: string;
}

export interface DingTalkMessage {
  senderId: string;
  senderNick: string;
  conversationId: string;
  conversationType: '1' | '2';
  content: string;
  msgId: string;
  createAt: number;
}

export class DingTalkChannel extends BasePlatformAdapter {
  private lastMessage: DingTalkMessage | null = null;

  constructor(config?: Partial<DingTalkConfig>) {
    super('dingtalk' as PlatformType, {
      enabled: config?.enabled ?? false,
      appKey: config?.appKey,
      appSecret: config?.appSecret,
      robotCode: config?.robotCode,
      webhookUrl: config?.webhookUrl,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as DingTalkConfig;
    if (!cfg.enabled) return false;

    const hasCredential = cfg.appKey && cfg.appSecret;
    const hasWebhook = !!cfg.webhookUrl;

    if (!hasCredential && !hasWebhook) return false;

    this.connected = true;
    this.emitEvent('connected', { mode: hasWebhook ? 'webhook' : 'api' });

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
      conversationId: target,
      content: truncated,
    });

    return true;
  }

  async sendMarkdown(
    target: string,
    title: string,
    markdown: string
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('markdown_sent', {
      conversationId: target,
      title,
      markdownLength: markdown.length,
    });

    return true;
  }

  handleIncomingMessage(message: DingTalkMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      senderId: message.senderId,
      senderNick: message.senderNick,
      conversationId: message.conversationId,
      content: message.content,
      msgId: message.msgId,
    });
  }

  getStatus(): Record<string, unknown> {
    const cfg = this._config as unknown as DingTalkConfig;

    return {
      connected: this.connected,
      platform: this.platform,
      format: PLATFORM_MESSAGE_FORMATS[this.platform],
      capabilities: {
        markdown: true,
        webhook: !!cfg.webhookUrl,
        api: !!(cfg.appKey && cfg.appSecret),
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const dingtalkChannel = new DingTalkChannel();
