/**
 * SlackChannel Slack 通道
 * 对标 OpenClaw 的 Slack 支持
 */
import { EventEmitter } from 'node:events';

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
  async sendReply(channel: string, threadTs: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { channel, threadTs, text, timestamp: Date.now() });

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
