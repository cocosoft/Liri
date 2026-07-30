/**
 * 目录监控器
 * 实现文件系统监控和热加载
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ module: 'agent:directoryWatcher' });

export type WatchEventType = 'add' | 'change' | 'unlink';

export interface WatchEvent {
  type: WatchEventType;
  filePath: string;
  fileName: string;
}

export type WatchCallback = (event: WatchEvent) => void;

export class DirectoryWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private callbacks: WatchCallback[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceDelay: number;

  constructor(debounceDelay: number = 1000) {
    this.debounceDelay = debounceDelay;
  }

  /**
   * 监控目录
   */
  watchDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      // 如果目录不存在，尝试创建
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch {
        logger.warning('Cannot create or watch directory', { dirPath });
        return;
      }
    }

    if (this.watchers.has(dirPath)) {
      return; // 已经在监控
    }

    const watcher = fs.watch(dirPath, (eventType, fileName) => {
      if (!fileName) {
        return;
      }

      const filePath = path.join(dirPath, fileName);

      // 使用防抖避免频繁触发
      const key = `${dirPath}-${fileName}`;
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key)!);
      }

      this.debounceTimers.set(
        key,
        setTimeout(() => {
          this.debounceTimers.delete(key);

          // 确定事件类型
          let eventTypeNormalized: WatchEventType;
          if (eventType === 'rename') {
            // 检查文件是否存在
            if (fs.existsSync(filePath)) {
              eventTypeNormalized = 'add';
            } else {
              eventTypeNormalized = 'unlink';
            }
          } else {
            eventTypeNormalized = 'change';
          }

          const event: WatchEvent = {
            type: eventTypeNormalized,
            filePath,
            fileName,
          };

          this.notifyCallbacks(event);
        }, this.debounceDelay)
      );
    });

    this.watchers.set(dirPath, watcher);
    logger.debug('Started watching directory', { dirPath });
  }

  /**
   * 停止监控目录
   */
  unwatchDirectory(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
      logger.debug('Stopped watching directory', { dirPath });
    }
  }

  /**
   * 订阅目录变化事件
   */
  onEvent(callback: WatchCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 取消订阅
   */
  offEvent(callback: WatchCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * 通知所有回调
   */
  private notifyCallbacks(event: WatchEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        handleError(error, { module: 'agent:watcher', action: '目录监控回调' });
      }
    }
  }

  /**
   * 获取当前监控的目录列表
   */
  getWatchedDirectories(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * 停止所有监控
   */
  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();
  }
}
