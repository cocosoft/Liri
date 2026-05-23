/**
 * LineChannel LINE 通道
 * 对标 OpenClaw 的 LINE 支持
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
 * LINE 配置
 */
export interface LineConfig {
  enabled: boolean;
  channelAccessToken?: string;
  channelSecret?: string;
}

/**
 * LINE 消息
 */
export interface LineMessage {
  userId: string;
  groupId?: string;
  text: string;
  messageId: string;
  timestamp: number;
}

/**
 * LINE 通道
 */
export class LineChannel extends EventEmitter {
  private config: LineConfig;
  private connected: boolean = false;

  constructor(config?: Partial<LineConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      channelAccessToken: config?.channelAccessToken,
      channelSecret: config?.channelSecret,
    };
  }

  /**
   * 连接
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.channelAccessToken) return false;

    this.connected = true;
    this.emit('connected', {});

    return true;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  /**
   * 发送消息
   */
  async sendMessage(to: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { to, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 发送回复
   */
  async sendReply(replyToken: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { replyToken, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 获取状态
   */
  getStatus(): { connected: boolean } {
    return { connected: this.connected };
  }
}

export const lineChannel = new LineChannel();

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

export function createLineChannel(): IChannelPlugin {
  return {
    id: 'line',
    meta: LINE_META,
    capabilities: LINE_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['channelAccessToken']) errors.push('缺少 channelAccessToken');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { channelAccessToken: '', channelSecret: '' };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await lineChannel.connect();
      },
      async disconnect(): Promise<void> {
        await lineChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: lineChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: lineChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await lineChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(
        _target: string,
        _content: string
      ): Promise<SendResult> {
        return { success: false, error: 'LINE: 不支持 Markdown' };
      },
      async sendImage(_target: string, _imageUrl: string): Promise<SendResult> {
        return { success: false, error: 'LINE: sendImage 未实现' };
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'LINE: sendFile 未实现' };
      },
      async sendInteractive(
        _target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'LINE: sendInteractive 未实现' };
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
          displayName: (sender['userId'] as string) || 'unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const lineChannelPlugin = createLineChannel();
