/**
 * FileTAORCheckpointStorage — 文件系统 TAOR 检查点存储
 *
 * 实现 CheckpointStorage 接口，将 TAORCheckpoint 持久化到磁盘 JSON 文件。
 * 存储路径：~/.pyapp/data/taor-checkpoints/
 *
 * 支持重启后断点恢复（Durable Resume）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveDataDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { isCheckpointLogEnabled } from '@modules/config';
import { randomUUID } from 'crypto';

import type { TAORCheckpoint, CheckpointStorage } from './types.js';

const logger = getLogger('query:fileTAORCheckpoint');

const STORAGE_DIR = 'taor-checkpoints';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 跳过临时文件 */
function isStableFile(filename: string): boolean {
  return (
    filename.startsWith('taor-') &&
    filename.endsWith('.json') &&
    !filename.endsWith('.tmp')
  );
}

export class FileTAORCheckpointStorage implements CheckpointStorage {
  private storageDir: string;

  constructor(customDir?: string) {
    this.storageDir = customDir ?? path.join(resolveDataDir(), STORAGE_DIR);
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  private filePath(checkpoint: TAORCheckpoint): string {
    return path.join(
      this.storageDir,
      `taor-${checkpoint.sessionId}-${checkpoint.id}.json`
    );
  }

  /**
   * 保存检查点（两阶段写入，防止崩溃损坏）
   *
   * 流程: 写 .tmp → fsync → 重命名为 .json
   */
  async save(checkpoint: TAORCheckpoint): Promise<string> {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    const finalPath = this.filePath(checkpoint);
    const tmpPath = finalPath + '.tmp';
    const data = JSON.stringify(checkpoint, null, 2);

    await fs.promises.writeFile(tmpPath, data, 'utf-8');
    const fd = await fs.promises.open(tmpPath, 'r+');
    await fd.sync();
    await fd.close();
    await fs.promises.rename(tmpPath, finalPath);

    if (isCheckpointLogEnabled()) {
      logger.info('TAOR checkpoint saved', {
        id: checkpoint.id,
        sessionId: checkpoint.sessionId,
      });
    }
    return checkpoint.id;
  }

  async load(id: string): Promise<TAORCheckpoint | null> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(`taor-.+-${escapeRegex(id)}\\.json$`);
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return null;
      const content = await fs.promises.readFile(
        path.join(this.storageDir, matched),
        'utf-8'
      );
      return JSON.parse(content) as TAORCheckpoint;
    } catch (ckErr) {
      // KB-TAOR-CKPT-LOAD（2026-08-29）：检查点读取/解析失败静默默认值 → 恢复状态丢失
      logger.warn('TAOR 检查点读取/解析失败', {
        error: ckErr instanceof Error ? ckErr.message : String(ckErr),
      });
      return null;
    }
  }

  async findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(`^taor-${escapeRegex(sessionId)}-.+\\.json$`);
      const matched = files.filter((f) => pattern.test(f));
      if (matched.length === 0) return null;

      const cps: TAORCheckpoint[] = [];
      for (const file of matched) {
        try {
          const content = await fs.promises.readFile(
            path.join(this.storageDir, file),
            'utf-8'
          );
          cps.push(JSON.parse(content) as TAORCheckpoint);
        } catch (fileErr) {
          // KB-TAOR-CKPT-FILE（2026-08-29）：单文件处理失败静默跳过 → 残留/丢失不可知
          logger.warn('TAOR 检查点单文件处理失败，跳过', {
            error: fileErr instanceof Error ? fileErr.message : String(fileErr),
          });
          continue;
        }
      }
      return cps.sort((a, b) => b.createdAt - a.createdAt);
    } catch (ckErr) {
      // KB-TAOR-CKPT-LOAD（2026-08-29）：检查点读取/解析失败静默默认值 → 恢复状态丢失
      logger.warn('TAOR 检查点读取/解析失败', {
        error: ckErr instanceof Error ? ckErr.message : String(ckErr),
      });
      return null;
    }
  }

  /** 获取最新的未完成检查点（用于恢复） */
  async getLatestIncomplete(sessionId: string): Promise<TAORCheckpoint | null> {
    const checkpoints = await this.findBySessionId(sessionId);
    if (!checkpoints || checkpoints.length === 0) return null;
    // 按时间降序排，取最新
    return checkpoints[0];
  }

  /** 获取所有有未完成检查点的 session ID 列表（跳过 .tmp 文件） */
  async getPendingSessions(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const sessionIds = new Set<string>();
      for (const file of files) {
        if (!isStableFile(file)) continue;
        const match = file.match(/^taor-(.+)-.+\.json$/);
        // P0 修复（2026-08-14 排查）：防御过滤空 sessionId（与 DB 存储一致）
        if (match && match[1]) sessionIds.add(match[1]);
      }
      return Array.from(sessionIds);
    } catch (listErr) {
      // KB-TAOR-CKPT-LIST（2026-08-29）：session 列表加载失败静默 [] → 恢复状态丢失
      logger.warn('TAOR 检查点 session 列表加载失败', {
        error: listErr instanceof Error ? listErr.message : String(listErr),
      });
      return [];
    }
  }

  /** 清理崩溃残留的 .tmp 文件 */
  async cleanOrphanedTmp(): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      let count = 0;
      for (const file of files) {
        if (!file.endsWith('.tmp')) continue;
        try {
          await fs.promises.unlink(path.join(this.storageDir, file));
          count++;
          if (isCheckpointLogEnabled()) {
            logger.info('Cleaned orphaned checkpoint tmp file', { file });
          }
        } catch (fileErr) {
          // KB-TAOR-CKPT-FILE（2026-08-29）：单文件处理失败静默跳过 → 残留/丢失不可知
          logger.warn('TAOR 检查点单文件处理失败，跳过', {
            error: fileErr instanceof Error ? fileErr.message : String(fileErr),
          });
          continue;
        }
      }
      return count;
    } catch (opErr) {
      // KB-TAOR-CKPT-OP（2026-08-29）：检查点操作失败静默默认值 → 结果失真不可排查
      logger.warn('TAOR 检查点操作失败，按默认值处理', {
        error: opErr instanceof Error ? opErr.message : String(opErr),
      });
      return 0;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(`taor-.+-${escapeRegex(id)}\\.json$`);
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return false;
      await fs.promises.unlink(path.join(this.storageDir, matched));
      return true;
    } catch (delErr) {
      // KB-TAOR-CKPT-DEL（2026-08-29）：删除失败静默 false → 检查点残留不可排查
      logger.warn('TAOR 检查点删除失败', {
        id,
        error: delErr instanceof Error ? delErr.message : String(delErr),
      });
      return false;
    }
  }

  /** 删除某 session 的所有检查点 */
  async deleteSession(sessionId: string): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(`^taor-${escapeRegex(sessionId)}-.+\\.json$`);
      const matched = files.filter((f) => pattern.test(f));
      let count = 0;
      for (const file of matched) {
        try {
          await fs.promises.unlink(path.join(this.storageDir, file));
          count++;
        } catch (fileErr) {
          // KB-TAOR-CKPT-FILE（2026-08-29）：单文件处理失败静默跳过 → 残留/丢失不可知
          logger.warn('TAOR 检查点单文件处理失败，跳过', {
            error: fileErr instanceof Error ? fileErr.message : String(fileErr),
          });
          continue;
        }
      }
      return count;
    } catch (opErr) {
      // KB-TAOR-CKPT-OP（2026-08-29）：检查点操作失败静默默认值 → 结果失真不可排查
      logger.warn('TAOR 检查点操作失败，按默认值处理', {
        error: opErr instanceof Error ? opErr.message : String(opErr),
      });
      return 0;
    }
  }

  async cleanup(expireTime: number): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      let count = 0;
      for (const file of files) {
        if (!file.startsWith('taor-') || !file.endsWith('.json')) continue;
        try {
          const fp = path.join(this.storageDir, file);
          const stat = await fs.promises.stat(fp);
          if (stat.mtimeMs < expireTime) {
            await fs.promises.unlink(fp);
            count++;
          }
        } catch (fileErr) {
          // KB-TAOR-CKPT-FILE（2026-08-29）：单文件处理失败静默跳过 → 残留/丢失不可知
          logger.warn('TAOR 检查点单文件处理失败，跳过', {
            error: fileErr instanceof Error ? fileErr.message : String(fileErr),
          });
          continue;
        }
      }
      if (count > 0 && isCheckpointLogEnabled()) {
        logger.info('Cleaned up expired TAOR checkpoints', { count });
      }
      return count;
    } catch (opErr) {
      // KB-TAOR-CKPT-OP（2026-08-29）：检查点操作失败静默默认值 → 结果失真不可排查
      logger.warn('TAOR 检查点操作失败，按默认值处理', {
        error: opErr instanceof Error ? opErr.message : String(opErr),
      });
      return 0;
    }
  }
}
