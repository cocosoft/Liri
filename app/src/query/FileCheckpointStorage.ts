/**
 * @owner chat/ChatManager（自 2026-07-13，原属于 query/TAORLoop）
 *
 * 文件系统检查点存储
 * 将 SessionCheckpoint 持久化到磁盘 JSON 文件
 * 实现 chat/types/checkpoint.CheckpointStorage 接口，可注入到 SessionCheckpointService
 * 存储路径遵循文件存储规范第二层：~/.pyapp/data/checkpoints/
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveDataDir } from '@modules/core';
import type {
  SessionCheckpoint,
  CheckpointStorage,
} from '../chat/types/checkpoint.js';
import { CHECKPOINT_MAX_AUTO } from '../chat/types/checkpoint.js';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('query:fileCheckpointStorage');

const CHECKPOINT_DIR_DEFAULT = 'checkpoints';

export class FileCheckpointStorage implements CheckpointStorage {
  private storageDir: string;

  constructor(storageDir?: string) {
    if (storageDir) {
      this.storageDir = path.resolve(storageDir);
    } else {
      this.storageDir = path.join(resolveDataDir(), CHECKPOINT_DIR_DEFAULT);
    }
    this.ensureDir();
  }

  /** 确保存储目录存在 */
  private ensureDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  /** 生成检查点文件名 */
  private filePath(checkpoint: SessionCheckpoint): string {
    return path.join(
      this.storageDir,
      `checkpoint-${checkpoint.sessionId}-${checkpoint.id}.json`
    );
  }

  /** 保存检查点到 JSON 文件 */
  async saveCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    this.ensureDir();
    const fp = this.filePath(checkpoint);
    const data = JSON.stringify(checkpoint, null, 2);
    await fs.promises.writeFile(fp, data, 'utf-8');
  }

  /** 按 ID 加载单个检查点 */
  async loadCheckpoint(
    checkpointId: string
  ): Promise<SessionCheckpoint | null> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `checkpoint-.+-${escapeRegex(checkpointId)}\\.json$`
      );
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return null;

      const content = await fs.promises.readFile(
        path.join(this.storageDir, matched),
        'utf-8'
      );
      return JSON.parse(content) as SessionCheckpoint;
    } catch {
      return null;
    }
  }

  /** 按 sessionId 加载所有检查点（按创建时间倒序） */
  async loadCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      const matched = files.filter((f) => pattern.test(f));
      if (matched.length === 0) return [];

      const checkpoints: SessionCheckpoint[] = [];
      for (const file of matched) {
        try {
          const content = await fs.promises.readFile(
            path.join(this.storageDir, file),
            'utf-8'
          );
          checkpoints.push(JSON.parse(content) as SessionCheckpoint);
        } catch {
          continue;
        }
      }

      return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /** 删除单个检查点 */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `checkpoint-.+-${escapeRegex(checkpointId)}\\.json$`
      );
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return;

      await fs.promises.unlink(path.join(this.storageDir, matched));
    } catch {
      logger.warn('Failed to delete checkpoint', {
        checkpointId,
        error: 'io_error',
      });
    }
  }

  /** 删除某 session 所有检查点 */
  async deleteSessionCheckpoints(sessionId: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      const matched = files.filter((f) => pattern.test(f));

      for (const file of matched) {
        try {
          await fs.promises.unlink(path.join(this.storageDir, file));
        } catch {
          continue;
        }
      }
    } catch {
      logger.warn('Failed to delete session checkpoints', {
        sessionId,
        error: 'io_error',
      });
    }
  }

  /** 获取某 session 检查点数量 */
  async getCheckpointCount(sessionId: string): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      return files.filter((f) => pattern.test(f)).length;
    } catch {
      return 0;
    }
  }

  /** 获取最新检查点 */
  async getLatestCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpoint | null> {
    const checkpoints = await this.loadCheckpoints(sessionId);
    return checkpoints.length > 0 ? checkpoints[0] : null;
  }

  /** 清理过期检查点 */
  async cleanup(expireTime: number): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      let count = 0;

      for (const file of files) {
        if (!file.startsWith('checkpoint-') || !file.endsWith('.json')) {
          continue;
        }
        try {
          const filePath = path.join(this.storageDir, file);
          const stat = await fs.promises.stat(filePath);
          if (stat.mtimeMs < expireTime) {
            await fs.promises.unlink(filePath);
            count++;
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
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
