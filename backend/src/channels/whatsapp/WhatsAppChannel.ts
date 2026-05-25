import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

export interface WhatsAppConfig {
  enabled: boolean;
  phoneNumberId?: string;
  accessToken?: string;
  verifyToken?: string;
  businessAccountId?: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'location'
    | 'interactive';
  text?: { body: string };
  image?: { id: string; mime_type: string };
}

const WHATSAPP_META: ChannelMeta = {
  id: 'whatsapp',
  displayName: 'WhatsApp',
  vendor: 'Meta',
  vendorSite: 'https://www.whatsapp.com',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'image', 'card'],
};

const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: true,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

export class WhatsAppChannel extends BaseChannelPlugin {
  private eventBus = new EventEmitter();
  private _phoneNumberId = '';
  private _accessToken = '';
  private _verifyToken = '';
  private _businessAccountId = '';

  readonly id = 'whatsapp';
  readonly meta = WHATSAPP_META;
  readonly capabilities = WHATSAPP_CAPABILITIES;

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
      businessAccountId: '',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['phoneNumberId']) errors.push('缺少 phoneNumberId');
    if (!config['accessToken']) errors.push('缺少 accessToken');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this._phoneNumberId = (config['phoneNumberId'] as string) || '';
    this._accessToken = (config['accessToken'] as string) || '';
    this._verifyToken = (config['verifyToken'] as string) || '';
    this._businessAccountId = (config['businessAccountId'] as string) || '';

    this.eventBus.emit('connected', { phoneNumberId: this._phoneNumberId });
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.eventBus.emit('message:sent', { to: target, body: content });
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
    return { success: false, error: 'WhatsApp: sendFile 未实现' };
  }

  async sendTemplateMessage(
    target: string,
    templateName: string,
    languageCode: string = 'en'
  ): Promise<boolean> {
    this.eventBus.emit('template_sent', {
      to: target,
      templateName,
      languageCode,
    });
    return true;
  }

  incomingCustomMessage(message: WhatsAppMessage): void {
    this.eventBus.emit('message_received', {
      from: message.from,
      type: message.type,
      text: message.text?.body,
      messageId: message.id,
    });
  }
}

export const whatsAppChannel = new WhatsAppChannel();

export function createWhatsAppChannel(): IChannelPlugin {
  return whatsAppChannel;
}

export const whatsAppChannelPlugin = whatsAppChannel;
