import { watch, type FSWatcher } from 'node:fs';
import { join, dirname } from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'chronos:watcher:cronFileWatcher',
  level: LogLevel.INFO,
});

export type CronFileChangeCallback = (
  event: 'change' | 'rename',
  filePath: string
) => void;

export class CronFileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: CronFileChangeCallback | null = null;
  private watchingPath: string = '';
  private debounceMs: number;

  constructor(debounceMs: number = 1000) {
    this.debounceMs = debounceMs;
  }

  start(filePath: string, onChange: CronFileChangeCallback): void {
    this.stop();
    this.onChange = onChange;
    this.watchingPath = filePath;

    const dir = dirname(filePath);
    this.watcher = watch(dir, (event, filename) => {
      if (!filename) return;

      const fullPath = join(dir, filename);
      if (fullPath !== filePath) return;

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        logger.info(`检测到文件变化: ${filename} (${event})`);
        this.onChange?.(event, fullPath);
      }, this.debounceMs);
    });

    this.watcher.on('error', (err) => {
      logger.error(`文件监听错误: ${this.watchingPath}`, err);
    });

    logger.info(`文件监听已启动: ${filePath}`);
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.onChange = null;
    logger.info('文件监听已停止');
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }
}

export const cronFileWatcher = new CronFileWatcher();
