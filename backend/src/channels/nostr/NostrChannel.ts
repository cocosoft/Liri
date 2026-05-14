/**
 * NostrChannel Nostr 通道
 * 对标 OpenClaw 的 Nostr 支持
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

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
