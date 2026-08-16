/**
 * SessionMaintenance 会话存储维护
 * 对标 CC 的会话存储维护能力
 */
import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('session\maintenance\SessionMaintenance');

/**
 * 维护配置
 */
export interface MaintenanceConfig {
  storePath: string;
  maxSessionAge: number;
  maxSessions: number;
  maxStorageSize: number;
  cleanInterval: number;
}

/**
 * 维护结果
 */
export interface MaintenanceResult {
  cleaned: number;
  freedBytes: number;
  duration: number;
  errors: string[];
}

/**
 * 会话存储维护管理器
 */
export class SessionMaintenance {
  private config: MaintenanceConfig;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<MaintenanceConfig>) {
    this.config = {
      storePath: config?.storePath || path.join(resolvePyappHome(), 'sessions'),
      maxSessionAge: config?.maxSessionAge || 7 * 24 * 60 * 60 * 1000,
      maxSessions: config?.maxSessions || 1000,
      maxStorageSize: config?.maxStorageSize || 500 * 1024 * 1024,
      cleanInterval: config?.cleanInterval || 60 * 60 * 1000,
    };

    fs.mkdirSync(this.config.storePath, { recursive: true });
  }

  /**
   * 启动自动维护
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      // @ignore-catch — 定时清理回调fire-and-forget，失败由内部handleError处理
      this.cleanup().catch(() => {});
    }, this.config.cleanInterval);
    // P1-14 修复：unref 避免进程被维护定时器钉住
    this.timer.unref();
  }

  /**
   * 停止自动维护
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 执行清理
   */
  async cleanup(): Promise<MaintenanceResult> {
    const startTime = Date.now();
    let cleaned = 0;
    let freedBytes = 0;
    const errors: string[] = [];

    try {
      const files = await this.listSessionFiles();

      const expired = this.findExpiredFiles(files);
      const overLimit = await this.findOverLimitFiles(files);

      const toDelete = new Set([...expired, ...overLimit]);

      for (const file of toDelete) {
        try {
          const size = fs.statSync(file.path).size;
          fs.unlinkSync(file.path);
          cleaned++;
          freedBytes += size;
        } catch (err) {
          errors.push(
            `删除失败 ${file.path}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (cleaned === 0) {
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);

        if (totalSize > this.config.maxStorageSize) {
          const oldest = files.sort((a, b) => a.mtime - b.mtime);

          for (const file of oldest) {
            if (freedBytes >= totalSize - this.config.maxStorageSize) break;

            try {
              fs.unlinkSync(file.path);
              cleaned++;
              freedBytes += file.size;
            } catch (err) {
              void handleError(err, {
                module: 'session:maintenance',
                action: 'catch_error',
              });
            }
          }
        }
      }
    } catch (err) {
      errors.push(
        `清理过程错误: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return {
      cleaned,
      freedBytes,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * 获取存储统计
   */
  getStats(): {
    totalFiles: number;
    totalSize: number;
    oldestFile: number;
    newestFile: number;
  } {
    const files = this.listSessionFilesSync();

    if (files.length === 0) {
      return { totalFiles: 0, totalSize: 0, oldestFile: 0, newestFile: 0 };
    }

    return {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      oldestFile: Math.min(...files.map((f) => f.mtime)),
      newestFile: Math.max(...files.map((f) => f.mtime)),
    };
  }

  /**
   * 获取配额信息
   */
  getQuotaInfo(): { used: number; limit: number; percentage: number } {
    const stats = this.getStats();

    return {
      used: stats.totalSize,
      limit: this.config.maxStorageSize,
      percentage: stats.totalSize / this.config.maxStorageSize,
    };
  }

  /**
   * 列出会话文件
   */
  private async listSessionFiles(): Promise<
    Array<{ path: string; size: number; mtime: number }>
  > {
    return this.listSessionFilesSync();
  }

  /**
   * 同步列出会话文件
   */
  private listSessionFilesSync(): Array<{
    path: string;
    size: number;
    mtime: number;
  }> {
    try {
      const files = fs.readdirSync(this.config.storePath);

      return files
        .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
        .map((f) => {
          const filePath = path.join(this.config.storePath, f);
          const stat = fs.statSync(filePath);

          return { path: filePath, size: stat.size, mtime: stat.mtimeMs };
        });
    } catch {
      return [];
    }
  }

  /**
   * 查找过期文件
   */
  private findExpiredFiles(
    files: Array<{ path: string; size: number; mtime: number }>
  ): Array<{ path: string; size: number; mtime: number }> {
    const cutoff = Date.now() - this.config.maxSessionAge;

    return files.filter((f) => f.mtime < cutoff);
  }

  /**
   * 查找超量文件
   */
  private async findOverLimitFiles(
    files: Array<{ path: string; size: number; mtime: number }>
  ): Promise<Array<{ path: string; size: number; mtime: number }>> {
    if (files.length <= this.config.maxSessions) return [];

    files.sort((a, b) => b.mtime - a.mtime);

    return files.slice(this.config.maxSessions);
  }
}

export const sessionMaintenance = new SessionMaintenance();
