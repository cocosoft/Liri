import { BasePlatformAdapter, type PlatformType } from './BasePlatformAdapter';

export interface FacebookMessengerConfig {
  enabled: boolean;
  pageAccessToken?: string;
  verifyToken?: string;
  appSecret?: string;
  pageId?: string;
}

export interface FacebookMessengerMessage {
  senderId: string;
  recipientId: string;
  timestamp: number;
  message: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: Record<string, unknown>;
    }>;
  };
}

export class FacebookMessengerChannel extends BasePlatformAdapter {
  private lastMessage: FacebookMessengerMessage | null = null;

  constructor(config?: Partial<FacebookMessengerConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      pageAccessToken: config?.pageAccessToken,
      verifyToken: config?.verifyToken,
      appSecret: config?.appSecret,
      pageId: config?.pageId,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as FacebookMessengerConfig;
    if (!cfg.enabled || !cfg.pageAccessToken) return false;

    this.connected = true;
    this.emitEvent('connected', { pageId: cfg.pageId });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('message_sent', { recipientId: target, body: truncated });

    return true;
  }

  async sendAttachment(
    target: string,
    attachmentType: string,
    url: string
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('attachment_sent', {
      recipientId: target,
      type: attachmentType,
      url,
    });

    return true;
  }

  handleIncomingMessage(message: FacebookMessengerMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      senderId: message.senderId,
      text: message.message?.text,
      messageId: message.message?.mid,
      timestamp: message.timestamp,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      capabilities: {
        textMessage: true,
        attachmentMessage: true,
        quickReplies: true,
        persistentMenu: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const facebookMessengerChannel = new FacebookMessengerChannel();
