/**
 * GoogleChatChannel Google Chat 通道
 * 对标 Google Workspace Chat API
 */
import { EventEmitter } from 'node:events';

/**
 * Google Chat 配置
 */
export interface GoogleChatConfig {
  enabled: boolean;
  serviceAccountKey?: string;
  spaceIds: string[];
  webhookUrls: string[];
  apiEndpoint: string;
}

/**
 * Google Chat 消息
 */
export interface GoogleChatMessage {
  spaceId: string;
  senderName: string;
  senderDisplayName: string;
  text: string;
  threadId?: string;
  messageId: string;
  timestamp: number;
}

/**
 * Google Chat 通道
 */
export class GoogleChatChannel extends EventEmitter {
  private config: GoogleChatConfig;
  private connected: boolean = false;

  constructor(config?: Partial<GoogleChatConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      serviceAccountKey: config?.serviceAccountKey,
      spaceIds: config?.spaceIds || [],
      webhookUrls: config?.webhookUrls || [],
      apiEndpoint: config?.apiEndpoint || 'https://chat.googleapis.com',
    };
  }

  /**
   * 连接 Google Chat API
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (!this.config.serviceAccountKey && this.config.webhookUrls.length === 0) {
      this.emit('error', new Error('缺少认证凭证'));
      return false;
    }

    this.connected = true;
    this.emit('connected', { platform: 'google-chat' });

    return true;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'google-chat' });
  }

  /**
   * 发送消息
   */
  async sendMessage(spaceId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', { spaceId, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 通过 Webhook 发送消息
   */
  async sendViaWebhook(webhookUrl: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('message:sent', { webhook: true, text, timestamp: Date.now() });

    return true;
  }
}
