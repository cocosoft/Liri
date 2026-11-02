import { watch, type FSWatcher } from 'fs';
import { join, dirname } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('chronos:watcher:cronFileWatcher');

/** 观察期日志（每进程一次；不改变任何行为） */
let deprecatedWarned = false;
function warnDeprecatedOnce(): void {
  if (deprecatedWarned) return;
  deprecatedWarned = true;
  process.emitWarning(
    'chronos.CronFileWatcher 属未接线旧轨（P35）；新入口请用 app/src/tasks/sources 的 fsSignalSource。',
    { type: 'DeprecationWarning', code: 'LIRI_CHRONOS_LEGACY_FILE_WATCHER' }
  );
}

export type CronFileChangeCallback = (
  event: 'change' | 'rename',
  filePath: string
) => void;

/**
 * @deprecated P35（2026-11-02）：**未接线的旧轨雏形**，全仓无运行时消费者。
 *
 * 新入口是 `app/src/tasks/sources` 的 `fsSignalSource`（携带 `{path, kind}`）；
 * 本类仅保留供观察期取证（CD05/CD06：先标记、不删除）。首次实例化发一条
 * `DeprecationWarning`，用于确认是否仍有入口在用。
 */
export class CronFileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: CronFileChangeCallback | null = null;
  private watchingPath: string = '';
  private debounceMs: number;

  constructor(debounceMs: number = 1000) {
    this.debounceMs = debounceMs;
    warnDeprecatedOnce();
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
