/**
 * 插件热加载管理器
 * 监听插件目录文件变更，自动触发插件的卸载→加载→激活流水线
 * 支持状态备份和回滚，重载失败时恢复旧状态
 */

import { watch, FSWatcher, existsSync } from 'fs';
import { resolve, extname, basename } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { PluginState } from '../types/PluginTypes';
import { pluginManager } from '../PluginManager';

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
  /** 监听的扩展名列表，空数组表示监听所有文件 */
  watchExtensions: string[];
  /** 是否自动重载（变化时自动触发 reload 流水线） */
  autoReload: boolean;
}

/** 默认监听的插件文件扩展名 */
const DEFAULT_WATCH_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.json'];

/**
 * 插件状态快照，用于重载失败时回滚
 */
interface PluginStateSnapshot {
  state: PluginState;
  instance: unknown | undefined;
  error: string | undefined;
}

/**
 * 插件热加载管理器
 */
export class PluginHotloadManager {
  private watcher: FSWatcher | null = null;
  private listeners: Set<PluginHotloadListener> = new Set();
  private config: HotloadConfig;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  /** 已知插件路径映射：pluginName → 插件目录绝对路径 */
  private pluginPaths: Map<string, string> = new Map();
  /** 状态备份：重载前保存，失败时回滚 */
  private stateBackup: Map<string, PluginStateSnapshot> = new Map();

  constructor(config: Partial<HotloadConfig> = {}) {
    this.config = {
      enabled: true,
      debounceMs: 500,
      watchSubdirectories: true,
      watchExtensions: DEFAULT_WATCH_EXTENSIONS,
      autoReload: true,
      ...config,
    };
  }

  /**
   * 初始化热加载管理器
   * @param pluginManager 插件管理器
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Hotload disabled by config');
      return;
    }

    await this.startWatching();
  }

  /**
   * 启动文件监听
   */
  private async startWatching(): Promise<void> {
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
   * @param eventType 事件类型：'rename'（新建/删除）或 'change'（修改）
   * @param filename 相对路径文件名
   */
  private handleFileChange(eventType: string, filename: string): void {
    const pluginDir = this.getPluginDirectory();
    if (!pluginDir) return;

    const fullPath = resolve(pluginDir, filename);
    const ext = extname(filename).toLowerCase();

    // 按扩展名过滤
    const exts = this.config.watchExtensions;
    if (exts.length > 0 && !exts.includes(ext)) {
      return;
    }

    const pluginName = this.extractPluginName(filename);
    if (!pluginName) return;

    // 正确映射事件类型：rename 需要检查文件是否存在来区分 ADDED/REMOVED
    let mappedType: PluginHotloadEvent;
    if (eventType === 'rename') {
      mappedType = existsSync(fullPath)
        ? PluginHotloadEvent.ADDED
        : PluginHotloadEvent.REMOVED;
    } else {
      mappedType = PluginHotloadEvent.MODIFIED;
    }

    const event: PluginHotloadEventData = {
      type: mappedType,
      pluginName,
      pluginPath: fullPath,
      timestamp: Date.now(),
    };

    this.debounce(pluginName, () => {
      this.processEvent(event);
    });
  }

  /**
   * 处理已防抖的事件：通知监听器 + 自动重载
   */
  private async processEvent(event: PluginHotloadEventData): Promise<void> {
    // 1. 通知外部监听器
    await this.notifyListeners(event);

    // 2. 按事件类型执行自动操作
    switch (event.type) {
      case PluginHotloadEvent.MODIFIED:
        if (this.config.autoReload && this.pluginPaths.has(event.pluginName)) {
          await this.reloadPlugin(event.pluginName);
        }
        break;
      case PluginHotloadEvent.ADDED:
        this.pluginPaths.set(
          event.pluginName,
          this.getPluginDirFromPath(event.pluginPath)
        );
        break;
      case PluginHotloadEvent.REMOVED:
        this.pluginPaths.delete(event.pluginName);
        break;
    }
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
   * 从文件相对路径中提取插件名称（首段目录名）
   * @param filename 相对路径，如 "my-plugin/index.js"
   * @returns 插件名称，如 "my-plugin"
   */
  private extractPluginName(filename: string): string | null {
    const parts = filename.split(/[/\\]/);
    if (parts.length >= 1 && parts[0].length > 0) {
      return parts[0];
    }
    return null;
  }

  /**
   * 从文件路径获取插件目录路径
   */
  private getPluginDirFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    const pluginDir = this.getPluginDirectory() || '';
    // 如果文件路径包含插件名子目录，返回插件根目录
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === basename(pluginDir)) {
        return parts.slice(0, i + 1).join('/');
      }
    }
    return filePath;
  }

  /**
   * 获取插件目录
   * @returns 插件目录绝对路径
   */
  private getPluginDirectory(): string | null {
    const envDir = process.env.PLUGIN_DIR;
    if (envDir) {
      return resolve(envDir);
    }
    return resolve(process.cwd(), 'plugins');
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
   * 跟踪插件路径（供 PluginManager 加载完成后调用）
   * @param pluginName 插件名称
   * @param pluginDir 插件目录
   */
  trackPluginPath(pluginName: string, pluginDir: string): void {
    this.pluginPaths.set(pluginName, pluginDir);
    logger.info(`Tracking plugin path: ${pluginName} → ${pluginDir}`);
  }

  /**
   * 停止跟踪插件路径
   * @param pluginName 插件名称
   */
  untrackPluginPath(pluginName: string): void {
    this.pluginPaths.delete(pluginName);
  }

  /**
   * 重新加载插件：停用→备份状态→卸载→加载→激活
   * 任何步骤失败则回滚到备份状态
   * @param pluginName 插件名称
   */
  async reloadPlugin(pluginName: string): Promise<void> {
    // 1. 检查插件当前是否存在
    if (!pluginManager.hasPlugin(pluginName)) {
      logger.warning(`Cannot reload unknown plugin: ${pluginName}`);
      return;
    }

    // 2. 备份当前状态用于回滚
    const currentPlugin = pluginManager.getPlugin(pluginName);
    if (currentPlugin) {
      this.stateBackup.set(pluginName, {
        state: currentPlugin.state,
        instance: currentPlugin.instance,
        error: currentPlugin.error,
      });
    }

    const reloadLog = { pluginName, startedAt: Date.now() };

    try {
      // 3. 执行 reload（内部处理停用→卸载→加载→激活）
      await pluginManager.reloadPlugin(pluginName);

      // 清除备份（重载成功）
      this.stateBackup.delete(pluginName);

      logger.info(`✅ Plugin hot-reloaded successfully: ${pluginName}`, {
        durationMs: Date.now() - reloadLog.startedAt,
      });
    } catch (error) {
      // 4. 回滚：恢复备份状态
      await this.rollbackPlugin(pluginName);

      logger.error(`❌ Plugin hot-reload failed, rolled back: ${pluginName}`, {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - reloadLog.startedAt,
      });
    }
  }

  /**
   * 回滚插件到重载前的状态
   * @param pluginName 插件名称
   */
  private async rollbackPlugin(pluginName: string): Promise<void> {
    const snapshot = this.stateBackup.get(pluginName);
    if (!snapshot) {
      logger.warning(`No backup state found for rollback: ${pluginName}`);
      return;
    }

    try {
      // 检查插件是否还在，不在则尝试重新加载
      if (!pluginManager.hasPlugin(pluginName)) {
        await pluginManager.loadPlugin(pluginName);
      }

      // 如果旧状态是激活的，重新激活
      if (snapshot.state === 'activated' || snapshot.state === 'enabled') {
        pluginManager.enablePlugin(pluginName);
      }

      logger.info(`Plugin rolled back: ${pluginName}`);
    } catch (rollbackError) {
      logger.error(`Rollback failed for plugin ${pluginName}:`, {
        error:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      });
    } finally {
      this.stateBackup.delete(pluginName);
    }
  }

  /**
   * 获取当前跟踪的插件列表
   * @returns 插件名称数组
   */
  getTrackedPlugins(): string[] {
    return Array.from(this.pluginPaths.keys());
  }

  /**
   * 检查插件是否正在被跟踪
   * @param pluginName 插件名称
   */
  isTracking(pluginName: string): boolean {
    return this.pluginPaths.has(pluginName);
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
    this.pluginPaths.clear();
    this.stateBackup.clear();
    this.listeners.clear();

    logger.info('Hotload watcher stopped');
  }

  /**
   * 获取配置
   * @returns 热加载配置副本
   */
  getConfig(): HotloadConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   * @param config 部分配置
   */
  updateConfig(config: Partial<HotloadConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 热加载管理器单例
 */
let hotloadManagerInstance: PluginHotloadManager | null = null;

/**
 * 获取热加载管理器单例
 */
export function getHotloadManager(): PluginHotloadManager {
  if (!hotloadManagerInstance) {
    hotloadManagerInstance = new PluginHotloadManager();
  }
  return hotloadManagerInstance;
}

/**
 * 重置热加载管理器单例（仅测试用）
 */
export function resetHotloadManager(): void {
  if (hotloadManagerInstance) {
    hotloadManagerInstance.stop();
    hotloadManagerInstance = null;
  }
}
