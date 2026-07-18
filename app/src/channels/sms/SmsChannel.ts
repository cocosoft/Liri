/**
 * SmsChannel SMS 短信通道
 * 对标 Hermes 的 SMS 通道实现
 */
import { EventEmitter } from 'events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'channels:sms:SmsChannel', level: LogLevel.INFO });

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
 * SMS 通道（遗留 EventEmitter 类，保持向后兼容）
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

export const smsChannel = new SmsChannel();

const SMS_META: ChannelMeta = {
  id: 'sms',
  displayName: 'SMS',
  vendor: 'SMS',
  vendorSite: '',
  icon: 'sms',
  markdownCapable: false,
  maxMessageLength: 160,
  supportedMessageTypes: ['text'],
};

const SMS_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: false,
};

class SmsChannelPlugin extends BaseChannelPlugin {
  readonly id = 'sms';
  readonly meta = SMS_META;
  readonly capabilities = SMS_CAPABILITIES;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['to'] as string) || 'unknown',
        displayName: (sender['to'] as string) || 'unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      provider: 'custom',
      fromNumber: '',
      accountSid: '',
      authToken: '',
      apiKey: '',
      apiSecret: '',
      maxRetries: 3,
      timeout: 10000,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['fromNumber']) errors.push('缺少 fromNumber');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await smsChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await smsChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await smsChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'SMS: 不支持图片' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'SMS: 不支持文件' };
  }
}

export function createSmsChannel(): IChannelPlugin {
  return new SmsChannelPlugin();
}

export const smsChannelPlugin = createSmsChannel();
