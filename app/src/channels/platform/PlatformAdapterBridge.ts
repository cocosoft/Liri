/**
 * PlatformAdapterBridge — 平台适配器桥接层
 *
 * 将轻量级 PlatformAdapter 接口适配为完整 IChannelPlugin，使第三方
 * 开发者无需理解 5 Adapter 体系即可接入新平台。
 *
 * 桥接策略：
 * - config → 委托 PlatformAdapter.setup()
 * - lifecycle → connect/disconnect/healthCheck
 * - outbound → sendText/sendImage 等，委托 sendMessage
 * - security → 默认允许所有消息
 * - pairing → 默认无配对逻辑
 */

import type {
  IChannelPlugin,
  ChannelId,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  MessageContext,
  ResolvedSender,
  IChannelConfigAdapter,
  IChannelLifecycleAdapter,
  IChannelOutboundAdapter,
  IChannelSecurityAdapter,
  IChannelPairingAdapter,
  ChannelStatus,
  DmPolicy,
} from '@modules/channels/types';
import type { PlatformAdapter } from './PlatformAdapter.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('channels:platform:PlatformAdapterBridge');

/**
 * 平台类型 → ChannelId 映射表
 */
const CHANNEL_TYPE_MAP: Record<string, ChannelId> = {
  slack: 'slack',
  discord: 'discord',
  telegram: 'telegram',
  dingtalk: 'dingtalk',
  feishu: 'feishu',
  wecom: 'wecom',
  wechat: 'wechat',
  qq: 'qq',
  line: 'line',
  irc: 'irc',
  matrix: 'matrix',
  signal: 'signal',
  whatsapp: 'whatsapp',
  email: 'email',
  sms: 'sms',
  webhook: 'webhook',
  nostr: 'nostr',
  googlechat: 'googlechat',
  msteams: 'msteams',
  zalo: 'zalo',
  twitter: 'twitter',
  facebook: 'facebook',
  claude: 'claude',
};

/**
 * 默认渠道能力
 */
function defaultCapabilities(): ChannelCapabilities {
  return {
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
}

/**
 * 默认渠道元数据
 */
function defaultMeta(id: ChannelId, displayName: string): ChannelMeta {
  return {
    id,
    displayName,
    vendor: '',
    vendorSite: '',
    icon: '',
    markdownCapable: false,
    maxMessageLength: 4096,
    supportedMessageTypes: ['text'],
  };
}

/**
 * PlatformAdapterBridge — 将 PlatformAdapter 包装为 IChannelPlugin
 */
export class PlatformAdapterBridge implements IChannelPlugin {
  readonly id: ChannelId;
  readonly capabilities: ChannelCapabilities;
  readonly config: IChannelConfigAdapter;
  readonly lifecycle: IChannelLifecycleAdapter;
  readonly outbound: IChannelOutboundAdapter;
  readonly security: IChannelSecurityAdapter;
  readonly pairing?: IChannelPairingAdapter;

  private adapter: PlatformAdapter;
  private _meta: ChannelMeta;
  private configData: Record<string, unknown> = {};
  private startTime = 0;

  constructor(adapter: PlatformAdapter) {
    const channelId = CHANNEL_TYPE_MAP[adapter.type] ?? adapter.type;
    this.id = channelId;
    this.adapter = adapter;
    this._meta = defaultMeta(channelId, adapter.name);
    this.capabilities = defaultCapabilities();

    this.config = this.createConfigAdapter();
    this.lifecycle = this.createLifecycleAdapter();
    this.outbound = this.createOutboundAdapter();
    this.security = this.createSecurityAdapter();
  }

  get meta(): ChannelMeta {
    return this._meta;
  }

  private createConfigAdapter(): IChannelConfigAdapter {
    return {
      validate: (config: Record<string, unknown>) => {
        const errors: string[] = [];
        if (typeof config.enabled !== 'boolean') {
          errors.push('enabled 必须是布尔值');
        }
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig: () => ({
        enabled: true,
      }),
    };
  }

  private createLifecycleAdapter(): IChannelLifecycleAdapter {
    return {
      connect: async (config: Record<string, unknown>) => {
        this.configData = config;
        await this.adapter.setup(config);
        this.startTime = Date.now();
      },
      disconnect: async () => {
        await this.adapter.teardown();
      },
      healthCheck: async () => {
        const status = this.adapter.getStatus();
        const connected = status.connected === true;
        return { healthy: connected, latencyMs: 0 };
      },
      getStatus: (): ChannelStatus => {
        const s = this.adapter.getStatus();
        return {
          connected: s.connected === true,
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
          error: s.error as string | undefined,
        };
      },
    };
  }

  private createOutboundAdapter(): IChannelOutboundAdapter {
    return {
      sendText: async (
        target: string,
        content: string
      ): Promise<SendResult> => {
        try {
          const ok = await this.adapter.sendMessage(target, content);
          return { success: ok };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
      sendMarkdown: async (
        target: string,
        content: string
      ): Promise<SendResult> => {
        return this.outbound.sendText(target, content);
      },
      sendImage: async (
        _target: string,
        _imageUrl: string
      ): Promise<SendResult> => {
        return { success: false, error: 'sendImage 未由 PlatformAdapter 实现' };
      },
      sendFile: async (
        _target: string,
        _filePath: string
      ): Promise<SendResult> => {
        return { success: false, error: 'sendFile 未由 PlatformAdapter 实现' };
      },
      sendInteractive: async (
        _target: string,
        _card: InteractiveCard
      ): Promise<SendResult> => {
        return {
          success: false,
          error: 'sendInteractive 未由 PlatformAdapter 实现',
        };
      },
    };
  }

  private createSecurityAdapter(): IChannelSecurityAdapter {
    return {
      dmPolicy: 'open' as DmPolicy,
      pairingCodeTimeoutMs: 300_000,
      maxPairingAttempts: 3,
      resolveSender: async (
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> => {
        return {
          userId: String(sender.userId ?? sender.id ?? 'unknown'),
          displayName: String(sender.displayName ?? sender.name ?? ''),
          isApproved: true,
        };
      },
      authorizeMessage: async (_ctx: MessageContext) => {
        return { allowed: true };
      },
    };
  }
}
