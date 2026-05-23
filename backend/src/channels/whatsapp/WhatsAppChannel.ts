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

export class WhatsAppChannel extends EventEmitter {
  private config: WhatsAppConfig;
  private connected: boolean = false;

  constructor(config?: Partial<WhatsAppConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? false,
      phoneNumberId: config?.phoneNumberId,
      accessToken: config?.accessToken,
      verifyToken: config?.verifyToken,
      businessAccountId: config?.businessAccountId,
    };
  }

  async connect(): Promise<boolean> {
    if (
      !this.config.enabled ||
      !this.config.phoneNumberId ||
      !this.config.accessToken
    )
      return false;

    this.connected = true;
    this.emit('connected', { phoneNumberId: this.config.phoneNumberId });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { to: target, body: content });

    return true;
  }

  async sendTemplateMessage(
    target: string,
    templateName: string,
    languageCode: string = 'en'
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('template_sent', { to: target, templateName, languageCode });

    return true;
  }

  handleIncomingMessage(message: WhatsAppMessage): void {
    this.emit('message_received', {
      from: message.from,
      type: message.type,
      text: message.text?.body,
      messageId: message.id,
    });
  }
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

export const whatsAppChannel = new WhatsAppChannel();

export function createWhatsAppChannel(): IChannelPlugin {
  return {
    id: 'whatsapp',
    meta: WHATSAPP_META,
    capabilities: WHATSAPP_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['phoneNumberId']) errors.push('缺少 phoneNumberId');
        if (!c['accessToken']) errors.push('缺少 accessToken');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          phoneNumberId: '',
          accessToken: '',
          verifyToken: '',
          businessAccountId: '',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await whatsAppChannel.connect();
      },
      async disconnect(): Promise<void> {
        await whatsAppChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: whatsAppChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: whatsAppChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await whatsAppChannel.sendMessage(target, content);
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
        return { success: false, error: 'WhatsApp: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'WhatsApp: sendInteractive 未实现' };
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
          displayName: (sender['senderName'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const whatsAppChannelPlugin = createWhatsAppChannel();
