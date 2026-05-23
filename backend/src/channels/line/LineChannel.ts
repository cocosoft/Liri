import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

export interface LineConfig {
  enabled: boolean;
  channelAccessToken?: string;
  channelSecret?: string;
}

export interface LineMessage {
  userId: string;
  groupId?: string;
  text: string;
  messageId: string;
  timestamp: number;
}

const LINE_META: ChannelMeta = {
  id: 'line',
  displayName: 'LINE',
  vendor: 'LINE Corporation',
  vendorSite: 'https://line.me',
  icon: 'line',
  markdownCapable: false,
  maxMessageLength: 5000,
  supportedMessageTypes: ['text', 'image', 'file'],
};

const LINE_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export class LineChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _channelAccessToken = '';
  private _channelSecret = '';

  readonly id = 'line';
  readonly meta = LINE_META;
  readonly capabilities = LINE_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return { channelAccessToken: '', channelSecret: '' };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['channelAccessToken']) errors.push('缺少 channelAccessToken');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._channelAccessToken = (config['channelAccessToken'] as string) || '';
    this._channelSecret = (config['channelSecret'] as string) || '';

    this.eventBus.emit('connected', {});
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', {
      to: target,
      text: content,
      timestamp: Date.now(),
    });
    return { success: true };
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'LINE: sendImage 未实现' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'LINE: sendFile 未实现' };
  }

  async sendReply(replyToken: string, text: string): Promise<boolean> {
    this.eventBus.emit('message:sent', {
      replyToken,
      text,
      timestamp: Date.now(),
    });
    return true;
  }
}

export const lineChannel = new LineChannel();

export function createLineChannel(): IChannelPlugin {
  return lineChannel;
}

export const lineChannelPlugin = lineChannel;
