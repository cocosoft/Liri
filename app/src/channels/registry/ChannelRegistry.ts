/**
 * ChannelRegistry 通道注册中心
 *
 * 统一通道注册代理，以 ChannelPluginRegistry（core/gateway/）为唯一单源，
 * ChannelRegistry 作为其薄代理对外提供 ChannelInterface 视图。
 *
 * 双轨兼容：
 * - register() 保持原有的本地缓存逻辑（用于 IChannelPlugin / ChannelInterface 直接注册）
 * - 读取方法优先返回已注册的 ChannelPlugin 适配结果，本地缓存作为补充
 * - 未匹配到本地缓存时自动从 ChannelPluginRegistry 同步
 */

import { EventEmitter } from 'node:events';
import { ChannelPluginRegistry } from '../../core/gateway/ChannelPluginRegistry';
import type { ChannelPlugin } from '../../core/gateway/ChannelPlugin';
import { ChannelStatus } from '../../core/gateway/types';
import type { IChannelPlugin } from '../types/IChannel';

/**
 * 通道接口
 * @deprecated 过渡接口，新代码请使用 IChannelPlugin
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

  homeChannelId?: string;
  supportsThreads?: boolean;
  sendThreadMessage?(
    target: string,
    threadId: string,
    text: string
  ): Promise<boolean>;

  plugin?: {
    outbound: {
      sendText(target: string, message: string): Promise<{ success: boolean }>;
    };
  };
}

/**
 * 将 IChannelPlugin 适配为 ChannelInterface
 */
export function adaptPluginToInterface(
  plugin: IChannelPlugin
): ChannelInterface {
  return {
    name: plugin.id,
    type: plugin.id,
    enabled: true,
    get connected() {
      return plugin.lifecycle.getStatus().connected;
    },
    get homeChannelId() {
      return (plugin as unknown as Record<string, string | undefined>)
        .homeChannelId;
    },
    connect: async () => {
      await plugin.lifecycle.connect({});
      return plugin.lifecycle.getStatus().connected;
    },
    disconnect: async () => {
      await plugin.lifecycle.disconnect();
    },
    sendMessage: async (_target: string, text: string) => {
      const result = await plugin.outbound.sendText(_target, text);
      return result.success;
    },
    getStatus: () => ({
      ...plugin.lifecycle.getStatus(),
      type: plugin.id,
    }),
    plugin: {
      outbound: {
        sendText: async (target: string, message: string) => {
          return plugin.outbound.sendText(target, message);
        },
      },
    },
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

/** ChannelPlugin 状态 → ChannelInterface 状态判断 */
function isPluginConnected(plugin: ChannelPlugin): boolean {
  return (
    plugin.status === ChannelStatus.CONNECTED ||
    plugin.status === ChannelStatus.CONNECTING
  );
}

/**
 * 将 ChannelPlugin 适配为 ChannelInterface
 * ChannelPlugin 不包含 sendMessage 等通道特有工具方法，
 * 此处提供包装实现，实际发送能力由 ChannelManager 的同步注册补充。
 */
function adaptPluginToChannelInterface(
  plugin: ChannelPlugin
): ChannelInterface {
  return {
    name: plugin.id,
    type: plugin.id,
    enabled: true,
    get connected() {
      return isPluginConnected(plugin);
    },
    connect: async () => {
      try {
        await plugin.connect();
        return isPluginConnected(plugin);
      } catch {
        return false;
      }
    },
    disconnect: async () => {
      try {
        await plugin.disconnect();
      } catch {
        // 忽略断开失败
      }
    },
    sendMessage: async () => {
      return false;
    },
    getStatus: () => ({
      status: plugin.status,
      connected: isPluginConnected(plugin),
      type: plugin.id,
    }),
  };
}

/**
 * 通道注册中心
 * 薄代理模式：优先从 ChannelPluginRegistry 读取，本地缓存作为补充
 */
export class ChannelRegistry extends EventEmitter {
  private channels: Map<string, ChannelInterface> = new Map();
  private configs: Map<string, ChannelConfig> = new Map();

  constructor() {
    super();
    this.syncFromPluginRegistry();
  }

  /** 从 ChannelPluginRegistry 同步已有插件到本地缓存 */
  private syncFromPluginRegistry(): void {
    const registry = ChannelPluginRegistry.getInstance();
    for (const plugin of registry.getAll()) {
      const name = plugin.id;
      if (!this.channels.has(name)) {
        this.channels.set(name, adaptPluginToChannelInterface(plugin));
      }
    }
  }

  /**
   * 注册通道（支持 ChannelInterface 和 IChannelPlugin）
   */
  register(channel: ChannelInterface | IChannelPlugin): void {
    let adapted: ChannelInterface;

    if ('lifecycle' in channel && 'outbound' in channel) {
      adapted = adaptPluginToInterface(channel as IChannelPlugin);
    } else {
      adapted = channel as ChannelInterface;
    }

    this.channels.set(adapted.name, adapted);
    this.configs.set(adapted.name, {
      name: adapted.name,
      type: adapted.type,
      enabled: adapted.enabled,
      options: {},
    });

    this.emit('channel:registered', { name: adapted.name, type: adapted.type });
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
   * 查询顺序：本地缓存 → ChannelPluginRegistry
   */
  get(name: string): ChannelInterface | undefined {
    if (this.channels.has(name)) {
      return this.channels.get(name);
    }
    const registry = ChannelPluginRegistry.getInstance();
    const plugin = registry.lookup(name);
    if (!plugin) return undefined;

    const adapted = adaptPluginToChannelInterface(plugin);
    this.channels.set(name, adapted);
    return adapted;
  }

  /**
   * 获取所有通道
   */
  getAll(): ChannelInterface[] {
    this.syncFromPluginRegistry();
    return Array.from(this.channels.values());
  }

  /**
   * 获取所有已启用通道
   */
  getEnabled(): ChannelInterface[] {
    return this.getAll().filter((c) => c.enabled);
  }

  /**
   * 获取配置
   */
  getConfig(name: string): ChannelConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * 更新通道配置（合并模式）
   * 支持更新 name / enabled / options
   */
  updateConfig(
    name: string,
    changes: {
      name?: string;
      enabled?: boolean;
      options?: Record<string, unknown>;
    }
  ): boolean {
    const config = this.configs.get(name);
    if (!config) return false;

    if (changes.name !== undefined) {
      config.name = changes.name;
    }
    if (changes.enabled !== undefined) {
      config.enabled = changes.enabled;
    }
    if (changes.options !== undefined) {
      config.options = { ...config.options, ...changes.options };
    }
    return true;
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
  async broadcast(
    text: string
  ): Promise<Array<{ channel: string; success: boolean }>> {
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

  sendToHomeChannel(name: string, text: string): boolean {
    const channel = this.channels.get(name);
    if (!channel || !channel.enabled) return false;

    const target = channel.homeChannelId || '';
    channel.sendMessage(target, text);

    return true;
  }

  sendThreadReply(name: string, threadId: string, text: string): boolean {
    const channel = this.channels.get(name);
    if (!channel || !channel.supportsThreads || !channel.sendThreadMessage)
      return false;

    const target = channel.homeChannelId || '';
    channel.sendThreadMessage(target, threadId, text);

    return true;
  }

  getHomeChannels(): Array<{ name: string; homeChannelId: string }> {
    return this.getEnabled()
      .filter((c) => c.homeChannelId)
      .map((c) => ({ name: c.name, homeChannelId: c.homeChannelId! }));
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    enabled: number;
    types: Record<string, number>;
  } {
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
  getAllStatuses(): Array<{
    id: string;
    status: { connected: boolean; latencyMs: number };
  }> {
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

  /**
   * 检查通道是否已连接
   */
  isConnected(name: string): boolean {
    const channel = this.channels.get(name);
    return channel ? channel.connected : false;
  }

  /**
   * 断开所有已连接通道
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const channel of this.channels.values()) {
      if (channel.connected) {
        promises.push(channel.disconnect());
      }
    }
    await Promise.allSettled(promises);
  }
}

export const channelRegistry = new ChannelRegistry();
