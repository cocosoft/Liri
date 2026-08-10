/**
 * 记忆文件观察器
 * 监听记忆目录中的文件变化，自动检测新增、修改、删除的记忆文件
 * 参考CC源码 cc_code/backend/memdir/memoryScan.ts 实现
 */

import { watch, FSWatcher } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('memory:scanners:memoryWatcher');
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * 记忆文件变化类型
 */
export type MemoryFileChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * 记忆文件变化事件
 */
export interface MemoryFileChangeEvent {
  type: MemoryFileChangeType;
  filePath: string;
  fileName: string;
  timestamp: number;
  oldFilePath?: string;
}

/**
 * 记忆文件头信息
 */
export interface MemoryFileHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  description: string | null;
  type: string | undefined;
}

/**
 * 记忆观察器配置
 */
export interface MemoryWatcherConfig {
  memoryDir: string;
  pollIntervalMs: number;
  maxMemoryFiles: number;
  recursive: boolean;
  ignorePatterns: string[];
}

const DEFAULT_CONFIG: MemoryWatcherConfig = {
  memoryDir: '',
  pollIntervalMs: 300000,
  maxMemoryFiles: 200,
  recursive: true,
  ignorePatterns: ['MEMORY.md', '.DS_Store', '*.tmp'],
};

/**
 * 记忆文件观察器
 */
export class MemoryWatcher {
  private config: MemoryWatcherConfig;
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private knownFiles: Map<string, number> = new Map();
  private listeners: Array<(event: MemoryFileChangeEvent) => void> = [];
  private isWatching = false;

  constructor(config: Partial<MemoryWatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动观察
   */
  async start(): Promise<void> {
    if (this.isWatching) {
      logger.warn('MemoryWatcher already watching');
      return;
    }

    if (!this.config.memoryDir) {
      throw new AppError(
        'memoryDir is required',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await this.scanInitialFiles();
    this.startFsWatcher();

    if (this.config.pollIntervalMs > 0) {
      this.startPolling();
    }

    this.isWatching = true;
    logger.info(`MemoryWatcher started for ${this.config.memoryDir}`);
  }

  /**
   * 停止观察
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.isWatching = false;
    logger.info('MemoryWatcher stopped');
  }

  /**
   * 扫描初始文件列表
   */
  private async scanInitialFiles(): Promise<void> {
    try {
      const entries = await this.walkDir(this.config.memoryDir);
      const mdFiles = entries.filter((f) => f.endsWith('.md'));

      for (const relativePath of mdFiles) {
        const filePath = join(this.config.memoryDir, relativePath);
        try {
          const { mtimeMs } = await stat(filePath);
          this.knownFiles.set(relativePath, mtimeMs);
        } catch (err) {
          // ignore
        }
      }

      logger.debug(
        `MemoryWatcher initialized with ${this.knownFiles.size} files`
      );
    } catch (error) {
      await handleError(error, {
        module: 'memory:watcher',
        action: 'scan_initial_files',
      });
    }
  }

  /**
   * 启动文件系统监听
   */
  private async startFsWatcher(): Promise<void> {
    try {
      this.watcher = watch(
        this.config.memoryDir,
        { recursive: this.config.recursive },
        (eventType, filename) => {
          if (!filename) return;

          if (!filename.endsWith('.md')) return;

          if (this.shouldIgnore(filename)) return;

          this.handleFileEvent(eventType as 'rename' | 'change', filename);
        }
      );

      this.watcher.on('error', (error) => {
        void handleError(
          error instanceof Error ? error : new Error(String(error)),
          { module: 'memory:scanners:watcher', action: 'watcher_event_error' }
        );
      });
    } catch (error) {
      await handleError(error, {
        module: 'memory:scanners:watcher',
        action: 'start_watcher',
      });
    }
  }

  /**
   * 启动轮询
   */
  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      await this.pollForChanges();
    }, this.config.pollIntervalMs);
  }

  /**
   * 轮询检查变化
   */
  private async pollForChanges(): Promise<void> {
    try {
      const entries = await this.walkDir(this.config.memoryDir);
      const mdFiles = entries.filter((f) => f.endsWith('.md'));

      const currentFiles = new Map<string, number>();

      for (const relativePath of mdFiles) {
        const filePath = join(this.config.memoryDir, relativePath);
        try {
          const { mtimeMs } = await stat(filePath);
          currentFiles.set(relativePath, mtimeMs);

          const knownMtime = this.knownFiles.get(relativePath);
          if (!knownMtime) {
            this.emitEvent({
              type: 'added',
              filePath,
              fileName: relativePath,
              timestamp: Date.now(),
            });
          } else if (mtimeMs > knownMtime) {
            this.emitEvent({
              type: 'modified',
              filePath,
              fileName: relativePath,
              timestamp: mtimeMs,
            });
          }
        } catch (err) {
          // ignore
        }
      }

      const knownPaths = Array.from(this.knownFiles.keys());
      for (const relativePath of knownPaths) {
        if (!currentFiles.has(relativePath)) {
          const filePath = join(this.config.memoryDir, relativePath);
          this.emitEvent({
            type: 'deleted',
            filePath,
            fileName: relativePath,
            timestamp: Date.now(),
          });
        }
      }

      this.knownFiles = currentFiles;
    } catch (error) {
      await handleError(error, {
        module: 'memory:watcher',
        action: 'poll_changes',
      });
    }
  }

  /**
   * 处理文件系统事件
   */
  private async handleFileEvent(
    eventType: 'rename' | 'change',
    filename: string
  ): Promise<void> {
    const filePath = join(this.config.memoryDir, filename);

    if (eventType === 'rename') {
      try {
        await stat(filePath);
        const { mtimeMs } = await stat(filePath);
        const knownMtime = this.knownFiles.get(filename);

        if (knownMtime) {
          this.emitEvent({
            type: 'renamed',
            filePath,
            fileName: filename,
            timestamp: Date.now(),
            oldFilePath: join(
              this.config.memoryDir,
              this.findFileByMtime(knownMtime) ?? ''
            ),
          });
        } else {
          this.emitEvent({
            type: 'added',
            filePath,
            fileName: filename,
            timestamp: mtimeMs,
          });
        }

        this.knownFiles.set(filename, mtimeMs);
      } catch (err) {
        const oldMtime = this.knownFiles.get(filename);
        if (oldMtime) {
          this.emitEvent({
            type: 'deleted',
            filePath,
            fileName: filename,
            timestamp: Date.now(),
          });
          this.knownFiles.delete(filename);
        }
      }
    } else {
      try {
        const { mtimeMs } = await stat(filePath);
        const knownMtime = this.knownFiles.get(filename);

        if (knownMtime && mtimeMs > knownMtime) {
          this.emitEvent({
            type: 'modified',
            filePath,
            fileName: filename,
            timestamp: mtimeMs,
          });
        }

        this.knownFiles.set(filename, mtimeMs);
      } catch (err) {
        if (this.knownFiles.has(filename)) {
          this.emitEvent({
            type: 'deleted',
            filePath,
            fileName: filename,
            timestamp: Date.now(),
          });
          this.knownFiles.delete(filename);
        }
      }
    }
  }

  /**
   * 根据mtime查找文件
   */
  private findFileByMtime(mtime: number): string | undefined {
    const entries = Array.from(this.knownFiles.entries());
    for (const [path, fileMtime] of entries) {
      if (fileMtime === mtime) {
        return path;
      }
    }
    return undefined;
  }

  /**
   * 检查是否应该忽略文件
   */
  private shouldIgnore(filename: string): boolean {
    const baseName = basename(filename);

    for (const pattern of this.config.ignorePatterns) {
      if (pattern === baseName) return true;
      if (pattern.startsWith('*') && baseName.endsWith(pattern.slice(1)))
        return true;
    }

    return false;
  }

  /**
   * 遍历目录
   */
  private async walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory() && this.config.recursive) {
          const subResults = await this.walkDir(fullPath);
          results.push(...subResults.map((p) => join(entry.name, p)));
        } else if (entry.isFile()) {
          results.push(entry.name);
        }
      }
    } catch (error) {
      await handleError(error, {
        module: 'memory:watcher',
        action: 'walk_dir',
        context: { dir },
      });
    }

    return results;
  }

  /**
   * 添加监听器
   */
  addListener(listener: (event: MemoryFileChangeEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: (event: MemoryFileChangeEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 触发事件
   */
  private emitEvent(event: MemoryFileChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        void handleError(error, {
          module: 'memory:scanners:watcher',
          action: 'listener_error',
        });
      }
    }
  }

  /**
   * 获取当前观察的文件数量
   */
  getWatchedFileCount(): number {
    return this.knownFiles.size;
  }

  /**
   * 检查是否正在观察
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * 手动触发重新扫描
   */
  async rescan(): Promise<MemoryFileChangeEvent[]> {
    const changes: MemoryFileChangeEvent[] = [];
    const oldFiles = new Map(this.knownFiles);

    await this.pollForChanges();

    const oldPaths = Array.from(oldFiles.keys());
    for (const filename of oldPaths) {
      if (!this.knownFiles.has(filename)) {
        changes.push({
          type: 'added',
          filePath: join(this.config.memoryDir, filename),
          fileName: filename,
          timestamp: Date.now(),
        });
      }
    }

    const newPaths = Array.from(this.knownFiles.keys());
    for (const filename of newPaths) {
      if (!oldFiles.has(filename)) {
        changes.push({
          type: 'added',
          filePath: join(this.config.memoryDir, filename),
          fileName: filename,
          timestamp: Date.now(),
        });
      }
    }

    const oldEntries = Array.from(oldFiles.entries());
    for (const [filename, mtime] of oldEntries) {
      if (!this.knownFiles.has(filename)) {
        changes.push({
          type: 'deleted',
          filePath: join(this.config.memoryDir, filename),
          fileName: filename,
          timestamp: Date.now(),
        });
      }
    }

    return changes;
  }
}

/**
 * 导出单例
 */
export const memoryWatcher = new MemoryWatcher();
