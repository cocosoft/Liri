import { EventEmitter } from 'events';
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
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${this._phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: target,
            type: 'text',
            text: { body: content },
          }),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `WhatsApp API 错误: ${err}` };
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
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${this._phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: target,
            type: 'image',
            image: { link: imageUrl },
          }),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `WhatsApp API 错误: ${err}` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    try {
      const fileName = filePath.split('/').pop() || 'file';
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${this._phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: target,
            type: 'document',
            document: { link: filePath, filename: fileName },
          }),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        return { success: false, error: `WhatsApp API 错误: ${err}` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async sendTemplateMessage(
    target: string,
    templateName: string,
    languageCode: string = 'en'
  ): Promise<boolean> {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${this._phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: target,
            type: 'template',
            template: {
              name: templateName,
              language: { code: languageCode },
            },
          }),
        }
      );
      if (!resp.ok) {
        this.logger.warn(`WhatsApp template API 错误: ${await resp.text()}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`WhatsApp template 失败: ${e}`);
      return false;
    }
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
