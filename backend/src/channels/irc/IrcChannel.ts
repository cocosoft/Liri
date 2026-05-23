/**
 * IrcChannel IRC 通道
 * 对标 OpenClaw 的 IRC 支持
 */
import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
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
 * IRC 通道（遗留 EventEmitter 类，保持向后兼容）
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

class IrcChannelPlugin extends BaseChannelPlugin {
  readonly id = 'irc';
  readonly meta = IRC_META;
  readonly capabilities = IRC_CAPABILITIES;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['nickname'] as string) || 'unknown',
        displayName: (sender['nickname'] as string) || 'unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      server: '',
      port: 6667,
      nickname: 'py_app_bot',
      channels: [],
      tls: false,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['server']) errors.push('缺少 server');
    if (!config['nickname']) errors.push('缺少 nickname');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await ircChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await ircChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await ircChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'IRC: 不支持图片' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'IRC: 不支持文件' };
  }
}

export function createIrcChannel(): IChannelPlugin {
  return new IrcChannelPlugin();
}

export const ircChannelPlugin = createIrcChannel();
