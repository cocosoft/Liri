/**
 * 配置热重载系统
 * 运行时监听配置变化并自动重载受影响模块
 * 对齐 OpenClaw config/config-reload.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

const logger = new Logger({ level: LogLevel.INFO });

export interface ConfigChangeEvent {
  filePath: string;
  eventType: 'change' | 'rename';
  timestamp: number;
}

export interface ConfigReloadTarget {
  name: string;
  filePatterns: RegExp[];
  reload: () => Promise<void> | void;
  priority: number;
}

export class ConfigWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map();
  private watchedDirs: string[] = [];
  private running = false;

  constructor(private debounceMs = 500) {
    super();
  }

  start(dirs: string[]): void {
    if (this.running) return;
    this.running = true;
    this.watchedDirs = dirs;

    for (const dir of dirs) {
      try {
        const watcher = watch(
          dir,
          { persistent: false },
          (_eventType, filename) => {
            if (!filename) return;
            const filePath = join(dir, filename);
            this.debounce(filePath);
          }
        );
        this.watchers.set(dir, watcher);
        logger.info(`配置监听已启动: ${dir}`);
      } catch (error) {
        logger.warning(`无法监听目录 ${dir}: ${(error as Error).message}`);
      }
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const [dir, watcher] of this.watchers) {
      watcher.close();
      logger.info(`配置监听已停止: ${dir}`);
    }
    this.watchers.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFiles: Set<string> = new Set();

  private debounce(filePath: string): void {
    this.pendingFiles.add(filePath);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const files = Array.from(this.pendingFiles);
      this.pendingFiles.clear();
      for (const file of files) {
        this.emit('change', {
          filePath: file,
          eventType: 'change',
          timestamp: Date.now(),
        } as ConfigChangeEvent);
      }
    }, this.debounceMs);
  }
}

export class ConfigReloader {
  private targets: ConfigReloadTarget[] = [];
  private watcher: ConfigWatcher;
  private lock = false;

  constructor(watcher?: ConfigWatcher) {
    this.watcher = watcher || new ConfigWatcher();
    this.watcher.on('change', (event: ConfigChangeEvent) => {
      this.handleChange(event).catch((err) => {
        logger.error('配置热重载失败', err as Error);
      });
    });
  }

  registerTarget(target: ConfigReloadTarget): void {
    this.targets.push(target);
    this.targets.sort((a, b) => a.priority - b.priority);
    logger.info(`注册热重载目标: ${target.name} (优先级: ${target.priority})`);
  }

  unregisterTarget(name: string): void {
    this.targets = this.targets.filter((t) => t.name !== name);
  }

  start(dirs: string[]): void {
    this.watcher.start(dirs);
  }

  stop(): void {
    this.watcher.stop();
  }

  private async handleChange(event: ConfigChangeEvent): Promise<void> {
    if (this.lock) {
      logger.debug('配置重载进行中，跳过此次变更');
      return;
    }

    this.lock = true;
    try {
      const matchedTargets = this.targets.filter((t) =>
        t.filePatterns.some((p) => p.test(event.filePath))
      );

      if (matchedTargets.length === 0) {
        logger.debug(`配置变更未匹配任何重载目标: ${event.filePath}`);
        return;
      }

      logger.info(
        `配置变更: ${event.filePath}, 重载 ${matchedTargets.length} 个目标`
      );
      for (const target of matchedTargets) {
        try {
          await target.reload();
          logger.info(`重载完成: ${target.name}`);
        } catch (error) {
          logger.error(`重载失败: ${target.name}`, error as Error);
        }
      }
    } finally {
      this.lock = false;
    }
  }
}

export function createConfigWatcher(dirs: string[]): ConfigWatcher {
  const watcher = new ConfigWatcher();
  watcher.start(dirs);
  return watcher;
}

export function createConfigReloader(watcher?: ConfigWatcher): ConfigReloader {
  return new ConfigReloader(watcher);
}
