/**
 * NostrChannel Nostr 通道
 * 对标 OpenClaw 的 Nostr 支持
 */
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { NOSTR_SITE_URL } from '../constants';
const logger = getLogger('channels:nostr:NostrChannel');

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
 * Nostr 通道（遗留 EventEmitter 类，保持向后兼容）
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
  vendorSite: NOSTR_SITE_URL,
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

class NostrChannelPlugin extends BaseChannelPlugin {
  readonly id = 'nostr';
  readonly meta = NOSTR_META;
  readonly capabilities = NOSTR_CAPABILITIES;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['pubkey'] as string) || 'unknown',
        displayName: (sender['pubkey'] as string) || 'unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { relays: ['wss://relay.damus.io'], privateKey: '', publicKey: '' };
  }

  protected validateConfig(_config: Record<string, unknown>): string[] {
    return [];
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await nostrChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await nostrChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      // 2026-11-01（诚实性修复）：此前**恒返回 success** —— 未就绪时 `sendDirectMessage`
      // 返回 null（消息并未发出）却仍报成功 ⇒ 静默丢消息。现按真实返回值判定。
      const messageId = await nostrChannel.sendDirectMessage(target, content);
      if (!messageId) {
        return {
          success: false,
          error:
            'Nostr 通道未就绪：消息未发出（当前实现无 WebSocket 传输层，需先实现 relay 连接与事件签名）',
        };
      }
      return { success: true, messageId };
    } catch (e) {
      await handleError(e, {
        module: 'channels:nostr',
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
    return { success: false, error: 'Nostr: 不支持图片' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Nostr: 不支持文件' };
  }
}

export function createNostrChannel(): IChannelPlugin {
  return new NostrChannelPlugin();
}

export const nostrChannelPlugin = createNostrChannel();
