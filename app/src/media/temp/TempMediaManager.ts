/**
 * TempMediaManager 媒体临时文件管理
 * 对标 CC 的临时文件管理
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleError } from '@modules/error';

export interface TempFileConfig {
  baseDir: string;
  maxAge: number;
  maxFiles: number;
  autoClean: boolean;
}

/**
 * 临时媒体文件管理器
 */
export class TempMediaManager {
  private config: TempFileConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private counter: number = 0;

  constructor(config?: Partial<TempFileConfig>) {
    this.config = {
      baseDir: config?.baseDir || path.join(os.tmpdir(), 'Liri_media'),
      maxAge: config?.maxAge || 60 * 60 * 1000,
      maxFiles: config?.maxFiles || 1000,
      autoClean: config?.autoClean !== false,
    };

    fs.mkdirSync(this.config.baseDir, { recursive: true });

    if (this.config.autoClean) {
      this.startCleanup();
    }
  }

  /**
   * 创建临时文件
   */
  createFile(prefix: string, extension: string): string {
    const fileName = `${prefix}_${Date.now()}_${this.counter++}${extension}`;
    const filePath = path.join(this.config.baseDir, fileName);

    return filePath;
  }

  /**
   * 创建临时目录
   */
  createDir(): string {
    const dirName = `media_${Date.now()}_${this.counter++}`;
    const dirPath = path.join(this.config.baseDir, dirName);

    fs.mkdirSync(dirPath, { recursive: true });

    return dirPath;
  }

  /**
   * 写入临时文件
   */
  writeFile(
    prefix: string,
    extension: string,
    data: Buffer | string
  ): string | null {
    try {
      const filePath = this.createFile(prefix, extension);
      fs.writeFileSync(filePath, data);

      return filePath;
    } catch {
      return null;
    }
  }

  /**
   * 清理过期文件
   */
  cleanup(): void {
    try {
      if (!fs.existsSync(this.config.baseDir)) return;

      const files = fs.readdirSync(this.config.baseDir);
      const now = Date.now();
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.config.baseDir, file);

        try {
          const stat = fs.statSync(filePath);

          if (now - stat.mtimeMs > this.config.maxAge) {
            fs.rmSync(filePath, { recursive: true, force: true });
            deleted++;
          }
        } catch (err) {
          void handleError(err, {
            module: 'media:temp',
            action: 'catch_error',
          });
        }
      }

      if (files.length - deleted > this.config.maxFiles) {
        const remaining = fs
          .readdirSync(this.config.baseDir)
          .map((f) => ({
            name: f,
            path: path.join(this.config.baseDir, f),
            mtime: fs.statSync(path.join(this.config.baseDir, f)).mtimeMs,
          }))
          .sort((a, b) => a.mtime - b.mtime);

        const toDelete = remaining.slice(
          0,
          remaining.length - this.config.maxFiles
        );

        for (const file of toDelete) {
          try {
            fs.rmSync(file.path, { recursive: true, force: true });
          } catch (err) {
            void handleError(err, {
              module: 'media:temp',
              action: 'catch_error',
            });
          }
        }
      }
    } catch (err) {
      void handleError(err, { module: 'media:temp', action: 'catch_error' });
    }
  }

  /**
   * 获取临时文件列表
   */
  listFiles(): string[] {
    try {
      if (!fs.existsSync(this.config.baseDir)) return [];

      return fs
        .readdirSync(this.config.baseDir)
        .map((f) => path.join(this.config.baseDir, f));
    } catch {
      return [];
    }
  }

  /**
   * 获取存储统计
   */
  getStats(): {
    fileCount: number;
    totalSize: number;
    oldestFile: number | null;
  } {
    try {
      if (!fs.existsSync(this.config.baseDir)) {
        return { fileCount: 0, totalSize: 0, oldestFile: null };
      }

      const files = fs.readdirSync(this.config.baseDir);
      let totalSize = 0;
      let oldestFile: number | null = null;

      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(this.config.baseDir, file));

          totalSize += stat.size;

          if (oldestFile === null || stat.mtimeMs < oldestFile) {
            oldestFile = stat.mtimeMs;
          }
        } catch (err) {
          void handleError(err, {
            module: 'media:temp',
            action: 'catch_error',
          });
        }
      }

      return { fileCount: files.length, totalSize, oldestFile };
    } catch {
      return { fileCount: 0, totalSize: 0, oldestFile: null };
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 启动自动清理
   */
  private startCleanup(): void {
    this.timer = setInterval(
      () => {
        this.cleanup();
      },
      Math.min(this.config.maxAge, 30 * 60 * 1000)
    );
  }
}

export const tempMediaManager = new TempMediaManager();
