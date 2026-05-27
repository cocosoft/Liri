import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
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

export class TwitterChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _apiKey = '';
  private _apiSecretKey = '';
  private _bearerToken = '';

  readonly id = 'twitter';
  readonly meta = TWITTER_META;
  readonly capabilities = TWITTER_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      apiKey: '',
      apiSecretKey: '',
      accessToken: '',
      accessTokenSecret: '',
      bearerToken: '',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['apiKey']) errors.push('缺少 apiKey');
    if (!config['apiSecretKey']) errors.push('缺少 apiSecretKey');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._apiKey = (config['apiKey'] as string) || '';
    this._apiSecretKey = (config['apiSecretKey'] as string) || '';
    this._bearerToken = (config['bearerToken'] as string) || '';

    this.eventBus.emit('connected', {});
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      const resp = await fetch(
        `https://api.twitter.com/2/dm_conversations/with/${target}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._bearerToken}`,
          },
          body: JSON.stringify({ text: content }),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `Twitter API 错误: ${err}` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, `[图片] ${imageUrl}`);
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return {
      success: false,
      error: 'Twitter: sendFile 未实现（Twitter API 不支持 DM 文件发送）',
    };
  }

  async sendTweet(content: string): Promise<boolean> {
    try {
      const resp = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._bearerToken}`,
        },
        body: JSON.stringify({ text: content }),
      });
      if (!resp.ok) {
        this.logger.warn(`Twitter sendTweet API 错误: ${await resp.text()}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`Twitter sendTweet 失败: ${e}`);
      return false;
    }
  }

  async replyToTweet(tweetId: string, content: string): Promise<boolean> {
    try {
      const resp = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._bearerToken}`,
        },
        body: JSON.stringify({
          text: content,
          reply: { in_reply_to_tweet_id: tweetId },
        }),
      });
      if (!resp.ok) {
        this.logger.warn(`Twitter reply API 错误: ${await resp.text()}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`Twitter reply 失败: ${e}`);
      return false;
    }
  }

  incomingCustomMessage(message: TwitterMessage): void {
    this.eventBus.emit('message_received', {
      id: message.id,
      text: message.text,
      authorId: message.authorId,
      authorName: message.authorName,
      conversationId: message.conversationId,
    });
  }
}

export const twitterChannel = new TwitterChannel();

export function createTwitterChannel(): IChannelPlugin {
  return twitterChannel;
}

export const twitterChannelPlugin = twitterChannel;
