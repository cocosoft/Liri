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
 *
 * 持久化：通过 channel_configs 表将配置（name/enabled/options）存入 app.db，
 * 重启后自动恢复。
 */

import { EventEmitter } from 'events';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { ChannelPluginRegistry } from '../../core/gateway/ChannelPluginRegistry';
import type { ChannelPlugin } from '../../core/gateway/ChannelPlugin';
import { ChannelStatus } from '../../core/gateway/types';
import type { IChannelPlugin } from '../types/IChannel';
import { channelEventBus, ChannelEvents } from '../events/ChannelEventBus';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'channels:registry',
});

/**
 * 通道出站适配器接口
 * 用于 DeliveryRouter._sendWithFallback 的统一发送入口
 */
export interface ChannelOutbound {
  sendText(target: string, content: string): Promise<boolean>;
  sendMarkdown?(target: string, content: string): Promise<boolean>;
  sendInteractive?(
    target: string,
    content: string,
    card: Record<string, unknown>
  ): Promise<boolean>;
}

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
    outbound: ChannelOutbound;
  };
}

/**
 * 将 IChannelPlugin 适配为 ChannelInterface
 * connect 时自动从 ChannelSecretStore 注入已存储的凭据
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
      // 从统一凭据存储获取该通道的所有已保存配置（DB 优先，.env 兜底）
      const { ChannelSecretStore } =
        await import('../secrets/ChannelSecretStore');
      const store = ChannelSecretStore.getInstance();
      const credentials = store.get(plugin.id);
      await plugin.lifecycle.connect(credentials);
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
        sendText: async (target: string, content: string) => {
          const result = await plugin.outbound.sendText(target, content);
          return result.success;
        },
        ...(typeof (plugin.outbound as unknown as Record<string, unknown>)
          .sendMarkdown === 'function'
          ? {
              sendMarkdown: async (target: string, content: string) => {
                const result = (await (
                  plugin.outbound as unknown as Record<string, Function>
                ).sendMarkdown(target, content)) as { success: boolean };
                return result.success;
              },
            }
          : {}),
        ...(typeof (plugin.outbound as unknown as Record<string, unknown>)
          .sendInteractive === 'function'
          ? {
              sendInteractive: async (
                target: string,
                content: string,
                card: Record<string, unknown>
              ) => {
                const result = (await (
                  plugin.outbound as unknown as Record<string, Function>
                ).sendInteractive(target, content, card)) as {
                  success: boolean;
                };
                return result.success;
              },
            }
          : {}),
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
export function adaptPluginToChannelInterface(
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
      } catch (err) {
        await handleError(err, {
          module: 'channels:registry',
          action: 'connect',
          context: { pluginId: plugin.id },
        });
        return false;
      }
    },
    disconnect: async () => {
      try {
        await plugin.disconnect();
      } catch (err) {
        await handleError(err, {
          module: 'channels:registry',
          action: 'disconnect',
          context: { pluginId: plugin.id },
        });
      }
    },
    sendMessage: async (_target: string, text: string) => {
      // 尝试使用 outbound 属性（部分 ChannelPlugin 实现可能包含）
      const pluginWithOutbound = plugin as unknown as {
        outbound?: {
          sendText(
            target: string,
            message: string
          ): Promise<{ success: boolean }>;
        };
      };
      if (pluginWithOutbound.outbound?.sendText) {
        const result = await pluginWithOutbound.outbound.sendText(
          _target,
          text
        );
        return result.success;
      }
      // 兜底：ChannelPlugin 无 outbound 属性，发送能力由 ChannelManager 补充
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

  // ─── 持久化 ────────────────────────────────────────────
  private db: Database | null = null;
  private readonly dbPath: string;
  private persistenceReady = false;

  constructor(dbPath: string = resolveDbPath()) {
    super();
    this.dbPath = dbPath;
  }

  /**
   * 初始化持久化（异步，在应用启动时调用）
   * 创建表 + 加载已保存的配置
   */
  async initPersistence(): Promise<void> {
    if (this.persistenceReady) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTable();
    await this.loadSavedConfigs();

    // 迁移：归一化通道名称为小写（消除大小写不一致导致的重复行）
    this.db!.run(
      `UPDATE channel_configs SET name = LOWER(name) WHERE name != LOWER(name)`
    );

    this.persistenceReady = true;
  }

  /**
   * 设置主动同步：订阅 ChannelPluginRegistry 事件，实时同步到本地缓存
   *
   * 替代之前仅在 getAll() 时被动调用的 syncFromPluginRegistry()。
   * 插件状态变更（注册/注销/连接/断开/错误）→ 立即反映到 ChannelRegistry。
   */
  setupActiveSync(): void {
    const registry = ChannelPluginRegistry.getInstance();

    registry.setCallbacks({
      onRegistered: (plugin: ChannelPlugin) => {
        const name = plugin.id;
        if (!this.channels.has(name)) {
          const adapted = adaptPluginToChannelInterface(plugin);
          this.channels.set(name, adapted);
          logger.debug(`主动同步: 插件已注册 ${name}`);
        }
      },

      onUnregistered: (id: string) => {
        if (this.channels.has(id)) {
          this.channels.delete(id);
          logger.debug(`主动同步: 插件已注销 ${id}`);
        }
      },

      onConnected: (id: string) => {
        const cached = this.channels.get(id);
        if (cached) {
          const plugin = registry.lookup(id);
          if (plugin) {
            const adapted = adaptPluginToChannelInterface(plugin);
            this.channels.set(id, adapted);
            logger.debug(`主动同步: 插件已连接 ${id}`);
          }
        }
      },

      onDisconnected: (id: string) => {
        const cached = this.channels.get(id);
        if (cached) {
          const plugin = registry.lookup(id);
          if (plugin) {
            const adapted = adaptPluginToChannelInterface(plugin);
            this.channels.set(id, adapted);
            logger.debug(`主动同步: 插件已断开 ${id}`);
          }
        }
      },

      onError: (id: string, error: Error) => {
        void handleError(error, {
          module: 'channels:registry',
          action: 'syncOnError',
          context: { pluginId: id },
        });
        const plugin = registry.lookup(id);
        if (plugin) {
          const adapted = adaptPluginToChannelInterface(plugin);
          this.channels.set(id, adapted);
        }
      },
    });

    logger.info('主动同步已启用: ChannelPluginRegistry → ChannelRegistry');
  }

  /** 创建 channel_configs 表 */
  private createTable(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS channel_configs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          options TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL DEFAULT 0
        )`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  /** 从 DB 加载已保存的配置到内存 */
  private loadSavedConfigs(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT id, name, type, enabled, options FROM channel_configs',
        (
          err: Error | null,
          rows: Array<{
            id: string;
            name: string;
            type: string;
            enabled: number;
            options: string;
          }>
        ) => {
          if (err) {
            reject(err);
            return;
          }

          for (const row of rows) {
            let options: Record<string, unknown> = {};
            try {
              options = JSON.parse(row.options || '{}');
            } catch (err) {
              handleError(err, {
                module: 'channels:registry',
                action: 'loadSavedConfigs',
                context: { rowType: row.type, rowName: row.name },
              });
            }

            // 用 type（通道标识，如 "qq"）作为 key，而非自增 id
            const key = (row.type || row.name).toLowerCase();

            // 若因历史数据重复（同一 key 多行），保留含凭据的配置
            const existing = this.configs.get(key);
            if (
              existing &&
              Object.keys(existing.options).length > 0 &&
              Object.keys(options).length === 0
            ) {
              continue;
            }

            this.configs.set(key, {
              name: row.name,
              type: row.type || row.id,
              enabled: row.enabled === 1,
              options,
            });
          }
          resolve();
        }
      );
    });
  }

  /** 持久化单条配置（UPSERT）— 返回 true 表示写入成功，false 表示写入失败 */
  private persistConfig(config: ChannelConfig): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.db || !this.persistenceReady) {
        resolve(false);
        return;
      }
      const { type, name, enabled, options } = config;
      const optionsJson = JSON.stringify(options || {});

      this.db!.run(
        `INSERT INTO channel_configs (id, name, type, enabled, options, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           type = excluded.type,
           enabled = excluded.enabled,
           options = excluded.options,
           updated_at = excluded.updated_at`,
        [type, name, type, enabled ? 1 : 0, optionsJson, Date.now()],
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'channels:registry',
              action: `持久化通道配置失败: ${type}`,
              context: { config },
            });
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  /** 从 DB 删除单条配置 — 返回 true 表示删除成功 */
  private deletePersistedConfig(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.db || !this.persistenceReady) {
        resolve(false);
        return;
      }
      this.db!.run(
        'DELETE FROM channel_configs WHERE name = ?',
        [id],
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'channels:registry',
              action: `删除持久化通道配置失败: ${id}`,
            });
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  /** 同步当前的全部内存配置到 DB — 返回成功写入的数量 */
  private async syncAllToDb(): Promise<number> {
    if (!this.db || !this.persistenceReady) return 0;
    let successCount = 0;
    for (const config of this.configs.values()) {
      const ok = await this.persistConfig(config);
      if (ok) successCount++;
    }
    if (successCount < this.configs.size) {
      logger.warning(
        `同步配置到 DB 不完全: ${successCount}/${this.configs.size}`
      );
    }
    return successCount;
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
   * 内存更新始终成功；DB 持久化失败时记录警告但不阻止通道运行
   */
  register(channel: ChannelInterface | IChannelPlugin): void {
    let adapted: ChannelInterface;

    if ('lifecycle' in channel && 'outbound' in channel) {
      adapted = adaptPluginToInterface(channel as IChannelPlugin);
    } else {
      adapted = channel as ChannelInterface;
    }

    // 去重守卫：检查是否为重复注册（相同名称、相同类型）
    const existing = this.channels.get(adapted.name);
    const isDuplicate = existing && existing.type === adapted.type;

    this.channels.set(adapted.name, adapted);

    // 检查是否已有持久化的配置（从 DB 加载），有则保留，避免覆盖用户已保存的凭据
    const existingConfig = this.configs.get(adapted.name);
    if (!existingConfig) {
      const config: ChannelConfig = {
        name: adapted.name,
        type: adapted.type,
        enabled: adapted.enabled,
        options: {},
      };
      this.configs.set(adapted.name, config);

      // 异步持久化（不阻塞调用者，失败时自动记录错误日志）
      this.persistConfig(config).then((ok) => {
        if (!ok) {
          logger.warning(
            `注册通道 ${adapted.name}: 内存已更新但 DB 持久化失败`
          );
        }
      });
    }

    // 仅首次注册时发出事件，避免双重注册路径（ChannelManager + ChannelPluginRegistry 同步）产生重复事件
    if (!isDuplicate) {
      this.emit('channel:registered', {
        name: adapted.name,
        type: adapted.type,
      });
      channelEventBus.publish(ChannelEvents.CHANNEL_REGISTERED, {
        name: adapted.name,
        type: adapted.type,
      });
    }
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

      // 异步删除持久化配置（不阻塞调用者，失败时自动记录错误日志）
      this.deletePersistedConfig(name).then((deleted) => {
        if (!deleted) {
          logger.warning(`注销通道 ${name}: 内存已更新但 DB 删除失败`);
        }
      });

      this.emit('channel:unregistered', { name });
      channelEventBus.publish(ChannelEvents.CHANNEL_UNREGISTERED, { name });

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
   * 内存更新始终成功；DB 持久化失败时记录警告但不阻止调用方继续
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

    // 异步持久化（不阻塞调用者，失败时自动记录错误日志）
    this.persistConfig(config).then((ok) => {
      if (!ok) {
        logger.warning(`更新通道配置 ${name}: 内存已更新但 DB 持久化失败`);
      }
    });

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
      } catch (err) {
        await handleError(err, {
          module: 'channels:registry',
          action: 'broadcast',
          context: { channel: channel.name },
        });
        results.push({ channel: channel.name, success: false });
      }
    }

    return results;
  }

  async sendToHomeChannel(name: string, text: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel || !channel.enabled) return false;

    const target = channel.homeChannelId || '';
    const result = await channel.sendMessage(target, text);

    return result;
  }

  async sendThreadReply(
    name: string,
    threadId: string,
    text: string
  ): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel || !channel.supportsThreads || !channel.sendThreadMessage)
      return false;

    const target = channel.homeChannelId || '';
    const result = await channel.sendThreadMessage(target, threadId, text);

    return result;
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
