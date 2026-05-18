/**
 * BasePlatformAdapter 平台适配器基类
 * 对标 Hermes gateway/ 的 BasePlatformAdapter
 * 统一 5 个国产平台的通用逻辑，减少重复代码
 * 实现 IChannelPlugin 契约，可直接被 ChannelPluginRegistry 使用
 */
import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelId,
  ChannelMeta,
  ChannelCapabilities,
  IChannelConfigAdapter,
  IChannelLifecycleAdapter,
  IChannelOutboundAdapter,
  IChannelSecurityAdapter,
  ChannelStatus,
  MessageContext,
  InteractiveCard,
} from '@modules/channels/types';

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

const PLATFORM_CHANNEL_META: Record<PlatformType, ChannelMeta> = {
  wechat: {
    id: 'wechat',
    displayName: '微信',
    vendor: 'Tencent',
    vendorSite: 'https://weixin.qq.com',
    icon: '',
    markdownCapable: false,
    maxMessageLength: 2048,
    supportedMessageTypes: ['text'],
  },
  feishu: {
    id: 'feishu',
    displayName: '飞书',
    vendor: 'ByteDance',
    vendorSite: 'https://feishu.cn',
    icon: '',
    markdownCapable: true,
    maxMessageLength: 30720,
    supportedMessageTypes: ['text', 'image', 'markdown', 'card'],
  },
  dingtalk: {
    id: 'dingtalk',
    displayName: '钉钉',
    vendor: 'Alibaba',
    vendorSite: 'https://dingtalk.com',
    icon: '',
    markdownCapable: true,
    maxMessageLength: 20480,
    supportedMessageTypes: ['text', 'markdown', 'card'],
  },
  wecom: {
    id: 'wecom',
    displayName: '企业微信',
    vendor: 'Tencent',
    vendorSite: 'https://work.weixin.qq.com',
    icon: '',
    markdownCapable: false,
    maxMessageLength: 2048,
    supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
  },
  qq: {
    id: 'qq',
    displayName: 'QQ',
    vendor: 'Tencent',
    vendorSite: 'https://im.qq.com',
    icon: '',
    markdownCapable: false,
    maxMessageLength: 4096,
    supportedMessageTypes: ['text', 'image'],
  },
};

const PLATFORM_CAPABILITIES: Record<PlatformType, ChannelCapabilities> = {
  wechat: {
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
  },
  feishu: {
    directMessage: true,
    groupMessage: true,
    groupMention: true,
    threading: true,
    reactions: false,
    interactive: true,
    voiceCall: false,
    fileUpload: true,
    imageMessage: true,
    webhook: true,
  },
  dingtalk: {
    directMessage: true,
    groupMessage: true,
    groupMention: true,
    threading: false,
    reactions: false,
    interactive: true,
    voiceCall: false,
    fileUpload: true,
    imageMessage: true,
    webhook: true,
  },
  wecom: {
    directMessage: true,
    groupMessage: true,
    groupMention: true,
    threading: false,
    reactions: false,
    interactive: true,
    voiceCall: false,
    fileUpload: true,
    imageMessage: true,
    webhook: true,
  },
  qq: {
    directMessage: true,
    groupMessage: true,
    groupMention: false,
    threading: false,
    reactions: false,
    interactive: false,
    voiceCall: false,
    fileUpload: true,
    imageMessage: true,
    webhook: false,
  },
};

export interface PlatformAdapterEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export abstract class BasePlatformAdapter extends EventEmitter implements IChannelPlugin {
  public readonly name: AdapterName;
  public readonly type: string = 'platform';
  public enabled: boolean;
  public connected: boolean = false;
  protected platform: PlatformType;
  protected _config: Record<string, unknown>;

  // IChannelPlugin 契约属性
  get id(): ChannelId {
    return this.platform;
  }

  get meta(): ChannelMeta {
    return PLATFORM_CHANNEL_META[this.platform];
  }

  get capabilities(): ChannelCapabilities {
    return PLATFORM_CAPABILITIES[this.platform];
  }

  /**
   * IChannelPlugin.config — 配置验证适配器
   */
  get config(): IChannelConfigAdapter {
    return {
      validate: () => ({ valid: true, errors: [] }),
      getDefaultConfig: () => ({ ...this._config }),
    };
  }

  get lifecycle(): IChannelLifecycleAdapter {
    return {
      connect: async (cfg: Record<string, unknown>) => {
        this.updateConfig(cfg);
        await this.connect();
      },
      disconnect: async () => {
        await this.disconnect();
      },
      healthCheck: async () => ({
        healthy: this.isConnected(),
        latencyMs: 0,
      }),
      getStatus: (): ChannelStatus => ({
        connected: this.isConnected(),
        latencyMs: 0,
        lastMessageAt: null,
        uptimeMs: 0,
      }),
    };
  }

  get outbound(): IChannelOutboundAdapter {
    return {
      sendText: async (target: string, content: string) => {
        const ok = await this.sendMessage(target, content);
        return { success: ok };
      },
      sendMarkdown: async (target: string, content: string) => {
        const ok = await this.sendMessage(target, content);
        return { success: ok };
      },
      sendImage: async (target: string, imageUrl: string) => {
        const ok = await this.sendMessage(target, imageUrl);
        return { success: ok };
      },
      sendFile: async (target: string, filePath: string) => {
        const ok = await this.sendMessage(target, filePath);
        return { success: ok };
      },
      sendInteractive: async (target: string, card: InteractiveCard) => {
        const ok = await this.sendMessage(target, JSON.stringify(card));
        return { success: ok };
      },
    };
  }

  get security(): IChannelSecurityAdapter {
    return {
      dmPolicy: 'open',
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: String(sender['userId'] || 'unknown'),
        displayName: String(sender['displayName'] || 'Unknown'),
        isApproved: true,
      }),
      authorizeMessage: async (_ctx: MessageContext) => ({
        allowed: true,
      }),
    };
  }

  constructor(platform: PlatformType, config: Record<string, unknown> = {}) {
    super();
    this.platform = platform;
    this.name = platform;
    this.enabled = (config.enabled as boolean) ?? false;
    this._config = config;
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
    return { ...this._config };
  }

  updateConfig(partial: Record<string, unknown>): void {
    this._config = { ...this._config, ...partial };
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
