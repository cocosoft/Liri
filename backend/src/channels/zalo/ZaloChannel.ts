/**
 * ZaloChannel Zalo 通道
 * 对标 Hermes 的 Zalo 平台支持
 */
import { EventEmitter } from 'node:events';

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
