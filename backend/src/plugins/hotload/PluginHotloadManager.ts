/**
 * 插件热加载管理器
 */

import { watch, FSWatcher } from 'fs';
import { resolve } from 'path';
import { PluginManager } from './PluginManager';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件热加载事件类型
 */
export enum PluginHotloadEvent {
  ADDED = 'added',
  MODIFIED = 'modified',
  REMOVED = 'removed',
}

/**
 * 插件热加载事件
 */
export interface PluginHotloadEventData {
  type: PluginHotloadEvent;
  pluginName: string;
  pluginPath: string;
  timestamp: number;
}

/**
 * 插件热加载监听器
 */
export type PluginHotloadListener = (
  event: PluginHotloadEventData
) => void | Promise<void>;

/**
 * 插件热加载配置
 */
export interface HotloadConfig {
  enabled: boolean;
  debounceMs: number;
  watchSubdirectories: boolean;
}

/**
 * 插件热加载管理器
 */
export class PluginHotloadManager {
  private watcher: FSWatcher | null = null;
  private listeners: Set<PluginHotloadListener> = new Set();
  private pluginManager: PluginManager | null = null;
  private config: HotloadConfig;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pluginPaths: Map<string, string> = new Map();

  constructor(config: Partial<HotloadConfig> = {}) {
    this.config = {
      enabled: true,
      debounceMs: 500,
      watchSubdirectories: true,
      ...config,
    };
  }

  /**
   * 初始化热加载管理器
   * @param pluginManager 插件管理器
   */
  async initialize(pluginManager: PluginManager): Promise<void> {
    this.pluginManager = pluginManager;

    if (!this.config.enabled) {
      return;
    }

    await this.startWatching();
  }

  /**
   * 启动文件监听
   */
  private async startWatching(): Promise<void> {
    if (!this.pluginManager) {
      throw new Error('PluginManager not initialized');
    }

    const pluginDir = this.getPluginDirectory();
    if (!pluginDir) {
      logger.warning('Plugin directory not found, hotload disabled');
      return;
    }

    try {
      this.watcher = watch(
        pluginDir,
        { recursive: this.config.watchSubdirectories },
        (eventType, filename) => {
          if (filename) {
            this.handleFileChange(eventType, filename);
          }
        }
      );

      this.watcher.on('error', (error) => {
        logger.error('Hotload watcher error:', { error });
      });

      logger.info(`Hotload enabled, watching: ${pluginDir}`);
    } catch (error) {
      logger.error('Failed to start hotload watcher:', { error });
    }
  }

  /**
   * 处理文件变化
   * @param eventType 事件类型
   * @param filename 文件名
   */
  private handleFileChange(eventType: string, filename: string): void {
    const fullPath = resolve(this.getPluginDirectory() || '', filename);
    const pluginName = this.extractPluginName(filename);

    if (!pluginName) {
      return;
    }

    const eventTypeMapped =
      eventType === 'rename'
        ? PluginHotloadEvent.MODIFIED
        : PluginHotloadEvent.MODIFIED;
    const event: PluginHotloadEventData = {
      type: eventTypeMapped,
      pluginName,
      pluginPath: fullPath,
      timestamp: Date.now(),
    };

    this.debounce(pluginName, () => {
      this.notifyListeners(event);
    });
  }

  /**
   * 防抖处理
   * @param key 键
   * @param callback 回调
   */
  private debounce(key: string, callback: () => void): void {
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      callback();
    }, this.config.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * 提取插件名称
   * @param filename 文件名
   * @returns 插件名称
   */
  private extractPluginName(filename: string): string | null {
    const parts = filename.split(/[/\\]/);
    if (parts.length >= 2) {
      return parts[0];
    }
    return null;
  }

  /**
   * 获取插件目录
   * @returns 插件目录路径
   */
  private getPluginDirectory(): string | null {
    return process.env.PLUGIN_DIR || './plugins';
  }

  /**
   * 通知监听器
   * @param event 事件数据
   */
  private async notifyListeners(event: PluginHotloadEventData): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        logger.error('Hotload listener error:', { error });
      }
    }
  }

  /**
   * 注册监听器
   * @param listener 监听器函数
   */
  addListener(listener: PluginHotloadListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除监听器
   * @param listener 监听器函数
   */
  removeListener(listener: PluginHotloadListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 重新加载插件
   * @param pluginName 插件名称
   */
  async reloadPlugin(pluginName: string): Promise<void> {
    if (!this.pluginManager) {
      return;
    }

    try {
      await this.pluginManager.reloadPlugin(pluginName);
      logger.info(`Plugin reloaded: ${pluginName}`);
    } catch (error) {
      logger.error(`Failed to reload plugin ${pluginName}:`, { error });
    }
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * 获取配置
   * @returns 热加载配置
   */
  getConfig(): HotloadConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<HotloadConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 热加载管理器单例
 */
let hotloadManagerInstance: PluginHotloadManager | null = null;

export function getHotloadManager(): PluginHotloadManager {
  if (!hotloadManagerInstance) {
    hotloadManagerInstance = new PluginHotloadManager();
  }
  return hotloadManagerInstance;
}
