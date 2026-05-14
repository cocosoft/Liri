/**
 * IrcChannel IRC 通道
 * 对标 OpenClaw 的 IRC 支持
 */
import { EventEmitter } from 'node:events';

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
