/**
 * IrcChannel IRC 通道
 * 对标 OpenClaw 的 IRC 支持
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
 * IRC 配置
 */
export interface IrcConfig {
  enabled: boolean;
  server: string;
  port: number;
  nickname: string;
  username?: string;
  realname?: string;
  password?: string;
  channels: string[];
  tls: boolean;
}

/**
 * IRC 消息
 */
export interface IrcMessage {
  nickname: string;
  username: string;
  hostname: string;
  target: string;
  text: string;
  channel: string;
  timestamp: number;
}

/**
 * IRC 通道
 */
export class IrcChannel extends EventEmitter {
  private config: IrcConfig;
  private connected: boolean = false;

  constructor(config?: Partial<IrcConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      server: config?.server || '',
      port: config?.port || 6667,
      nickname: config?.nickname || 'py_app_bot',
      username: config?.username,
      realname: config?.realname,
      password: config?.password,
      channels: config?.channels || [],
      tls: config?.tls || false,
    };
  }

  /**
   * 连接到 IRC 服务器
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled || !this.config.server) return false;

    this.connected = true;

    this.emit('connected', { server: this.config.server });

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
  async sendMessage(target: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { target, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 加入频道
   */
  async join(channel: string): Promise<boolean> {
    if (!this.connected) return false;

    if (!this.config.channels.includes(channel)) {
      this.config.channels.push(channel);
    }

    return true;
  }

  /**
   * 离开频道
   */
  async part(channel: string): Promise<boolean> {
    if (!this.connected) return false;

    this.config.channels = this.config.channels.filter((c) => c !== channel);

    return true;
  }

  /**
   * 获取状态
   */
  getStatus(): { connected: boolean; server: string; channels: string[] } {
    return {
      connected: this.connected,
      server: this.config.server,
      channels: [...this.config.channels],
    };
  }

  /**
   * 获取配置
   */
  getConfig(): IrcConfig {
    return { ...this.config };
  }
}

export const ircChannel = new IrcChannel();

const IRC_META: ChannelMeta = {
  id: 'irc',
  displayName: 'IRC',
  vendor: 'IRC',
  vendorSite: 'https://ircv3.net',
  icon: 'irc',
  markdownCapable: false,
  maxMessageLength: 512,
  supportedMessageTypes: ['text'],
};

const IRC_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: false,
};

export function createIrcChannel(): IChannelPlugin {
  return {
    id: 'irc',
    meta: IRC_META,
    capabilities: IRC_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['server']) errors.push('缺少 server');
        if (!c['nickname']) errors.push('缺少 nickname');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          server: '',
          port: 6667,
          nickname: 'py_app_bot',
          channels: [],
          tls: false,
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await ircChannel.connect();
      },
      async disconnect(): Promise<void> {
        await ircChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: ircChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: ircChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await ircChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(
        _target: string,
        _content: string
      ): Promise<SendResult> {
        return { success: false, error: 'IRC: 不支持 Markdown' };
      },
      async sendImage(_target: string, _imageUrl: string): Promise<SendResult> {
        return { success: false, error: 'IRC: 不支持图片' };
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'IRC: 不支持文件' };
      },
      async sendInteractive(
        _target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'IRC: 不支持交互卡片' };
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
          userId: (sender['nickname'] as string) || 'unknown',
          displayName: (sender['nickname'] as string) || 'unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const ircChannelPlugin = createIrcChannel();
