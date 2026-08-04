/**
 * TempFileManager
 * 临时文件生命周期管理
 *
 * 用于图像工具链的中间产物管理：
 *   - 创建临时文件路径并注册到清理表
 *   - TTL 自动过期清理（默认 30 分钟）
 *   - 支持手动续期（touch）和显式清理
 */

import fs from 'fs';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveOutputDir } from '@modules/core/paths';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO, module: 'media:tempFile' });

/** 默认 TTL (ms)：30 分钟 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;
/** 清理扫描间隔 (ms)：5 分钟 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** 临时文件元数据 */
interface TempFileEntry {
  path: string;
  createdAt: number;
  ttlMs: number;
  lastTouched: number;
}

export class TempFileManager {
  private files = new Map<string, TempFileEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private outputDir: string;

  constructor() {
    this.outputDir = path.join(resolveOutputDir(), 'images');
    this.ensureDir();
    this.startCleanupTimer();
  }

  /** 确保输出目录存在 */
  private ensureDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 创建临时文件路径（不创建实际文件）
   * @param options.prefix 文件名前缀，默认 'img_'
   * @param options.extension 文件扩展名，默认 '.png'
   * @param options.ttlMs 自定义 TTL，默认 30 分钟
   * @returns 绝对路径
   */
  create(options?: {
    prefix?: string;
    extension?: string;
    ttlMs?: number;
  }): string {
    const prefix = options?.prefix ?? 'img_';
    const extension = options?.extension ?? '.png';
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

    const dateDir = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const datePath = path.join(this.outputDir, dateDir);
    if (!fs.existsSync(datePath)) {
      fs.mkdirSync(datePath, { recursive: true });
    }

    const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(datePath, `${prefix}${uniqueId}${extension}`);

    this.files.set(filePath, {
      path: filePath,
      createdAt: Date.now(),
      ttlMs,
      lastTouched: Date.now(),
    });

    return filePath;
  }

  /**
   * 将外部文件纳入管理
   * @param filePath 文件绝对路径
   * @param ttlMs 自定义 TTL
   */
  adopt(filePath: string, ttlMs?: number): void {
    if (this.files.has(filePath)) return;

    this.files.set(filePath, {
      path: filePath,
      createdAt: Date.now(),
      ttlMs: ttlMs ?? DEFAULT_TTL_MS,
      lastTouched: Date.now(),
    });
  }

  /**
   * 续期 TTL（标记活跃使用）
   */
  touch(filePath: string): void {
    const entry = this.files.get(filePath);
    if (entry) {
      entry.lastTouched = Date.now();
    }
  }

  /**
   * 获取文件信息
   */
  info(
    filePath: string
  ): { createdAt: Date; ttlMs: number; size: number } | null {
    const entry = this.files.get(filePath);
    if (!entry) return null;

    try {
      const stat = fs.statSync(filePath);
      return {
        createdAt: new Date(entry.createdAt),
        ttlMs: entry.ttlMs,
        size: stat.size,
      };
    } catch {
      void handleError(new Error('Failed to get file info'), { module: 'media:tempFile', action: 'info' });
      return null;
    }
  }

  /**
   * 获取所有被管理的文件路径列表
   */
  list(): string[] {
    return [...this.files.keys()];
  }

  /**
   * 清理文件
   * @param target 'expired' 仅清理过期文件，'all' 清理全部
   */
  cleanup(target: 'all' | 'expired' = 'expired'): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [filePath, entry] of this.files) {
      if (target === 'all' || now - entry.lastTouched > entry.ttlMs) {
        toDelete.push(filePath);
      }
    }

    for (const filePath of toDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        this.files.delete(filePath);
      } catch (err) {
        void handleError(err, { module: 'media:tempFile', action: 'cleanup' });
        logger.warn('TempFileManager · 清理文件失败', {
          path: filePath,
          error: String(err),
        });
      }
    }

    if (toDelete.length > 0) {
      logger.info('TempFileManager · 清理完成', {
        deleted: toDelete.length,
        remaining: this.files.size,
        target,
      });
    }
  }

  /** 销毁管理器（停止定时器并清理所有文件） */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cleanup('all');
  }

  /** 启动定时清理器 */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup('expired');
    }, CLEANUP_INTERVAL_MS);

    // 允许进程退出
    if (
      this.cleanupTimer &&
      typeof this.cleanupTimer === 'object' &&
      'unref' in this.cleanupTimer
    ) {
      (
        this.cleanupTimer as ReturnType<typeof setInterval> & { unref(): void }
      ).unref();
    }
  }
}

/** 全局单例 */
let globalInstance: TempFileManager | null = null;

export function getTempFileManager(): TempFileManager {
  if (!globalInstance) {
    globalInstance = new TempFileManager();
  }
  return globalInstance;
}
