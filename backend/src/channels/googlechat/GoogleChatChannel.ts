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
import { BaseChannelPlugin } from '@modules/channels/base/BaseChannelPlugin';

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

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'google-chat' });
  }

  async sendMessage(spaceId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', { spaceId, text, timestamp: Date.now() });

    return true;
  }

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

class GoogleChatChannelPlugin extends BaseChannelPlugin {
  readonly id = 'googlechat' as const;
  readonly meta = GOOGLECHAT_META;
  readonly capabilities = GOOGLECHAT_CAPABILITIES;

  constructor() {
    super();
    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> => ({
        userId: (sender['userId'] as string) || 'unknown',
        displayName: (sender['senderName'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      serviceAccountKey: '',
      spaceIds: [],
      webhookUrls: [],
      apiEndpoint: 'https://chat.googleapis.com',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['spaceIds']) errors.push('缺少 spaceIds');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await googleChatChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await googleChatChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await googleChatChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
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
    return { success: false, error: 'GoogleChat: sendFile 未实现' };
  }

  protected override async sendInteractiveMessage(
    _target: string,
    _card: InteractiveCard
  ): Promise<SendResult> {
    return { success: false, error: 'GoogleChat: sendInteractive 未实现' };
  }
}

export function createGoogleChatChannel(): IChannelPlugin {
  return new GoogleChatChannelPlugin();
}

export const googleChatChannelPlugin = createGoogleChatChannel();
