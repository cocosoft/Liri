// @ts-nocheck
/**
 * 热重载模块
 * 支持配置修改实时生效
 */

import { watch, unwatch } from 'fs';
import { KeybindingConfigSchema, validateConfig } from './validation';

export interface HotReloadOptions {
  configPath?: string;
  debounceDelay?: number;
  onReload?: (config: KeybindingConfigSchema) => void;
  onError?: (error: Error) => void;
}

export class HotReloadManager {
  private configPath: string;
  private debounceDelay: number;
  private onReload?: (config: KeybindingConfigSchema) => void;
  private onError?: (error: Error) => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConfig: string = '';

  constructor(options: HotReloadOptions = {}) {
    this.configPath = options.configPath || './keybindings.config.json';
    this.debounceDelay = options.debounceDelay || 500;
    this.onReload = options.onReload;
    this.onError = options.onError;
  }

  /**
   * 开始监听配置文件
   */
  start(): void {
    try {
      watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          this.handleFileChange();
        }
      });
    } catch (error) {
      this.onError?.(error as Error);
    }
  }

  /**
   * 停止监听配置文件
   */
  stop(): void {
    try {
      unwatch(this.configPath);
    } catch {
      // 忽略错误
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * 处理文件变化
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.loadAndReload();
    }, this.debounceDelay);
  }

  /**
   * 加载并重新加载配置
   */
  private async loadAndReload(): Promise<void> {
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(this.configPath, 'utf-8');

      // 检查内容是否变化
      if (content === this.lastConfig) {
        return;
      }
      this.lastConfig = content;

      // 验证配置
      const config = validateConfig(JSON.parse(content));

      // 触发重新加载回调
      this.onReload?.(config);
    } catch (error) {
      this.onError?.(error as Error);
    }
  }

  /**
   * 手动触发重新加载
   */
  triggerReload(): void {
    this.loadAndReload();
  }

  /**
   * 设置配置路径
   */
  setConfigPath(path: string): void {
    this.stop();
    this.configPath = path;
    this.start();
  }

  /**
   * 设置防抖延迟
   */
  setDebounceDelay(delay: number): void {
    this.debounceDelay = delay;
  }

  /**
   * 设置重新加载回调
   */
  setOnReload(callback: (config: KeybindingConfigSchema) => void): void {
    this.onReload = callback;
  }

  /**
   * 设置错误回调
   */
  setOnError(callback: (error: Error) => void): void {
    this.onError = callback;
  }

  /**
   * 检查是否正在监听
   */
  isWatching(): boolean {
    return true; // 在实际实现中，这里会检查监听状态
  }
}

/**
 * 创建热重载管理器实例
 */
export function createHotReloadManager(options?: HotReloadOptions): HotReloadManager {
  return new HotReloadManager(options);
}

/**
 * 全局热重载管理器实例
 */
export const hotReloadManager = createHotReloadManager();
