import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

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

const FACEBOOK_META: ChannelMeta = {
  id: 'facebook',
  displayName: 'Facebook Messenger',
  vendor: 'Meta',
  vendorSite: 'https://www.messenger.com',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 2000,
  supportedMessageTypes: ['text', 'image', 'file'],
};

const FACEBOOK_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: true,
  reactions: true,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

export class FacebookMessengerChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _pageAccessToken = '';
  private _verifyToken = '';
  private _appSecret = '';
  private _pageId = '';

  readonly id = 'facebook';
  readonly meta = FACEBOOK_META;
  readonly capabilities = FACEBOOK_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      pageAccessToken: '',
      verifyToken: '',
      appSecret: '',
      pageId: '',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['pageAccessToken']) errors.push('缺少 pageAccessToken');
    if (!config['verifyToken']) errors.push('缺少 verifyToken');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._pageAccessToken = (config['pageAccessToken'] as string) || '';
    this._verifyToken = (config['verifyToken'] as string) || '';
    this._appSecret = (config['appSecret'] as string) || '';
    this._pageId = (config['pageId'] as string) || '';

    this.eventBus.emit('connected', { pageId: this._pageId });
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', { recipientId: target, body: content });
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
    return { success: false, error: 'FacebookMessenger: sendFile 未实现' };
  }

  async sendAttachment(
    target: string,
    attachmentType: string,
    url: string
  ): Promise<boolean> {
    this.eventBus.emit('attachment_sent', {
      recipientId: target,
      type: attachmentType,
      url,
    });
    return true;
  }

  handleIncomingMessage(message: FacebookMessengerMessage): void {
    this.eventBus.emit('message_received', {
      senderId: message.senderId,
      text: message.message?.text,
      messageId: message.message?.mid,
      timestamp: message.timestamp,
    });
  }
}

export const facebookMessengerChannel = new FacebookMessengerChannel();

export function createFacebookMessengerChannel(): IChannelPlugin {
  return facebookMessengerChannel;
}

export const facebookMessengerChannelPlugin = facebookMessengerChannel;
