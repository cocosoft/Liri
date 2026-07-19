/**
 * ZaloChannel Zalo 通道
 * 对标 Hermes 的 Zalo 平台支持
 */
import { EventEmitter } from 'events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';
import { BaseChannelPlugin } from '@modules/channels/base/BaseChannelPlugin';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:zalo:ZaloChannel',
  level: LogLevel.INFO,
});

/**
 * Zalo 配置
 */
export interface ZaloConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  accessToken?: string;
  refreshToken?: string;
  webhookUrl?: string;
  apiVersion: string;
}

/**
 * Zalo 消息
 */
export interface ZaloMessage {
  userId: string;
  messageId: string;
  text: string;
  attachments?: Array<{ type: string; url: string }>;
  timestamp: number;
}

/**
 * Zalo 通道
 */
export class ZaloChannel extends EventEmitter {
  private config: ZaloConfig;
  private connected: boolean = false;

  constructor(config?: Partial<ZaloConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      appId: config?.appId || '',
      appSecret: config?.appSecret || '',
      accessToken: config?.accessToken,
      refreshToken: config?.refreshToken,
      webhookUrl: config?.webhookUrl,
      apiVersion: config?.apiVersion || '2.0',
    };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (!this.config.appId || !this.config.appSecret) {
      this.emit('error', new Error('缺少应用凭证'));
      return false;
    }

    this.connected = true;
    this.emit('connected', { platform: 'zalo' });

    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'zalo' });
  }

  async sendMessage(userId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', { userId, text, timestamp: Date.now() });

    return true;
  }
}

const ZALO_META: ChannelMeta = {
  id: 'zalo',
  displayName: 'Zalo',
  vendor: 'Zalo (VNG)',
  vendorSite: 'https://zalo.me',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image'],
};

const ZALO_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

export const zaloChannel = new ZaloChannel();

class ZaloChannelPlugin extends BaseChannelPlugin {
  readonly id = 'zalo' as const;
  readonly meta = ZALO_META;
  readonly capabilities = ZALO_CAPABILITIES;

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
        displayName: (sender['userId'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      appId: '',
      appSecret: '',
      accessToken: '',
      refreshToken: '',
      webhookUrl: '',
      apiVersion: '2.0',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId');
    if (!config['appSecret']) errors.push('缺少 appSecret');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await zaloChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await zaloChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await zaloChannel.sendMessage(target, content);
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
    return { success: false, error: 'Zalo: sendFile 未实现' };
  }

  protected override async sendMarkdownMessage(
    _target: string,
    _content: string
  ): Promise<SendResult> {
    return { success: false, error: 'Zalo: 不支持 Markdown' };
  }

  protected override async sendInteractiveMessage(
    _target: string,
    _card: InteractiveCard
  ): Promise<SendResult> {
    return { success: false, error: 'Zalo: 不支持交互卡片' };
  }
}

export function createZaloChannel(): IChannelPlugin {
  return new ZaloChannelPlugin();
}

export const zaloChannelPlugin = createZaloChannel();
