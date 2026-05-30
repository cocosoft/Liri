import { join } from 'path';
import { Database } from 'sqlite3';
import type { SessionCheckpoint } from '../types/checkpoint';
import type { CheckpointStorage } from '../types/checkpoint';
import { CHECKPOINT_TABLE, CHECKPOINT_MAX_AUTO } from '../types/checkpoint';
import { Logger } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { resolveDataDir } from '@modules/config/paths';

const logger = new Logger();

export class CheckpointDatabase implements CheckpointStorage {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = join(resolveDataDir(), 'py_copilot.db')) {
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
