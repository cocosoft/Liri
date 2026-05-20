import { BasePlatformAdapter, type PlatformType } from './BasePlatformAdapter';

export interface TwitterConfig {
  enabled: boolean;
  apiKey?: string;
  apiSecretKey?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  bearerToken?: string;
}

export interface TwitterMessage {
  id: string;
  text: string;
  authorId: string;
  authorName?: string;
  authorUsername?: string;
  createdAt: string;
  conversationId?: string;
  inReplyToUserId?: string;
}

export class TwitterChannel extends BasePlatformAdapter {
  private lastMessage: TwitterMessage | null = null;

  constructor(config?: Partial<TwitterConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      apiKey: config?.apiKey,
      apiSecretKey: config?.apiSecretKey,
      accessToken: config?.accessToken,
      accessTokenSecret: config?.accessTokenSecret,
      bearerToken: config?.bearerToken,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as TwitterConfig;
    if (!cfg.enabled) return false;

    this.connected = true;
    this.emitEvent('connected', {});

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
      text: truncated,
    });

    return true;
  }

  async sendTweet(content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('tweet_sent', { text: truncated });

    return true;
  }

  async replyToTweet(tweetId: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('reply_sent', {
      tweetId,
      text: truncated,
    });

    return true;
  }

  handleIncomingMessage(message: TwitterMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      id: message.id,
      text: message.text,
      authorId: message.authorId,
      authorName: message.authorName,
      conversationId: message.conversationId,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      capabilities: {
        textMessage: true,
        tweet: true,
        reply: true,
        directMessage: true,
        mediaUpload: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const twitterChannel = new TwitterChannel();
