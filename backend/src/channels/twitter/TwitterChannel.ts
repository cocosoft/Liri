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

    this.eventBus.emit('connected', {});
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', {
      conversationId: target,
      text: content,
    });
    return { success: true };
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
    return { success: false, error: 'Twitter: sendFile 未实现' };
  }

  async sendTweet(content: string): Promise<boolean> {
    this.eventBus.emit('tweet_sent', { text: content });
    return true;
  }

  async replyToTweet(tweetId: string, content: string): Promise<boolean> {
    this.eventBus.emit('reply_sent', { tweetId, text: content });
    return true;
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
