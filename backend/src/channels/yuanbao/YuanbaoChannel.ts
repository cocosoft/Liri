/**
 * YuanbaoChannel 元宝通道（Tencent 元宝/AI 平台）
 * 对标 Tencent 元宝开放平台接口
 */
import { EventEmitter } from 'node:events';

/**
 * 元宝配置
 */
export interface YuanbaoConfig {
  enabled: boolean;
  appId: string;
  appKey: string;
  botId?: string;
  apiBaseUrl: string;
  webhookSecret?: string;
  timeout: number;
}

/**
 * 元宝消息
 */
export interface YuanbaoMessage {
  fromUserId: string;
  fromNickname: string;
  content: string;
  msgType: 'text' | 'image' | 'voice' | 'file';
  msgId: string;
  groupId?: string;
  timestamp: number;
}

/**
 * 元宝通道
 */
export class YuanbaoChannel extends EventEmitter {
  private config: YuanbaoConfig;
  private connected: boolean = false;

  constructor(config?: Partial<YuanbaoConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      appId: config?.appId || '',
      appKey: config?.appKey || '',
      botId: config?.botId,
      apiBaseUrl: config?.apiBaseUrl || 'https://api.yuanbao.tencent.com',
      webhookSecret: config?.webhookSecret,
      timeout: config?.timeout || 10000,
    };
  }

  /**
   * 连接元宝 API
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (!this.config.appId || !this.config.appKey) {
      this.emit('error', new Error('缺少应用凭证'));
      return false;
    }

    this.connected = true;
    this.emit('connected', { platform: 'yuanbao' });

    return true;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'yuanbao' });
  }

  /**
   * 发送消息
   */
  async sendMessage(toUserId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', { toUserId, text, timestamp: Date.now() });

    return true;
  }

  /**
   * 发送群消息
   */
  async sendGroupMessage(groupId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', {
      groupId,
      text,
      msgType: 'group',
      timestamp: Date.now(),
    });

    return true;
  }
}
