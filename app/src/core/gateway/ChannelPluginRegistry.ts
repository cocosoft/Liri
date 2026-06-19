/**
 * ChannelPluginRegistry — 通道插件注册表
 * 管理所有 ChannelPlugin 的注册、查找和生命周期
 * 支持按 ID/类型/能力查询
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { ChannelPlugin } from './ChannelPlugin';
import { ChannelStatus } from './types';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'gateway:plugin_registry',
});

/** 注册表事件类型 */
export enum RegistryEvent {
  PLUGIN_REGISTERED = 'plugin_registered',
  PLUGIN_UNREGISTERED = 'plugin_unregistered',
  PLUGIN_CONNECTED = 'plugin_connected',
  PLUGIN_DISCONNECTED = 'plugin_disconnected',
  PLUGIN_ERROR = 'plugin_error',
}

/** 注册表事件回调 */
export interface RegistryCallbacks {
  onRegistered?: (plugin: ChannelPlugin) => void;
  onUnregistered?: (id: string) => void;
  onConnected?: (id: string) => void;
  onDisconnected?: (id: string, reason?: string) => void;
  onError?: (id: string, error: Error) => void;
}

/** 注册项 */
interface RegistryEntry {
  plugin: ChannelPlugin;
  registeredAt: number;
}

/**
 * 通道插件注册表
 * 单例模式 — 通过 getInstance() 获取全局实例
 */
export class ChannelPluginRegistry {
  private static instance: ChannelPluginRegistry;
  private plugins: Map<string, RegistryEntry> = new Map();
  private callbacks: RegistryCallbacks = {};
  private _totalRegistrations = 0;
  private _totalErrors = 0;

  private constructor() {}

  /** 获取全局单例 */
  static getInstance(): ChannelPluginRegistry {
    if (!ChannelPluginRegistry.instance) {
      ChannelPluginRegistry.instance = new ChannelPluginRegistry();
    }
    return ChannelPluginRegistry.instance;
  }

  /** 重置单例（仅测试用） */
  static resetInstance(): void {
    ChannelPluginRegistry.instance = new ChannelPluginRegistry();
  }

  /** 注册事件回调 */
  setCallbacks(callbacks: RegistryCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 注册通道插件
   * @throws 如果 ID 已存在则抛出错误
   */
  register(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new AppError(
        `通道插件已注册: ${plugin.id}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW
      );
    }

    const validation = plugin.validateConfig();
    if (!validation.valid) {
      throw new AppError(
        `通道插件配置验证失败 (${plugin.id}): ${validation.errors.join('; ')}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW
      );
    }

    this.plugins.set(plugin.id, {
      plugin,
      registeredAt: Date.now(),
    });

    this._totalRegistrations++;
    logger.info(`通道插件已注册: ${plugin.id}`);
    this.callbacks.onRegistered?.(plugin);
  }

  /**
   * 注销通道插件
   * 如果插件处于连接状态，会自动断开
   */
  async unregister(id: string): Promise<boolean> {
    const entry = this.plugins.get(id);
    if (!entry) {
      return false;
    }

    try {
      if (entry.plugin.status === ChannelStatus.CONNECTED) {
        await entry.plugin.disconnect();
      }
    } catch (error) {
      this._totalErrors++;
      await handleError(error, {
        module: 'gateway:plugin_registry',
        action: 'unregister_disconnect',
      });
    }

    this.plugins.delete(id);
    logger.info(`通道插件已注销: ${id}`);
    this.callbacks.onUnregistered?.(id);
    return true;
  }

  /** 按 ID 查找插件 */
  lookup(id: string): ChannelPlugin | undefined {
    return this.plugins.get(id)?.plugin;
  }

  /** 获取所有已注册插件 */
  getAll(): ChannelPlugin[] {
    return Array.from(this.plugins.values()).map((e) => e.plugin);
  }

  /** 获取已注册插件数量 */
  get count(): number {
    return this.plugins.size;
  }

  /** 检查插件是否已注册 */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /** 获取所有已连接插件的状态快照 */
  getStatusMap(): Record<string, ChannelStatus> {
    const statusMap: Record<string, ChannelStatus> = {};
    for (const [id, entry] of this.plugins) {
      statusMap[id] = entry.plugin.status;
    }
    return statusMap;
  }

  /** 连接所有已注册插件 */
  async connectAll(): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];

    const connectPromises = Array.from(this.plugins.entries()).map(
      async ([id, entry]) => {
        try {
          await entry.plugin.connect();
          success.push(id);
          this.callbacks.onConnected?.(id);
        } catch (error) {
          failed.push(id);
          this._totalErrors++;
          const err = error instanceof Error ? error : new Error(String(error));
          await handleError(error, {
            module: 'gateway:plugin_registry',
            action: 'connect_plugin',
            context: { pluginId: id },
          });
          this.callbacks.onError?.(id, err);
        }
      }
    );

    await Promise.all(connectPromises);
    return { success, failed };
  }

  /** 断开所有已注册插件 */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.plugins.entries()).map(
      async ([id, entry]) => {
        if (entry.plugin.status === ChannelStatus.CONNECTED) {
          try {
            await entry.plugin.disconnect();
            this.callbacks.onDisconnected?.(id);
          } catch (error) {
            this._totalErrors++;
            await handleError(error, {
              module: 'gateway:plugin_registry',
              action: 'disconnect_plugin',
              context: { pluginId: id },
            });
          }
        }
      }
    );

    await Promise.all(disconnectPromises);
  }

  /** 获取注册统计 */
  getStats(): {
    totalRegistrations: number;
    totalErrors: number;
    activeCount: number;
    idleCount: number;
    errorCount: number;
  } {
    let activeCount = 0;
    let idleCount = 0;
    let errorCount = 0;

    for (const [, entry] of this.plugins) {
      switch (entry.plugin.status) {
        case ChannelStatus.CONNECTED:
        case ChannelStatus.CONNECTING:
          activeCount++;
          break;
        case ChannelStatus.ERROR:
          errorCount++;
          break;
        default:
          idleCount++;
      }
    }

    return {
      totalRegistrations: this._totalRegistrations,
      totalErrors: this._totalErrors,
      activeCount,
      idleCount,
      errorCount,
    };
  }
}
