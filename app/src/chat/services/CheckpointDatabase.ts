import { join } from 'path';
import { Database } from '@openliri/kernel/external/sqlite3';
import type { SessionCheckpoint } from '@modules/session/types/checkpoint';
import type { CheckpointStorage } from '@modules/session/types/checkpoint';
import {
  CHECKPOINT_TABLE,
  CHECKPOINT_MAX_AUTO,
} from '@modules/session/types/checkpoint';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveDbPath, resolveTenantDbPath } from '@openliri/kernel';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';

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
          auto_created INTEGER DEFAULT 0,
          owner_key TEXT NOT NULL DEFAULT 'local:local'
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
    await this.ensureOwnerColumn();

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

  /**
   * 存量库补 `owner_key` 列（默认 `local:local` ⇒ 桌面端历史行仍归属本地身份、仍可见）。
   */
  private async ensureOwnerColumn(): Promise<void> {
    const columns = await new Promise<Array<Record<string, unknown>>>(
      (resolve, reject) => {
        this.db?.all(
          `PRAGMA table_info(${CHECKPOINT_TABLE})`,
          [],
          (err: Error | null, rows: unknown[]) =>
            err
              ? reject(err)
              : resolve((rows || []) as Array<Record<string, unknown>>)
        );
      }
    );
    if (columns.some((c) => c.name === 'owner_key')) return;
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `ALTER TABLE ${CHECKPOINT_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  /** 当前写入/查询的归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
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
        (id, session_id, label, description, created_at, messages, metadata, state, token_count, auto_created, owner_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          this.owner(),
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
        `SELECT * FROM ${CHECKPOINT_TABLE}
         WHERE id = ? AND owner_key = ?`,
        [checkpointId, this.owner()],
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
        `SELECT * FROM ${CHECKPOINT_TABLE}
         WHERE session_id = ? AND owner_key = ? ORDER BY created_at ASC`,
        [sessionId, this.owner()],
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
        `DELETE FROM ${CHECKPOINT_TABLE} WHERE id = ? AND owner_key = ?`,
        [checkpointId, this.owner()],
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
        `DELETE FROM ${CHECKPOINT_TABLE}
         WHERE session_id = ? AND owner_key = ?`,
        [sessionId, this.owner()],
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
        `SELECT COUNT(*) as count FROM ${CHECKPOINT_TABLE}
         WHERE session_id = ? AND owner_key = ?`,
        [sessionId, this.owner()],
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
        `SELECT * FROM ${CHECKPOINT_TABLE}
         WHERE session_id = ? AND owner_key = ? ORDER BY created_at DESC LIMIT 1`,
        [sessionId, this.owner()],
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
        `SELECT id FROM ${CHECKPOINT_TABLE}
         WHERE session_id = ? AND auto_created = 1 AND owner_key = ?
         ORDER BY created_at ASC`,
        [sessionId, this.owner()],
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
/** 租户级 DB（§6.1）：实例按**租户**缓存（同租户用户共用连接，行级隔离靠 `owner_key`） */
const scopedCheckpointDbs = new Map<string, CheckpointDatabase>(); // key = tenantId

/**
 * 取检查点库。
 *
 * 多租户 §6.1：本地身份 ⇒ 原共享实例（零变更）；已认证身份 ⇒ 该**租户**的实例
 * （`tenants/<t>/app.db`），用户维度靠 `owner_key` 过滤。
 */
export function getCheckpointDatabase(): CheckpointDatabase {
  const principal = getRequestPrincipal();
  if (isLocalPrincipal(principal)) {
    if (!sharedCheckpointDb) sharedCheckpointDb = new CheckpointDatabase();
    return sharedCheckpointDb;
  }
  const tenantKey = principal.tenantId;
  const existing = scopedCheckpointDbs.get(tenantKey);
  if (existing) return existing;
  const scoped = new CheckpointDatabase(resolveTenantDbPath(principal));
  scopedCheckpointDbs.set(tenantKey, scoped);
  // 登记键用**创建者**的 `<tenant>:<user>`：purge 按 `<tenant>:` 前缀关闭 ⇒ 删租户能命中
  registerScopedResource(principalKeyOf(principal), async () => {
    await scoped.close();
    scopedCheckpointDbs.delete(tenantKey);
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
