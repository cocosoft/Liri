import { EventEmitter } from 'events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('channels:facebookmessenger:FacebookMessengerChannel');

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
    try {
      const url = new URL('https://graph.facebook.com/v21.0/me/messages');
      url.searchParams.set('access_token', this._pageAccessToken);
      const resp = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: target },
          messaging_type: 'UPDATE',
          message: { text: content },
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `Facebook API 错误: ${err}` };
      }
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:facebookmessenger',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    try {
      const url = new URL('https://graph.facebook.com/v21.0/me/messages');
      url.searchParams.set('access_token', this._pageAccessToken);
      const resp = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: target },
          messaging_type: 'UPDATE',
          message: {
            attachment: {
              type: 'image',
              payload: { url: imageUrl, is_reusable: true },
            },
          },
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `Facebook API 错误: ${err}` };
      }
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:facebookmessenger',
        action: 'sendImageMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    try {
      const url = new URL('https://graph.facebook.com/v21.0/me/messages');
      url.searchParams.set('access_token', this._pageAccessToken);
      const resp = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: target },
          messaging_type: 'UPDATE',
          message: {
            attachment: {
              type: 'file',
              payload: { url: filePath, is_reusable: false },
            },
          },
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `Facebook API 错误: ${err}` };
      }
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:facebookmessenger',
        action: 'sendFileMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  async sendAttachment(
    target: string,
    attachmentType: string,
    url: string
  ): Promise<boolean> {
    try {
      const apiUrl = new URL('https://graph.facebook.com/v21.0/me/messages');
      apiUrl.searchParams.set('access_token', this._pageAccessToken);
      const resp = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: target },
          messaging_type: 'UPDATE',
          message: {
            attachment: {
              type: attachmentType,
              payload: { url, is_reusable: true },
            },
          },
        }),
      });
      if (!resp.ok) {
        this.logger.warn(
          `Facebook sendAttachment API 错误: ${await resp.text()}`
        );
        return false;
      }
      return true;
    } catch (e) {
      await handleError(e, {
        module: 'channels:facebookmessenger',
        action: 'sendAttachment',
        context: { target },
      });
      this.logger.warn(`Facebook sendAttachment 失败: ${e}`);
      return false;
    }
  }

  incomingCustomMessage(message: FacebookMessengerMessage): void {
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
