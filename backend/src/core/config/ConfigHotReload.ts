import { EventEmitter } from 'events';
import { watch, FSWatcher } from 'fs';
import { existsSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { logger } from '../../utils/log.js';

/**
 * 配置变更事件
 */
export interface ConfigChangeEvent {
  /** 变更的文件路径 */
  filePath: string;
  /** 变更类型 */
  changeType: 'change' | 'delete' | 'add';
  /** 变更时间戳 */
  timestamp: number;
}

/**
 * 配置监听器类型
 */
export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

/**
 * 配置热更新配置
 */
export interface ConfigHotReloadConfig {
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否启用内部写入检测 */
  enableInternalWriteDetection?: boolean;
  /** 内部写入窗口（毫秒） */
  internalWriteWindowMs?: number;
}

/**
 * 配置热更新服务
 * 
 * 基于CC源码的文件监听机制实现，提供配置文件变更检测和通知功能。
 * 支持防抖、内部写入检测、订阅/通知模式。
 */
export class ConfigHotReload extends EventEmitter {
  private static instance: ConfigHotReload;

  private watchers: Map<string, FSWatcher>;
  private listeners: Set<ConfigChangeListener>;
  private config: Required<ConfigHotReloadConfig>;
  private internalWrites: Map<string, number>;
  private debounceTimers: Map<string, NodeJS.Timeout>;
  private isRunning: boolean;

  private constructor(config?: ConfigHotReloadConfig) {
    super();
    this.watchers = new Map();
    this.listeners = new Set();
    this.config = {
      debounceMs: config?.debounceMs ?? 1000,
      enableInternalWriteDetection: config?.enableInternalWriteDetection ?? true,
      internalWriteWindowMs: config?.internalWriteWindowMs ?? 5000,
    };
    this.internalWrites = new Map();
    this.debounceTimers = new Map();
    this.isRunning = false;
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: ConfigHotReloadConfig): ConfigHotReload {
    if (!ConfigHotReload.instance) {
      ConfigHotReload.instance = new ConfigHotReload(config);
    }
    return ConfigHotReload.instance;
  }

  /**
   * 重置单例实例（用于测试）
   */
  static resetInstance(): void {
    if (ConfigHotReload.instance) {
      ConfigHotReload.instance.stop();
      ConfigHotReload.instance = undefined as any;
    }
  }

  /**
   * 开始监听配置文件
   * @param filePath 配置文件路径
   */
  watch(filePath: string): void {
    const resolvedPath = resolve(filePath);

    if (this.watchers.has(resolvedPath)) {
      logger.warn(`Already watching: ${resolvedPath}`);
      return;
    }

    if (!existsSync(resolvedPath)) {
      // 如果文件不存在，监听其父目录
      const parentDir = dirname(resolvedPath);
      if (!existsSync(parentDir)) {
        logger.warn(`Parent directory does not exist: ${parentDir}`);
        return;
      }
      this.watchDirectory(parentDir, resolvedPath);
    } else {
      this.watchFile(resolvedPath);
    }

    logger.debug(`Started watching: ${resolvedPath}`);
  }

  /**
   * 停止监听配置文件
   * @param filePath 配置文件路径
   */
  unwatch(filePath: string): void {
    const resolvedPath = resolve(filePath);
    const watcher = this.watchers.get(resolvedPath);

    if (watcher) {
      watcher.close();
      this.watchers.delete(resolvedPath);
      logger.debug(`Stopped watching: ${resolvedPath}`);
    }
  }

  /**
   * 停止所有监听
   */
  stop(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      logger.debug(`Stopped watching: ${path}`);
    }
    this.watchers.clear();

    // 清除所有防抖定时器
    for (const [path, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.isRunning = false;
  }

  /**
   * 订阅配置变更事件
   * @param listener 监听器函数
   */
  subscribe(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 标记内部写入（避免触发变更通知）
   * @param filePath 文件路径
   */
  markInternalWrite(filePath: string): void {
    if (!this.config.enableInternalWriteDetection) {
      return;
    }

    const resolvedPath = resolve(filePath);
    this.internalWrites.set(resolvedPath, Date.now());

    logger.debug(`Marked internal write: ${resolvedPath}`);
  }

  /**
   * 检查是否为内部写入
   * @param filePath 文件路径
   */
  private isInternalWrite(filePath: string): boolean {
    if (!this.config.enableInternalWriteDetection) {
      return false;
    }

    const resolvedPath = resolve(filePath);
    const lastWriteTime = this.internalWrites.get(resolvedPath);

    if (!lastWriteTime) {
      return false;
    }

    const elapsed = Date.now() - lastWriteTime;
    if (elapsed > this.config.internalWriteWindowMs) {
      this.internalWrites.delete(resolvedPath);
      return false;
    }

    return true;
  }

  /**
   * 监听单个文件
   */
  private watchFile(filePath: string): void {
    try {
      const watcher = watch(filePath, (eventType: string) => {
        this.handleFileChange(filePath, eventType === 'rename' ? 'delete' : 'change');
      });

      this.watchers.set(filePath, watcher);
    } catch (error) {
      logger.error(`Failed to watch file: ${filePath}`, error);
    }
  }

  /**
   * 监听目录以检测文件变更
   */
  private watchDirectory(dirPath: string, targetFile: string): void {
    try {
      const watcher = watch(dirPath, (eventType: string, filename: string | null) => {
        if (!filename) {
          return;
        }

        const fullPath = resolve(dirPath, filename);
        if (fullPath === targetFile) {
          const changeType = eventType === 'rename'
            ? (existsSync(fullPath) ? 'add' : 'delete')
            : 'change';
          this.handleFileChange(fullPath, changeType);
        }
      });

      this.watchers.set(targetFile, watcher);
    } catch (error) {
      logger.error(`Failed to watch directory: ${dirPath}`, error);
    }
  }

  /**
   * 处理文件变更
   */
  private handleFileChange(filePath: string, changeType: 'change' | 'delete' | 'add'): void {
    // 检查是否为内部写入
    if (this.isInternalWrite(filePath)) {
      logger.debug(`Ignoring internal write: ${filePath}`);
      return;
    }

    // 防抖处理
    this.debounceChange(filePath, changeType);
  }

  /**
   * 防抖处理文件变更
   */
  private debounceChange(filePath: string, changeType: 'change' | 'delete' | 'add'): void {
    // 清除之前的定时器
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置新的定时器
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.notifyListeners(filePath, changeType);
    }, this.config.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(filePath: string, changeType: 'change' | 'delete' | 'add'): void {
    const event: ConfigChangeEvent = {
      filePath,
      changeType,
      timestamp: Date.now(),
    };

    // 通知订阅者
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error(`Error in config change listener:`, error);
      }
    }

    // 触发事件
    this.emit('change', event);

    logger.debug(`Config change notified: ${filePath} (${changeType})`);
  }

  /**
   * 获取当前监听的文件列表
   */
  getWatchedFiles(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * 获取监听器数量
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * 获取服务状态
   */
  getStatus(): {
    isRunning: boolean;
    watchedFiles: string[];
    listenerCount: number;
    pendingChanges: number;
  } {
    return {
      isRunning: this.isRunning,
      watchedFiles: this.getWatchedFiles(),
      listenerCount: this.getListenerCount(),
      pendingChanges: this.debounceTimers.size,
    };
  }
}
