import {
  BasePlatformAdapter,
  PLATFORM_MESSAGE_FORMATS,
  type PlatformType,
} from './BasePlatformAdapter';

export interface QQConfig {
  enabled: boolean;
  appId?: string;
  token?: string;
  secret?: string;
  sandbox: boolean;
}

export interface QQMessage {
  id: string;
  author: { id: string; username?: string; avatar?: string };
  content: string;
  channelId: string;
  guildId?: string;
  timestamp: number;
}

export class QQChannel extends BasePlatformAdapter {
  private lastMessage: QQMessage | null = null;

  constructor(config?: Partial<QQConfig>) {
    super('qq' as PlatformType, {
      enabled: config?.enabled ?? false,
      appId: config?.appId,
      token: config?.token,
      secret: config?.secret,
      sandbox: config?.sandbox ?? true,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as QQConfig;
    if (!cfg.enabled) return false;
    if (!cfg.appId || !cfg.token) return false;

    this.connected = true;
    this.emitEvent('connected', { appId: cfg.appId, sandbox: cfg.sandbox });

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
      channelId: target,
      content: truncated,
    });

    return true;
  }

  async sendImageMessage(
    target: string,
    imageUrl: string,
    fileType: 1 | 2 | 3 = 1
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('image_sent', {
      channelId: target,
      imageUrl,
      fileType,
    });

    return true;
  }

  handleIncomingMessage(message: QQMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      authorId: message.author.id,
      username: message.author.username,
      content: message.content,
      channelId: message.channelId,
      guildId: message.guildId,
      messageId: message.id,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      format: PLATFORM_MESSAGE_FORMATS[this.platform],
      capabilities: {
        textMessage: true,
        imageMessage: true,
        groupMessage: true,
        guildMessage: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const qqChannel = new QQChannel();
