import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';

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

export class TwitterChannel extends EventEmitter {
  private config: TwitterConfig;
  private connected: boolean = false;

  constructor(config?: Partial<TwitterConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? false,
      apiKey: config?.apiKey,
      apiSecretKey: config?.apiSecretKey,
      accessToken: config?.accessToken,
      accessTokenSecret: config?.accessTokenSecret,
      bearerToken: config?.bearerToken,
    };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;

    this.connected = true;
    this.emit('connected', {});

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { conversationId: target, text: content });

    return true;
  }

  async sendTweet(content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('tweet_sent', { text: content });

    return true;
  }

  async replyToTweet(tweetId: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('reply_sent', { tweetId, text: content });

    return true;
  }

  handleIncomingMessage(message: TwitterMessage): void {
    this.emit('message_received', {
      id: message.id,
      text: message.text,
      authorId: message.authorId,
      authorName: message.authorName,
      conversationId: message.conversationId,
    });
  }
}

const TWITTER_META: ChannelMeta = {
  id: 'twitter',
  displayName: 'Twitter',
  vendor: 'X Corp.',
  vendorSite: 'https://x.com',
  icon: '🐦',
  markdownCapable: false,
  maxMessageLength: 280,
  supportedMessageTypes: ['text', 'image'],
};

const TWITTER_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export const twitterChannel = new TwitterChannel();

export function createTwitterChannel(): IChannelPlugin {
  return {
    id: 'twitter',
    meta: TWITTER_META,
    capabilities: TWITTER_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['apiKey']) errors.push('缺少 apiKey');
        if (!c['apiSecretKey']) errors.push('缺少 apiSecretKey');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          apiKey: '',
          apiSecretKey: '',
          accessToken: '',
          accessTokenSecret: '',
          bearerToken: '',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await twitterChannel.connect();
      },
      async disconnect(): Promise<void> {
        await twitterChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: twitterChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: twitterChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await twitterChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },
      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return this.sendText(target, `[图片] ${imageUrl}`);
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Twitter: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Twitter: sendInteractive 未实现' };
      },
    },

    security: {
      dmPolicy: 'open',
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 3,
      async resolveSender(
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> {
        return {
          userId: (sender['userId'] as string) || 'unknown',
          displayName: (sender['authorName'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const twitterChannelPlugin = createTwitterChannel();
