/**
 * 通道注册中心
 * 管理通道插件的注册、发现、生命周期
 * 对齐 OpenClaw channels/registry.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  IChannelPlugin,
  ChannelId,
  ChannelStatus,
} from '@modules/channels/types';

const logger = new Logger({ level: LogLevel.INFO });

export interface ChannelEntry {
  plugin: IChannelPlugin;
  config: Record<string, unknown>;
  connected: boolean;
  registeredAt: number;
}

export class ChannelRegistry {
  private channels: Map<ChannelId, ChannelEntry> = new Map();
  private configStore: Map<ChannelId, Record<string, unknown>> = new Map();

  register(plugin: IChannelPlugin): void {
    if (this.channels.has(plugin.id)) {
      logger.warning(`通道已注册，将被覆盖: ${plugin.id}`);
    }
    const storedConfig = this.configStore.get(plugin.id);
    const config = storedConfig || plugin.config.getDefaultConfig();
    this.channels.set(plugin.id, {
      plugin,
      config,
      connected: false,
      registeredAt: Date.now(),
    });
    logger.info(`通道已注册: ${plugin.id} (${plugin.meta.displayName})`);
  }

  unregister(id: ChannelId): boolean {
    const entry = this.channels.get(id);
    if (entry) {
      if (entry.connected) {
        entry.plugin.lifecycle.disconnect().catch((e: Error) => {
          logger.error(`通道 ${id} 断开失败`, e);
        });
      }
      this.channels.delete(id);
      logger.info(`通道已注销: ${id}`);
      return true;
    }
    return false;
  }

  get(id: ChannelId): ChannelEntry | undefined {
    return this.channels.get(id);
  }

  getPlugin(id: ChannelId): IChannelPlugin | undefined {
    return this.channels.get(id)?.plugin;
  }

  getAll(): ChannelEntry[] {
    return Array.from(this.channels.values());
  }

  getRegisteredIds(): ChannelId[] {
    return Array.from(this.channels.keys());
  }

  async connect(
    id: ChannelId,
    config?: Record<string, unknown>
  ): Promise<boolean> {
    const entry = this.channels.get(id);
    if (!entry) {
      logger.error(`通道未注册: ${id}`);
      return false;
    }
    if (entry.connected) {
      logger.warning(`通道已连接: ${id}`);
      return true;
    }
    try {
      if (config) {
        entry.config = { ...entry.config, ...config };
        this.configStore.set(id, entry.config);
      }
      await entry.plugin.lifecycle.connect(entry.config);
      entry.connected = true;
      logger.info(`通道已连接: ${id}`);
      return true;
    } catch (error) {
      logger.error(`通道连接失败: ${id}`, error as Error);
      return false;
    }
  }

  async disconnect(id: ChannelId): Promise<boolean> {
    const entry = this.channels.get(id);
    if (!entry || !entry.connected) {
      return false;
    }
    try {
      await entry.plugin.lifecycle.disconnect();
      entry.connected = false;
      logger.info(`通道已断开: ${id}`);
      return true;
    } catch (error) {
      logger.error(`通道断开失败: ${id}`, error as Error);
      return false;
    }
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.channels.keys()) {
      await this.disconnect(id);
    }
  }

  getStatus(id: ChannelId): ChannelStatus | undefined {
    const entry = this.channels.get(id);
    if (!entry) return undefined;
    return entry.plugin.lifecycle.getStatus();
  }

  getAllStatuses(): Array<{
    id: ChannelId;
    name: string;
    status: ChannelStatus;
  }> {
    return this.getAll().map((entry) => ({
      id: entry.plugin.id,
      name: entry.plugin.meta.displayName,
      status: entry.plugin.lifecycle.getStatus(),
    }));
  }

  getConnectedCount(): number {
    let count = 0;
    for (const [, entry] of this.channels) {
      if (entry.connected) count++;
    }
    return count;
  }

  isConnected(id: ChannelId): boolean {
    return this.channels.get(id)?.connected || false;
  }

  updateConfig(id: ChannelId, config: Record<string, unknown>): boolean {
    const entry = this.channels.get(id);
    if (!entry) return false;
    const validated = entry.plugin.config.validate(config);
    if (!validated.valid) {
      logger.warning(`通道配置无效: ${id} — ${validated.errors.join(', ')}`);
      return false;
    }
    entry.config = { ...entry.config, ...config };
    this.configStore.set(id, entry.config);
    return true;
  }
}

export const channelRegistry = new ChannelRegistry();
