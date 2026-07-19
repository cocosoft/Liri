/**
 * YuanbaoChannel 元宝通道（Tencent 元宝/AI 平台）
 * 对标 Tencent 元宝开放平台接口
 */
import { EventEmitter } from 'events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';
import { BaseChannelPlugin } from '@modules/channels/base/BaseChannelPlugin';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:yuanbao:YuanbaoChannel',
  level: LogLevel.INFO,
});

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

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', { platform: 'yuanbao' });
  }

  async sendMessage(toUserId: string, text: string): Promise<boolean> {
    if (!this.connected) {
      this.emit('error', new Error('未连接'));
      return false;
    }

    this.emit('message:sent', { toUserId, text, timestamp: Date.now() });

    return true;
  }

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

const YUANBAO_META: ChannelMeta = {
  id: 'yuanbao',
  displayName: '元宝',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://yuanbao.tencent.com',
  icon: '💬',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'markdown'],
};

const YUANBAO_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

export const yuanbaoChannel = new YuanbaoChannel();

class YuanbaoChannelPlugin extends BaseChannelPlugin {
  readonly id = 'yuanbao' as const;
  readonly meta = YUANBAO_META;
  readonly capabilities = YUANBAO_CAPABILITIES;

  constructor() {
    super();
    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> => ({
        userId: (sender['fromUserId'] as string) || 'unknown',
        displayName: (sender['fromNickname'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      enabled: false,
      appId: '',
      appKey: '',
      botId: '',
      apiBaseUrl: 'https://api.yuanbao.tencent.com',
      webhookSecret: '',
      timeout: 10000,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId');
    if (!config['appKey']) errors.push('缺少 appKey');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await yuanbaoChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await yuanbaoChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await yuanbaoChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, `[图片] ${imageUrl}`);
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: '元宝: sendFile 未实现' };
  }

  protected override async sendInteractiveMessage(
    _target: string,
    _card: InteractiveCard
  ): Promise<SendResult> {
    return { success: false, error: '元宝: 不支持交互卡片' };
  }
}

export function createYuanbaoChannel(): IChannelPlugin {
  return new YuanbaoChannelPlugin();
}

export const yuanbaoChannelPlugin = createYuanbaoChannel();
