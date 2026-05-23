/**
 * SlackChannel Slack 通道
 * 对标 OpenClaw 的 Slack 支持
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
 * Slack 配置
 */
export interface SlackConfig {
  enabled: boolean;
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  channels: string[];
}

/**
 * Slack 消息
 */
export interface SlackMessage {
  user: string;
  channel: string;
  text: string;
  ts: string;
  threadTs?: string;
  timestamp: number;
}

/**
 * Slack 通道
 */
export class SlackChannel extends EventEmitter {
  private config: SlackConfig;
  private connected: boolean = false;

  constructor(config?: Partial<SlackConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      botToken: config?.botToken,
      appToken: config?.appToken,
      signingSecret: config?.signingSecret,
      channels: config?.channels || [],
    };
  }

  /**
   * 连接
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.botToken) return false;

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
  async sendMessage(channel: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { channel, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 发送回复
   */
  async sendReply(
    channel: string,
    threadTs: string,
    text: string
  ): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', {
      channel,
      threadTs,
      text,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 获取状态
   */
  getStatus(): { connected: boolean; channels: string[] } {
    return { connected: this.connected, channels: [...this.config.channels] };
  }
}

export const slackChannel = new SlackChannel();

const SLACK_META: ChannelMeta = {
  id: 'slack',
  displayName: 'Slack',
  vendor: 'Slack',
  vendorSite: 'https://slack.com',
  icon: 'slack',
  markdownCapable: true,
  maxMessageLength: 40000,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
};

const SLACK_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

export function createSlackChannel(): IChannelPlugin {
  return {
    id: 'slack',
    meta: SLACK_META,
    capabilities: SLACK_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['botToken']) errors.push('缺少 botToken');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { botToken: '', appToken: '', signingSecret: '', channels: [] };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        const cfg = { botToken: process.env.SLACK_BOT_TOKEN };
        await slackChannel.connect();
      },
      async disconnect(): Promise<void> {
        await slackChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: slackChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: slackChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await slackChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },
      async sendImage(target: string, _imageUrl: string): Promise<SendResult> {
        return { success: false, error: 'Slack: sendImage 未实现' };
      },
      async sendFile(target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Slack: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Slack: sendInteractive 未实现' };
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
          userId: (sender['user'] as string) || 'unknown',
          displayName: (sender['user'] as string) || 'unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const slackChannelPlugin = createSlackChannel();
