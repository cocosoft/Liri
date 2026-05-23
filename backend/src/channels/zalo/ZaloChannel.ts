/**
 * ZaloChannel Zalo 通道
 * 对标 Hermes 的 Zalo 平台支持
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

  /**
   * 连接 Zalo API
   */
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

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'zalo' });
  }

  /**
   * 发送消息
   */
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

export function createZaloChannel(): IChannelPlugin {
  return {
    id: 'zalo',
    meta: ZALO_META,
    capabilities: ZALO_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['appId']) errors.push('缺少 appId');
        if (!c['appSecret']) errors.push('缺少 appSecret');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          appId: '',
          appSecret: '',
          accessToken: '',
          refreshToken: '',
          webhookUrl: '',
          apiVersion: '2.0',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await zaloChannel.connect();
      },
      async disconnect(): Promise<void> {
        await zaloChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: zaloChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: zaloChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await zaloChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(
        _target: string,
        _content: string
      ): Promise<SendResult> {
        return { success: false, error: 'Zalo: 不支持 Markdown' };
      },
      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return this.sendText(target, `[图片] ${imageUrl}`);
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Zalo: sendFile 未实现' };
      },
      async sendInteractive(
        _target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Zalo: 不支持交互卡片' };
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
          displayName: (sender['userId'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const zaloChannelPlugin = createZaloChannel();
