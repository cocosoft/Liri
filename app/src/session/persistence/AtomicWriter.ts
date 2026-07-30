/**
 * AtomicWriter — 原子文件写入器
 * 对标 OpenClaw writeTextAtomic
 * 使用 tmp + rename 模式保证写入原子性
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'session:persistence:AtomicWriter',
  level: LogLevel.INFO,
});

export class AtomicWriteError extends AppError {
  public readonly path: string;
  public readonly tmpPath: string;

  constructor(
    message: string,
    details: { path: string; tmpPath: string; cause?: unknown }
  ) {
    super(message, ErrorCategory.FILESYSTEM, ErrorSeverity.HIGH, undefined, {
      path: details.path,
      tmpPath: details.tmpPath,
    });
    this.name = 'AtomicWriteError';
    this.path = details.path;
    this.tmpPath = details.tmpPath;
    if (details.cause instanceof Error) this.cause = details.cause;
  }
}

export class AtomicWriter {
  private tmpDir?: string;

  constructor(tmpDir?: string) {
    this.tmpDir = tmpDir;
  }

  async write(targetPath: string, data: string | Uint8Array): Promise<void> {
    const dir = this.tmpDir ?? path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });

    const suffix = crypto.randomBytes(4).toString('hex');
    const tmpPath = path.join(dir, `.tmp.${suffix}`);

    try {
      await fs.writeFile(tmpPath, data, 'utf-8');
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      // @ignore-catch — 原子写入失败时清理临时文件，best-effort非关键
      await fs.unlink(tmpPath).catch(() => {});
      throw new AtomicWriteError('Atomic write failed', {
        path: targetPath,
        tmpPath,
        cause: err,
      });
    }
  }

  async writeJSON(targetPath: string, data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    await this.write(targetPath, json);
  }

  async append(targetPath: string, data: string): Promise<void> {
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });

    const suffix = crypto.randomBytes(4).toString('hex');
    const tmpPath = path.join(dir, `.tmp.append.${suffix}`);

    try {
      let existing = '';
      try {
        existing = await fs.readFile(targetPath, 'utf-8');
      } catch {
        // 文件尚不存在（新会话首次访问），静默处理
      }
      await fs.writeFile(tmpPath, existing + data, 'utf-8');
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      // @ignore-catch — 原子追加失败时清理临时文件，best-effort非关键
      await fs.unlink(tmpPath).catch(() => {});
      throw new AtomicWriteError('Atomic append failed', {
        path: targetPath,
        tmpPath,
        cause: err,
      });
    }
  }
}
