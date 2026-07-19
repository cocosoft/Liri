/**
 * 会话存储工具
 *
 * 提供基于文件系统的持久化会话存储能力。
 * 用于保存和恢复应用状态、对话历史等。
 */
import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { existsSync } from 'fs';
import { resolvePyappHome } from '@modules/core';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'utils:sessionStorage',
  level: LogLevel.INFO,
});

export interface SessionData<T = unknown> {
  id: string;
  data: T;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, string>;
}

const SESSION_DIR = join(resolvePyappHome(), 'sessions');
const MAX_SESSIONS = 100;

export class SessionStorage {
  private baseDir: string;

  constructor(namespace: string = 'default') {
    this.baseDir = join(SESSION_DIR, namespace);
  }

  async save<T>(
    id: string,
    data: T,
    metadata?: Record<string, string>
  ): Promise<void> {
    const filePath = this.getFilePath(id);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const session: SessionData<T> = {
      id,
      data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata,
    };

    await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
    await this.enforceMaxSessions();
  }

  async load<T>(id: string): Promise<SessionData<T> | null> {
    const filePath = this.getFilePath(id);

    try {
      if (!existsSync(filePath)) return null;
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as SessionData<T>;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getFilePath(id);
    try {
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch (err) {
      // 删除失败时静默处理

      logger.warn('Operation skipped', {
        context: '删除失败时静默处理',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async list(): Promise<string[]> {
    try {
      if (!existsSync(this.baseDir)) return [];
      const files = await readdir(this.baseDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => basename(f, '.json'));
    } catch {
      return [];
    }
  }

  private getFilePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  private async enforceMaxSessions(): Promise<void> {
    try {
      if (!existsSync(this.baseDir)) return;
      const files = await readdir(this.baseDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      if (jsonFiles.length > MAX_SESSIONS) {
        const filesWithStats = await Promise.all(
          jsonFiles.map(async (f) => {
            const filePath = join(this.baseDir, f);
            try {
              const fileStat = await stat(filePath);
              return { name: f, path: filePath, mtime: fileStat.mtimeMs };
            } catch {
              return { name: f, path: filePath, mtime: 0 };
            }
          })
        );

        filesWithStats.sort((a, b) => a.mtime - b.mtime);
        const toDelete = filesWithStats.slice(
          0,
          jsonFiles.length - MAX_SESSIONS
        );

        for (const file of toDelete) {
          await unlink(file.path);
        }
      }
    } catch (err) {
      // 清理失败时静默处理

      logger.warn('Operation skipped', {
        context: '清理失败时静默处理',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
