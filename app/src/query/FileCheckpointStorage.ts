/**
 * 文件系统检查点存储
 * 将检查点持久化到磁盘文件，支持 TAORLoop 的中断恢复
 * 存储路径遵循文件存储规范第二层：app/data/checkpoints/
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDataDir } from '@modules/core';
import type { TAORCheckpoint, CheckpointStorage } from './types.js';

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

  private ensureDir(): void {
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
      `checkpoint-${checkpoint.sessionId}-${checkpoint.id}.json`
    );
  }

  private filePathById(sessionId: string, id: string): string {
    return path.join(this.storageDir, `checkpoint-${sessionId}-${id}.json`);
  }

  async save(checkpoint: TAORCheckpoint): Promise<string> {
    this.ensureDir();
    const filePath = this.filePath(checkpoint);
    const data = JSON.stringify(checkpoint, null, 2);
    await fs.promises.writeFile(filePath, data, 'utf-8');
    return checkpoint.id;
  }

  async load(id: string): Promise<TAORCheckpoint | null> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(`checkpoint-.+-${escapeRegex(id)}\\.json$`);
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
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      const matched = files.filter((f) => pattern.test(f));
      if (matched.length === 0) return null;

      const checkpoints: TAORCheckpoint[] = [];
      for (const file of matched) {
        try {
          const content = await fs.promises.readFile(
            path.join(this.storageDir, file),
            'utf-8'
          );
          checkpoints.push(JSON.parse(content) as TAORCheckpoint);
        } catch {
          continue;
        }
      }

      return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(`checkpoint-.+-${escapeRegex(id)}\\.json$`);
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return false;

      await fs.promises.unlink(path.join(this.storageDir, matched));
      return true;
    } catch {
      return false;
    }
  }

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
