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
import { isCheckpointLogEnabled } from '../config/settings/CheckpointLogConfig';
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
    } catch {
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
        } catch {
          continue;
        }
      }
      return cps.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
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
        if (match) sessionIds.add(match[1]);
      }
      return Array.from(sessionIds);
    } catch {
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
        } catch {
          continue;
        }
      }
      return count;
    } catch {
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
    } catch {
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
        } catch {
          continue;
        }
      }
      return count;
    } catch {
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
        } catch {
          continue;
        }
      }
      if (count > 0 && isCheckpointLogEnabled()) {
        logger.info('Cleaned up expired TAOR checkpoints', { count });
      }
      return count;
    } catch {
      return 0;
    }
  }
}
