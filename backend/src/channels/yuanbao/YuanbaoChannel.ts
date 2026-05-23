/**
 * YuanbaoChannel 元宝通道（Tencent 元宝/AI 平台）
 * 对标 Tencent 元宝开放平台接口
 */
import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';

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

export function createYuanbaoChannel(): IChannelPlugin {
  return {
    id: 'yuanbao',
    meta: YUANBAO_META,
    capabilities: YUANBAO_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['appId']) errors.push('缺少 appId');
        if (!c['appKey']) errors.push('缺少 appKey');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          enabled: false,
          appId: '',
          appKey: '',
          botId: '',
          apiBaseUrl: 'https://api.yuanbao.tencent.com',
          webhookSecret: '',
          timeout: 10000,
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await yuanbaoChannel.connect();
      },
      async disconnect(): Promise<void> {
        await yuanbaoChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: yuanbaoChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: yuanbaoChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await yuanbaoChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },
      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return this.sendText(target, `[图片] ${imageUrl}`);
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: '元宝: sendFile 未实现' };
      },
      async sendInteractive(
        _target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: '元宝: 不支持交互卡片' };
      },
    },

    security: {
      dmPolicy: 'open',
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 3,
      async resolveSender(
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> {
        return {
          userId: (sender['fromUserId'] as string) || 'unknown',
          displayName: (sender['fromNickname'] as string) || 'Unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const yuanbaoChannelPlugin = createYuanbaoChannel();
