/**
 * AtomicWriter — 原子文件写入器
 * 对标 OpenClaw writeTextAtomic
 * 使用 tmp + rename 模式保证写入原子性
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

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
        // file doesn't exist yet, that's fine
      }
      await fs.writeFile(tmpPath, existing + data, 'utf-8');
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw new AtomicWriteError('Atomic append failed', {
        path: targetPath,
        tmpPath,
        cause: err,
      });
    }
  }
}
