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

export class FacebookMessengerChannel extends EventEmitter {
  private config: FacebookMessengerConfig;
  private connected: boolean = false;

  constructor(config?: Partial<FacebookMessengerConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? false,
      pageAccessToken: config?.pageAccessToken,
      verifyToken: config?.verifyToken,
      appSecret: config?.appSecret,
      pageId: config?.pageId,
    };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.pageAccessToken) return false;

    this.connected = true;
    this.emit('connected', { pageId: this.config.pageId });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  async sendMessage(target: string, content: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { recipientId: target, body: content });

    return true;
  }

  async sendAttachment(
    target: string,
    attachmentType: string,
    url: string
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('attachment_sent', {
      recipientId: target,
      type: attachmentType,
      url,
    });

    return true;
  }

  handleIncomingMessage(message: FacebookMessengerMessage): void {
    this.emit('message_received', {
      senderId: message.senderId,
      text: message.message?.text,
      messageId: message.message?.mid,
      timestamp: message.timestamp,
    });
  }
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

export const facebookMessengerChannel = new FacebookMessengerChannel();

export function createFacebookMessengerChannel(): IChannelPlugin {
  return {
    id: 'facebook',
    meta: FACEBOOK_META,
    capabilities: FACEBOOK_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['pageAccessToken']) errors.push('缺少 pageAccessToken');
        if (!c['verifyToken']) errors.push('缺少 verifyToken');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          pageAccessToken: '',
          verifyToken: '',
          appSecret: '',
          pageId: '',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await facebookMessengerChannel.connect();
      },
      async disconnect(): Promise<void> {
        await facebookMessengerChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: facebookMessengerChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: facebookMessengerChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await facebookMessengerChannel.sendMessage(target, content);
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
        return { success: false, error: 'FacebookMessenger: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return {
          success: false,
          error: 'FacebookMessenger: sendInteractive 未实现',
        };
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

export const facebookMessengerChannelPlugin = createFacebookMessengerChannel();
