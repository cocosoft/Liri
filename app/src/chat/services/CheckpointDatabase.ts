import { join } from 'path';
import { Database } from '@modules/core/external/sqlite3';
import type { SessionCheckpoint } from '@modules/session/types/checkpoint';
import type { CheckpointStorage } from '@modules/session/types/checkpoint';
import {
  CHECKPOINT_TABLE,
  CHECKPOINT_MAX_AUTO,
} from '@modules/session/types/checkpoint';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveDbPath, resolveScopedDbPath } from '@modules/core';
// 多租户 P1（2026-10-21）：检查点库按身份分实例（本地身份仍用共享 app.db）
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '@modules/core/identity/requestScope.js';
import { registerScopedResource } from '@modules/core/identity/scopedResources.js';

const logger = getLogger('chat:checkpoint');

export class CheckpointDatabase implements CheckpointStorage {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  private async initDatabase(): Promise<void> {
    if (this.db) {
      return;
    }

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });

    await this.createTables();
  }

  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE TABLE IF NOT EXISTS ${CHECKPOINT_TABLE} (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          label TEXT,
          description TEXT,
          created_at INTEGER NOT NULL,
          messages TEXT NOT NULL,
          metadata TEXT NOT NULL,
          state TEXT NOT NULL,
          token_count INTEGER DEFAULT 0,
          auto_created INTEGER DEFAULT 0
        )
      `,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id
        ON ${CHECKPOINT_TABLE}(session_id)
      `,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE INDEX IF NOT EXISTS idx_checkpoints_created_at
        ON ${CHECKPOINT_TABLE}(created_at)
      `,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async saveCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT OR REPLACE INTO ${CHECKPOINT_TABLE}
        (id, session_id, label, description, created_at, messages, metadata, state, token_count, auto_created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpoint.id,
          checkpoint.sessionId,
          checkpoint.label || null,
          checkpoint.description || null,
          checkpoint.createdAt,
          JSON.stringify(checkpoint.messages),
          JSON.stringify(checkpoint.metadata),
          checkpoint.state,
          checkpoint.tokenCount || 0,
          checkpoint.autoCreated ? 1 : 0,
        ],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    await this.enforceMaxCheckpoints(checkpoint.sessionId);
  }

  async loadCheckpoint(
    checkpointId: string
  ): Promise<SessionCheckpoint | null> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const row = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT * FROM ${CHECKPOINT_TABLE} WHERE id = ?`,
        [checkpointId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!row) {
      return null;
    }

    return this.rowToCheckpoint(row);
  }

  async loadCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${CHECKPOINT_TABLE} WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });

    return rows.map((row) => this.rowToCheckpoint(row));
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `DELETE FROM ${CHECKPOINT_TABLE} WHERE id = ?`,
        [checkpointId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async deleteSessionCheckpoints(sessionId: string): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `DELETE FROM ${CHECKPOINT_TABLE} WHERE session_id = ?`,
        [sessionId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getCheckpointCount(sessionId: string): Promise<number> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const row = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT COUNT(*) as count FROM ${CHECKPOINT_TABLE} WHERE session_id = ?`,
        [sessionId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    return ((row as Record<string, unknown>)?.count as number) || 0;
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpoint | null> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const row = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT * FROM ${CHECKPOINT_TABLE} WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
        [sessionId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!row) {
      return null;
    }

    return this.rowToCheckpoint(row);
  }

  private async enforceMaxCheckpoints(sessionId: string): Promise<void> {
    const count = await this.getCheckpointCount(sessionId);
    if (count <= CHECKPOINT_MAX_AUTO) {
      return;
    }

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(
        `SELECT id FROM ${CHECKPOINT_TABLE} WHERE session_id = ? AND auto_created = 1 ORDER BY created_at ASC`,
        [sessionId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });

    const toDelete = count - CHECKPOINT_MAX_AUTO;
    for (let i = 0; i < toDelete && i < rows.length; i++) {
      await this.deleteCheckpoint(rows[i].id);
    }
  }

  private rowToCheckpoint(row: any): SessionCheckpoint {
    return {
      id: row.id,
      sessionId: row.session_id,
      label: row.label || undefined,
      description: row.description || undefined,
      createdAt: row.created_at,
      messages: JSON.parse(row.messages),
      metadata: JSON.parse(row.metadata),
      state: row.state,
      tokenCount: row.token_count || undefined,
      autoCreated: row.auto_created === 1,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db?.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      this.db = null;
    }
  }
}

export function createCheckpointDatabase(dbPath?: string): CheckpointDatabase {
  return new CheckpointDatabase(dbPath);
}

let sharedCheckpointDb: CheckpointDatabase | null = null;
/** 多租户 P1：非本地身份的检查点库实例（各自独立 app.db） */
const scopedCheckpointDbs = new Map<string, CheckpointDatabase>();

/**
 * 取检查点库（多租户 P1）。
 *
 * 本地身份 ⇒ 原共享实例（零变更）；已认证身份 ⇒ 该身份自己的实例
 * （`<scoped>/app.db`）。**不做"共享实例换连接"**：`this.db` 是单字段，
 * 并发请求会在 `await` 交错点串到别人的库。
 */
export function getCheckpointDatabase(): CheckpointDatabase {
  const principal = getRequestPrincipal();
  if (isLocalPrincipal(principal)) {
    if (!sharedCheckpointDb) sharedCheckpointDb = new CheckpointDatabase();
    return sharedCheckpointDb;
  }
  const key = principalKeyOf(principal);
  const existing = scopedCheckpointDbs.get(key);
  if (existing) return existing;
  const scoped = new CheckpointDatabase(resolveScopedDbPath(principal));
  scopedCheckpointDbs.set(key, scoped);
  // 多租户 P5：登记 closer（关连接 + 摘除本模块缓存），删租户时统一释放文件句柄
  registerScopedResource(key, async () => {
    await scoped.close();
    scopedCheckpointDbs.delete(key);
  });
  return scoped;
}

/** 仅测试：重置共享与分区实例 */
export function resetCheckpointDatabaseForTest(): void {
  sharedCheckpointDb = null;
  scopedCheckpointDbs.clear();
}

/**
 * `CheckpointStorage` 的**身份感知代理**（多租户 P1）。
 *
 * 为什么需要代理：`SessionCheckpointService` 在构造期就持有一个 storage 引用，
 * 若继续持有单个 `CheckpointDatabase`，服务端多用户下会把检查点写进同一库。
 * 代理**每次调用**按当前请求身份取实例 ⇒ 无需改动服务的字段与所有调用点。
 */
export class ScopedCheckpointStorage implements CheckpointStorage {
  saveCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    return getCheckpointDatabase().saveCheckpoint(checkpoint);
  }
  loadCheckpoint(checkpointId: string): Promise<SessionCheckpoint | null> {
    return getCheckpointDatabase().loadCheckpoint(checkpointId);
  }
  loadCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    return getCheckpointDatabase().loadCheckpoints(sessionId);
  }
  deleteCheckpoint(checkpointId: string): Promise<void> {
    return getCheckpointDatabase().deleteCheckpoint(checkpointId);
  }
  deleteSessionCheckpoints(sessionId: string): Promise<void> {
    return getCheckpointDatabase().deleteSessionCheckpoints(sessionId);
  }
  getCheckpointCount(sessionId: string): Promise<number> {
    return getCheckpointDatabase().getCheckpointCount(sessionId);
  }
  getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | null> {
    return getCheckpointDatabase().getLatestCheckpoint(sessionId);
  }
}
