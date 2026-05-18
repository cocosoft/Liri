import { BasePlatformAdapter, type PlatformType } from './BasePlatformAdapter';

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

export class WhatsAppChannel extends BasePlatformAdapter {
  private lastMessage: WhatsAppMessage | null = null;

  constructor(config?: Partial<WhatsAppConfig>) {
    super('wechat' as PlatformType, {
      enabled: config?.enabled ?? false,
      phoneNumberId: config?.phoneNumberId,
      accessToken: config?.accessToken,
      verifyToken: config?.verifyToken,
      businessAccountId: config?.businessAccountId,
    });
  }

  async connect(): Promise<boolean> {
    const cfg = this._config as unknown as WhatsAppConfig;
    if (!cfg.enabled || !cfg.phoneNumberId || !cfg.accessToken) return false;

    this.connected = true;
    this.emitEvent('connected', { phoneNumberId: cfg.phoneNumberId });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    const truncated = this.truncateMessage(content);

    this.emitEvent('message_sent', { to: target, body: truncated });

    return true;
  }

  async sendTemplateMessage(
    target: string,
    templateName: string,
    languageCode: string = 'en'
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emitEvent('template_sent', {
      to: target,
      templateName,
      languageCode,
    });

    return true;
  }

  handleIncomingMessage(message: WhatsAppMessage): void {
    this.lastMessage = message;
    this.emitEvent('message_received', {
      from: message.from,
      type: message.type,
      text: message.text?.body,
      messageId: message.id,
    });
  }

  getStatus(): Record<string, unknown> {
    return {
      connected: this.connected,
      platform: this.platform,
      capabilities: {
        textMessage: true,
        templateMessage: true,
        mediaMessage: true,
        interactiveMessage: true,
      },
      lastMessage: this.lastMessage,
    };
  }
}

export const whatsappChannel = new WhatsAppChannel();
