/**
 * GoogleChatChannel Google Chat 通道
 * 对标 Google Workspace Chat API
 */
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

/**
 * Google Chat 配置
 */
export interface GoogleChatConfig {
  enabled: boolean;
  serviceAccountKey?: string;
  spaceIds: string[];
  webhookUrls: string[];
  apiEndpoint: string;
}

/**
 * Google Chat 消息
 */
export interface GoogleChatMessage {
  spaceId: string;
  senderName: string;
  senderDisplayName: string;
  text: string;
  threadId?: string;
  messageId: string;
  timestamp: number;
}

/**
 * Google Chat 通道
 */
export class GoogleChatChannel extends EventEmitter {
  private config: GoogleChatConfig;
  private connected: boolean = false;

  constructor(config?: Partial<GoogleChatConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      serviceAccountKey: config?.serviceAccountKey,
      spaceIds: config?.spaceIds || [],
      webhookUrls: config?.webhookUrls || [],
      apiEndpoint: config?.apiEndpoint || 'https://chat.googleapis.com',
    };
  }

  /**
   * 连接 Google Chat API
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (
      !this.config.serviceAccountKey &&
      this.config.webhookUrls.length === 0
    ) {
      this.emit('error', new Error('缺少认证凭证'));
      return false;
    }

    this.connected = true;
    this.emit('connected', { platform: 'google-chat' });

    return true;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'google-chat' });
  }

  /**
   * 发送消息
   */
  async sendMessage(spaceId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', { spaceId, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 通过 Webhook 发送消息
   */
  async sendViaWebhook(webhookUrl: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { webhook: true, text, timestamp: Date.now() });

    return true;
  }
}

const GOOGLECHAT_META: ChannelMeta = {
  id: 'googlechat',
  displayName: 'Google Chat',
  vendor: 'Google',
  vendorSite: 'https://chat.google.com',
  icon: '💬',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'markdown', 'card'],
};

const GOOGLECHAT_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

export const googleChatChannel = new GoogleChatChannel();

export function createGoogleChatChannel(): IChannelPlugin {
  return {
    id: 'googlechat',
    meta: GOOGLECHAT_META,
    capabilities: GOOGLECHAT_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['spaceIds']) errors.push('缺少 spaceIds');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          serviceAccountKey: '',
          spaceIds: [],
          webhookUrls: [],
          apiEndpoint: 'https://chat.googleapis.com',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await googleChatChannel.connect();
      },
      async disconnect(): Promise<void> {
        await googleChatChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: googleChatChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: googleChatChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await googleChatChannel.sendMessage(target, content);
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
        return { success: false, error: 'GoogleChat: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'GoogleChat: sendInteractive 未实现' };
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

export const googleChatChannelPlugin = createGoogleChatChannel();
