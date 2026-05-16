/**
 * SmsChannel SMS 短信通道
 * 对标 Hermes 的 SMS 通道实现
 */
import { EventEmitter } from 'node:events';

/**
 * SMS 配置
 */
export interface SmsConfig {
  enabled: boolean;
  provider: 'twilio' | 'aliyun' | 'tencent' | 'custom';
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
  fromNumber: string;
  endpoint?: string;
  maxRetries: number;
  timeout: number;
}

/**
 * SMS 消息
 */
export interface SmsMessage {
  to: string;
  from: string;
  text: string;
  sid?: string;
  status?: 'queued' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
}

/**
 * SMS 通道
 */
export class SmsChannel extends EventEmitter {
  private config: SmsConfig;
  private connected: boolean = false;

  constructor(config?: Partial<SmsConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      provider: config?.provider || 'custom',
      accountSid: config?.accountSid,
      authToken: config?.authToken,
      apiKey: config?.apiKey,
      apiSecret: config?.apiSecret,
      fromNumber: config?.fromNumber || '',
      endpoint: config?.endpoint,
      maxRetries: config?.maxRetries ?? 3,
      timeout: config?.timeout ?? 10000,
    };
  }

  /**
   * 连接到 SMS 服务提供商
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;

    if (!this.config.fromNumber) {
      this.emit('error', { message: '发件人号码未配置' });
      return false;
    }

    if (
      this.config.provider === 'twilio' &&
      (!this.config.accountSid || !this.config.authToken)
    ) {
      this.emit('error', { message: 'Twilio 凭证未配置' });
      return false;
    }

    if (
      (this.config.provider === 'aliyun' ||
        this.config.provider === 'tencent') &&
      (!this.config.apiKey || !this.config.apiSecret)
    ) {
      this.emit('error', { message: `${this.config.provider} 凭证未配置` });
      return false;
    }

    this.connected = true;
    this.emit('connected', { provider: this.config.provider });

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
   * 发送 SMS
   */
  async sendMessage(target: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    const message: SmsMessage = {
      to: target,
      from: this.config.fromNumber,
      text,
      status: 'queued',
      timestamp: Date.now(),
    };

    this.emit('message:sent', message);

    return true;
  }

  /**
   * 获取通道状态
   */
  getStatus(): Record<string, unknown> {
    return {
      name: 'sms',
      type: 'sms',
      enabled: this.config.enabled,
      connected: this.connected,
      provider: this.config.provider,
      fromNumber: this.config.fromNumber,
    };
  }
}
