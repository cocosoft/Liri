/**
 * BasePlatformAdapter 平台适配器基类
 * 对标 Hermes gateway/ 的 BasePlatformAdapter
 * 统一 5 个国产平台的通用逻辑，减少重复代码
 * 实现 ChannelInterface 契约，可直接被 DeliveryRouter 使用
 */
import { EventEmitter } from 'node:events';

export type PlatformType = 'wechat' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';
export type AdapterName = 'wechat' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';

export interface PlatformMessageFormat {
  messageType:
    | 'text'
    | 'rich_text'
    | 'markdown'
    | 'interactive_card'
    | 'template_card';
  supportThreading: boolean;
  supportMention: boolean;
  maxMessageLength: number;
}

export const PLATFORM_MESSAGE_FORMATS: Record<
  PlatformType,
  PlatformMessageFormat
> = {
  wechat: {
    messageType: 'text',
    supportThreading: false,
    supportMention: false,
    maxMessageLength: 2048,
  },
  feishu: {
    messageType: 'interactive_card',
    supportThreading: true,
    supportMention: true,
    maxMessageLength: 30720,
  },
  dingtalk: {
    messageType: 'markdown',
    supportThreading: false,
    supportMention: true,
    maxMessageLength: 20480,
  },
  wecom: {
    messageType: 'rich_text',
    supportThreading: false,
    supportMention: true,
    maxMessageLength: 2048,
  },
  qq: {
    messageType: 'text',
    supportThreading: false,
    supportMention: false,
    maxMessageLength: 4096,
  },
};

export interface PlatformAdapterEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export abstract class BasePlatformAdapter extends EventEmitter {
  public readonly name: AdapterName;
  public readonly type: string = 'platform';
  public enabled: boolean;
  public connected: boolean = false;
  protected platform: PlatformType;
  protected config: Record<string, unknown>;

  constructor(platform: PlatformType, config: Record<string, unknown> = {}) {
    super();
    this.platform = platform;
    this.name = platform;
    this.enabled = (config.enabled as boolean) ?? false;
    this.config = config;
  }

  getPlatformName(): PlatformType {
    return this.platform;
  }

  getMessageFormat(): PlatformMessageFormat {
    return PLATFORM_MESSAGE_FORMATS[this.platform];
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  updateConfig(partial: Record<string, unknown>): void {
    this.config = { ...this.config, ...partial };
  }

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(target: string, content: string): Promise<boolean>;
  abstract getStatus(): Record<string, unknown>;

  protected emitEvent(type: string, data: Record<string, unknown>): void {
    this.emit('event', {
      type,
      data: { platform: this.platform, ...data },
      timestamp: Date.now(),
    } as PlatformAdapterEvent);
  }

  protected truncateMessage(content: string): string {
    const maxLen = this.getMessageFormat().maxMessageLength;
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen - 20) + '…[消息过长已截断]';
  }
}
