/**
 * LineChannel LINE 通道
 * 对标 OpenClaw 的 LINE 支持
 */
import { EventEmitter } from 'node:events';

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
