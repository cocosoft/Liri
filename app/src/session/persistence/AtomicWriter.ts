/**
 * AtomicWriter — 原子文件写入器
 * 对标 OpenClaw writeTextAtomic
 * 使用 tmp + rename 模式保证写入原子性
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:persistence:AtomicWriter');

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
      // 阶段耗时分解：writeFile（数据写入，随数据量增长）vs rename（原子替换，
      // 同盘为 O(1) 元数据操作）。对比可确认"原子操作"本身是否有额外性能损耗——
      // 若 renameMs 占比高，提示跨盘 rename / 防病毒实时扫描等环境因素。
      const writeStart = Date.now();
      await fs.writeFile(tmpPath, data, 'utf-8');
      const writeFileMs = Date.now() - writeStart;
      const renameStart = Date.now();
      // C9（2026-08-23）：Windows 下 rename 覆盖可能因读端打开句柄失败，重试（最多 3 次，100ms 间隔）
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(tmpPath, targetPath);
          break;
        } catch (err) {
          if (attempt >= 2) throw err;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const renameMs = Date.now() - renameStart;
      const totalMs = writeFileMs + renameMs;
      logger.debug('AtomicWriter.write 完成', {
        path: targetPath,
        bytes: typeof data === 'string' ? data.length : data.byteLength,
        writeFileMs,
        renameMs,
        totalMs,
        // 原子操作开销占比（0-1）；正常应远小于 writeFileMs（<0.1）
        renameRatio: totalMs > 0 ? Math.round((renameMs / totalMs) * 100) : 0,
      });
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

    // 追加场景（如 messages.jsonl）为 append-only，直接 O_APPEND 追加即可。
    // 旧实现 tmp+rename 每次全量读改写（大文件 O(n²) 复制 → 内存翻倍 + GC 停摆，
    // 曾导致 7MB messages.jsonl 下事件循环阻塞、任务卡死）。追加行是完整 JSON，
    // 崩溃时最多丢失最后一行，不会损坏已有数据。
    try {
      await fs.appendFile(targetPath, data, 'utf-8');
    } catch (err) {
      throw new AtomicWriteError('Atomic append failed', {
        path: targetPath,
        tmpPath: '',
        cause: err,
      });
    }
  }
}
