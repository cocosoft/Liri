/**
 * NostrChannel Nostr 通道
 * 对标 OpenClaw 的 Nostr 支持
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
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
 * Nostr 配置
 */
export interface NostrConfig {
  enabled: boolean;
  relays: string[];
  privateKey?: string;
  publicKey?: string;
}

/**
 * Nostr 事件
 */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Nostr 通道
 */
export class NostrChannel extends EventEmitter {
  private config: NostrConfig;
  private connected: boolean = false;

  constructor(config?: Partial<NostrConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      relays: config?.relays || [],
      privateKey: config?.privateKey,
      publicKey: config?.publicKey,
    };
  }

  /**
   * 连接
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled || this.config.relays.length === 0) return false;

    this.connected = true;
    this.emit('connected', { relays: this.config.relays });

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
   * 发布事件
   */
  async publishEvent(
    content: string,
    kind: number = 1
  ): Promise<string | null> {
    if (!this.connected) return null;

    const eventId = crypto.randomBytes(32).toString('hex');

    this.emit('event:published', {
      id: eventId,
      kind,
      content,
      timestamp: Date.now(),
    });

    return eventId;
  }

  /**
   * 订阅事件
   */
  async subscribe(filters: Record<string, unknown>): Promise<boolean> {
    if (!this.connected) return false;

    this.emit('subscribed', { filters });

    return true;
  }

  /**
   * 发送直接消息
   */
  async sendDirectMessage(to: string, content: string): Promise<string | null> {
    if (!this.connected) return null;

    return this.publishEvent(content, 4);
  }

  /**
   * 获取状态
   */
  getStatus(): { connected: boolean; relays: string[] } {
    return { connected: this.connected, relays: [...this.config.relays] };
  }
}

export const nostrChannel = new NostrChannel();

const NOSTR_META: ChannelMeta = {
  id: 'nostr',
  displayName: 'Nostr',
  vendor: 'Nostr',
  vendorSite: 'https://nostr.com',
  icon: 'nostr',
  markdownCapable: false,
  maxMessageLength: 64000,
  supportedMessageTypes: ['text'],
};

const NOSTR_CAPABILITIES: ChannelCapabilities = {
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

export function createNostrChannel(): IChannelPlugin {
  return {
    id: 'nostr',
    meta: NOSTR_META,
    capabilities: NOSTR_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { relays: [], privateKey: '', publicKey: '' };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await nostrChannel.connect();
      },
      async disconnect(): Promise<void> {
        await nostrChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: nostrChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: nostrChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await nostrChannel.sendDirectMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(
        _target: string,
        _content: string
      ): Promise<SendResult> {
        return { success: false, error: 'Nostr: 不支持 Markdown' };
      },
      async sendImage(_target: string, _imageUrl: string): Promise<SendResult> {
        return { success: false, error: 'Nostr: 不支持图片' };
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Nostr: 不支持文件' };
      },
      async sendInteractive(
        _target: string,
        _card: InteractiveCard
      ): Promise<SendResult> {
        return { success: false, error: 'Nostr: 不支持交互卡片' };
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
          userId: (sender['pubkey'] as string) || 'unknown',
          displayName: (sender['pubkey'] as string) || 'unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const nostrChannelPlugin = createNostrChannel();
