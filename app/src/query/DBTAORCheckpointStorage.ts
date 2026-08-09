/**
 * DBTAORCheckpointStorage — 数据库 TAOR 检查点存储
 *
 * RC-D（08-09）：将 TAOR 检查点从文件系统迁移到 app.db，
 * 确保服务端重启后检查点不丢失。
 *
 * 实现 CheckpointStorage 接口，与 FileTAORCheckpointStorage 可互换。
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { Logger } from '@modules/monitoring';
import { isCheckpointLogEnabled } from '../config/settings/CheckpointLogConfig';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import type { TAORCheckpoint, CheckpointStorage } from './types.js';

const logger = new Logger({ module: 'query:dbTAORCheckpoint' });

const TABLE_NAME = 'taor_checkpoints';

export class DBTAORCheckpointStorage implements CheckpointStorage {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  private async initDatabase(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
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
        'DBTAOR_1000'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_count INTEGER NOT NULL,
          phase TEXT NOT NULL,
          budget_state TEXT NOT NULL,
          conversation_summary TEXT NOT NULL DEFAULT '',
          last_prompt TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          type TEXT NOT NULL DEFAULT 'auto',
          breaker_state TEXT,
          loop_detector_state TEXT,
          error_recovery_state TEXT,
          pending_tool_calls TEXT,
          message_count INTEGER,
          inbox_state TEXT
        )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_taor_cp_session_id ON ${TABLE_NAME}(session_id)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_taor_cp_created_at ON ${TABLE_NAME}(created_at)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async save(checkpoint: TAORCheckpoint): Promise<string> {
    try {
      await this.initDatabase();
      if (!this.db) {
        throw new AppError(
          'Database not initialized',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'DBTAOR_1001'
        );
      }

      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT OR REPLACE INTO ${TABLE_NAME}
        (id, session_id, turn_count, phase, budget_state, conversation_summary,
         last_prompt, created_at, type, breaker_state, loop_detector_state,
         error_recovery_state, pending_tool_calls, message_count, inbox_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            checkpoint.id,
            checkpoint.sessionId,
            checkpoint.turnCount,
            checkpoint.phase,
            JSON.stringify(checkpoint.budgetState),
            checkpoint.conversationSummary,
            checkpoint.lastPrompt,
            checkpoint.createdAt,
            checkpoint.type,
            checkpoint.breakerState
              ? JSON.stringify(checkpoint.breakerState)
              : null,
            checkpoint.loopDetectorState
              ? JSON.stringify(checkpoint.loopDetectorState)
              : null,
            checkpoint.errorRecoveryState
              ? JSON.stringify(checkpoint.errorRecoveryState)
              : null,
            checkpoint.pendingToolCalls
              ? JSON.stringify(checkpoint.pendingToolCalls)
              : null,
            checkpoint.messageCount ?? null,
            checkpoint.inboxState
              ? JSON.stringify(checkpoint.inboxState)
              : null,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      if (isCheckpointLogEnabled()) {
        logger.info('TAOR checkpoint saved to DB', {
          id: checkpoint.id,
          sessionId: checkpoint.sessionId,
        });
      }
      return checkpoint.id;
    } catch (err) {
      await handleError(err, {
        module: 'query:dbTAORCheckpoint',
        action: 'save',
        context: {
          checkpointId: checkpoint.id,
          sessionId: checkpoint.sessionId,
        },
      });
      throw err;
    }
  }

  async load(id: string): Promise<TAORCheckpoint | null> {
    try {
      await this.initDatabase();
      if (!this.db) return null;

      const row = await new Promise<any>((resolve, reject) => {
        this.db!.get(
          `SELECT * FROM ${TABLE_NAME} WHERE id = ?`,
          [id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      return row ? this.rowToCheckpoint(row) : null;
    } catch (err) {
      await handleError(err, {
        module: 'query:dbTAORCheckpoint',
        action: 'load',
        context: { checkpointId: id },
      });
      return null;
    }
  }

  async findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null> {
    await this.initDatabase();
    if (!this.db) return null;

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${TABLE_NAME} WHERE session_id = ? ORDER BY created_at DESC`,
        [sessionId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    return rows.length > 0 ? rows.map((r) => this.rowToCheckpoint(r)) : null;
  }

  async delete(id: string): Promise<boolean> {
    await this.initDatabase();
    if (!this.db) return false;

    await new Promise<void>((resolve, reject) => {
      this.db!.run(`DELETE FROM ${TABLE_NAME} WHERE id = ?`, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return true;
  }

  async cleanup(expireTime: number): Promise<number> {
    await this.initDatabase();
    if (!this.db) return 0;

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as count FROM ${TABLE_NAME} WHERE created_at < ?`,
        [expireTime],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const count = row?.count ?? 0;
    if (count > 0) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAME} WHERE created_at < ?`,
          [expireTime],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      if (isCheckpointLogEnabled()) {
        logger.info('Cleaned up expired TAOR checkpoints from DB', { count });
      }
    }
    return count;
  }

  /** 获取最新的未完成检查点（用于恢复） */
  async getLatestIncomplete(sessionId: string): Promise<TAORCheckpoint | null> {
    const checkpoints = await this.findBySessionId(sessionId);
    if (!checkpoints || checkpoints.length === 0) return null;
    // 按时间降序排，取最新
    return checkpoints[0];
  }

  /** 获取所有有未完成检查点的 session ID 列表 */
  async getPendingSessions(): Promise<string[]> {
    await this.initDatabase();
    if (!this.db) return [];

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT DISTINCT session_id FROM ${TABLE_NAME}`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    return rows.map((r) => r.session_id);
  }

  /** 删除某 session 的所有检查点 */
  async deleteSession(sessionId: string): Promise<number> {
    await this.initDatabase();
    if (!this.db) return 0;

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as count FROM ${TABLE_NAME} WHERE session_id = ?`,
        [sessionId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const count = row?.count ?? 0;
    if (count > 0) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAME} WHERE session_id = ?`,
          [sessionId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }
    return count;
  }

  private rowToCheckpoint(row: any): TAORCheckpoint {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnCount: row.turn_count,
      phase: row.phase,
      budgetState: JSON.parse(row.budget_state),
      conversationSummary: row.conversation_summary,
      lastPrompt: row.last_prompt,
      createdAt: row.created_at,
      type: row.type,
      breakerState: row.breaker_state
        ? JSON.parse(row.breaker_state)
        : undefined,
      loopDetectorState: row.loop_detector_state
        ? JSON.parse(row.loop_detector_state)
        : undefined,
      errorRecoveryState: row.error_recovery_state
        ? JSON.parse(row.error_recovery_state)
        : undefined,
      pendingToolCalls: row.pending_tool_calls
        ? JSON.parse(row.pending_tool_calls)
        : undefined,
      messageCount: row.message_count ?? undefined,
      inboxState: row.inbox_state ? JSON.parse(row.inbox_state) : undefined,
    };
  }
}
