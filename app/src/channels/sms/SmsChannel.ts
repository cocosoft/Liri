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

import { getLogger } from '@modules/monitoring';
import { handleError } from '@openliri/infra/error';
import { buildSmsProviderRequest } from './providerRequests';
const logger = getLogger('channels:sms:SmsChannel');

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
  /** 阿里云：控制台报备的短信签名 */
  signName?: string;
  /** 阿里云：短信模板编号 */
  templateCode?: string;
  /** 阿里云：地域（默认 cn-hangzhou） */
  regionId?: string;
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
      signName: config?.signName,
      templateCode: config?.templateCode,
      regionId: config?.regionId,
      fromNumber: config?.fromNumber || '',
      endpoint: config?.endpoint,
      maxRetries: config?.maxRetries ?? 3,
      timeout: config?.timeout ?? 10000,
    };
  }

  /** 最近一次失败原因（供插件层如实返回，不吞错） */
  private lastError: string | null = null;

  /** 应用配置（2026-11-01：插件按传入 config 配置本实例，此前 onConnect 忽略配置） */
  configure(partial: Partial<SmsConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      provider: (partial.provider ??
        this.config.provider) as SmsConfig['provider'],
      enabled: partial.enabled ?? this.config.enabled,
      fromNumber: partial.fromNumber ?? this.config.fromNumber,
      maxRetries: partial.maxRetries ?? this.config.maxRetries,
      timeout: partial.timeout ?? this.config.timeout,
    };
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * 连接到 SMS 服务提供商
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) {
      this.lastError = 'SMS 通道未启用';
      return false;
    }

    // 失败原因统一走 `lastError`：本实例没有 'error' 监听者，`emit('error')` 会直接抛出
    // （Node 对无监听的 'error' 事件抛 ERR_UNHANDLED_ERROR），把可预期的配置缺口变成崩溃，
    // 还会盖掉插件层应给出的「SMS 连接失败：…」。
    if (!this.config.fromNumber) {
      this.lastError = '发件人号码未配置';
      return false;
    }

    if (
      this.config.provider === 'twilio' &&
      (!this.config.accountSid || !this.config.authToken)
    ) {
      this.lastError = 'Twilio 凭证未配置';
      return false;
    }

    if (
      (this.config.provider === 'aliyun' ||
        this.config.provider === 'tencent') &&
      (!this.config.apiKey || !this.config.apiSecret)
    ) {
      this.lastError = `${this.config.provider} 凭证未配置`;
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
   * 发送 SMS（2026-11-01 接线：按 provider 构造真实请求并发送）
   *
   * 失败一律 `false` 且把原因写进 `lastError`（不再"只 emit 事件就报成功"）：
   * 未连接 / provider 不可构造（如阿里云缺模板）/ 上游非 2xx / 网络异常。
   */
  async sendMessage(target: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.lastError = 'SMS 未连接';
      return false;
    }

    const built = buildSmsProviderRequest({
      provider: this.config.provider,
      to: target,
      text,
      from: this.config.fromNumber,
      credentials: {
        accountSid: this.config.accountSid,
        authToken: this.config.authToken,
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
      },
      endpoint: this.config.endpoint,
      signName: this.config.signName,
      templateCode: this.config.templateCode,
      regionId: this.config.regionId,
    });
    if (!built.ok) {
      // 不 emit('error')：无监听的 'error' 事件会让 Node 直接抛出，把可预期的配置缺口
      // 变成崩溃；失败原因统一走 `lastError`，由调用方如实返回。
      this.lastError = built.reason;
      return false;
    }

    try {
      const resp = await fetch(built.request.url, {
        method: built.request.method,
        headers: built.request.headers,
        body: built.request.body,
        signal: AbortSignal.timeout(this.config.timeout),
      });
      if (!resp.ok) {
        this.lastError = `SMS 上游 ${resp.status}`;
        return false;
      }
    } catch (e) {
      this.lastError = `SMS 发送失败: ${String(e)}`;
      return false;
    }

    this.lastError = null;
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
      signName: '',
      templateCode: '',
      regionId: 'cn-hangzhou',
      maxRetries: 3,
      timeout: 10000,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['fromNumber']) errors.push('缺少 fromNumber');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    // 2026-11-01：此前忽略传入 config，直接对模块单例调 connect()（单例 enabled=false、
    // fromNumber 为空 ⇒ 恒返回 false，却无人检查）⇒ 通道"看起来已连接"但发不出。
    smsChannel.configure({
      enabled: true,
      provider: (config['provider'] as SmsConfig['provider']) || 'custom',
      fromNumber: (config['fromNumber'] as string) || '',
      accountSid: config['accountSid'] as string | undefined,
      authToken: config['authToken'] as string | undefined,
      apiKey: config['apiKey'] as string | undefined,
      apiSecret: config['apiSecret'] as string | undefined,
      signName: config['signName'] as string | undefined,
      templateCode: config['templateCode'] as string | undefined,
      regionId: config['regionId'] as string | undefined,
      endpoint: config['endpoint'] as string | undefined,
      maxRetries: (config['maxRetries'] as number) ?? 3,
      timeout: (config['timeout'] as number) ?? 10000,
    });
    const ok = await smsChannel.connect();
    if (!ok) {
      throw new Error(
        `SMS 连接失败：${smsChannel.getLastError() ?? '配置不完整（provider 凭证 / 发件人号码）'}`
      );
    }
  }

  protected override async onDisconnect(): Promise<void> {
    await smsChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      // 2026-11-01：此前忽略 `sendMessage` 的布尔返回 ⇒ 一律报成功（谎报）。
      const ok = await smsChannel.sendMessage(target, content);
      if (!ok) {
        return {
          success: false,
          error: smsChannel.getLastError() ?? 'SMS 发送失败',
        };
      }
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:sms',
        action: 'sendTextMessage',
        context: { target },
      });
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
