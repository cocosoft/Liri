/**
 * ChannelRegistry 通道注册中心
 * 对标 CC 的通道管理能力
 */
import { EventEmitter } from 'node:events';

/**
 * 通道接口
 */
export interface ChannelInterface {
  name: string;
  type: string;
  enabled: boolean;
  connected: boolean;

  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(target: string, text: string): Promise<boolean>;
  getStatus(): Record<string, unknown>;

  plugin?: {
    outbound: {
      sendText(target: string, message: string): { success: boolean };
    };
  };
}

/**
 * 通道配置
 */
export interface ChannelConfig {
  name: string;
  type: string;
  enabled: boolean;
  options: Record<string, unknown>;
}

/**
 * 通道消息
 */
export interface ChannelMessage {
  id: string;
  channel: string;
  type: string;
  content: string;
  sender: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 通道注册中心
 */
export class ChannelRegistry extends EventEmitter {
  private channels: Map<string, ChannelInterface> = new Map();
  private configs: Map<string, ChannelConfig> = new Map();

  constructor() {
    super();
  }

  /**
   * 注册通道
   */
  register(channel: ChannelInterface): void {
    this.channels.set(channel.name, channel);
    this.configs.set(channel.name, {
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
      options: {},
    });

    this.emit('channel:registered', { name: channel.name, type: channel.type });
  }

  /**
   * 注销通道
   */
  unregister(name: string): boolean {
    const channel = this.channels.get(name);

    if (channel) {
      channel.disconnect();
      this.channels.delete(name);
      this.configs.delete(name);
      this.emit('channel:unregistered', { name });

      return true;
    }

    return false;
  }

  /**
   * 获取通道
   */
  get(name: string): ChannelInterface | undefined {
    return this.channels.get(name);
  }

  /**
   * 获取所有通道
   */
  getAll(): ChannelInterface[] {
    return Array.from(this.channels.values());
  }

  /**
   * 获取所有已启用通道
   */
  getEnabled(): ChannelInterface[] {
    return Array.from(this.channels.values()).filter((c) => c.enabled);
  }

  /**
   * 获取配置
   */
  getConfig(name: string): ChannelConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * 获取所有配置
   */
  getAllConfigs(): ChannelConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 广播消息到所有通道
   */
  async broadcast(text: string): Promise<Array<{ channel: string; success: boolean }>> {
    const results: Array<{ channel: string; success: boolean }> = [];

    for (const channel of this.getEnabled()) {
      try {
        const success = await channel.sendMessage('', text);
        results.push({ channel: channel.name, success });
      } catch {
        results.push({ channel: channel.name, success: false });
      }
    }

    return results;
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; enabled: number; types: Record<string, number> } {
    const channels = Array.from(this.channels.values());
    const types: Record<string, number> = {};

    for (const channel of channels) {
      types[channel.type] = (types[channel.type] || 0) + 1;
    }

    return {
      total: channels.length,
      enabled: channels.filter((c) => c.enabled).length,
      types,
    };
  }

  /**
   * 获取所有通道状态（兼容旧 API）
   */
  getAllStatuses(): Array<{ id: string; status: { connected: boolean; latencyMs: number } }> {
    return Array.from(this.channels.entries()).map(([name, channel]) => ({
      id: name,
      status: {
        connected: channel.connected,
        latencyMs: 0,
      },
    }));
  }

  /**
   * 获取通道连接状态（兼容旧 API）
   */
  getStatus(name: string): { connected: boolean } | undefined {
    const channel = this.channels.get(name);
    if (!channel) return undefined;

    return { connected: channel.connected };
  }

  /**
   * 连接通道（兼容旧 API）
   */
  async connect(name: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel) return false;

    return channel.connect();
  }

  /**
   * 断开通道（兼容旧 API）
   */
  async disconnect(name: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel) return false;

    await channel.disconnect();

    return true;
  }
}

export const channelRegistry = new ChannelRegistry();
