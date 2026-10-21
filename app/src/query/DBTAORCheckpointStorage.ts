/**
 * DBTAORCheckpointStorage — 数据库 TAOR 检查点存储
 *
 * RC-D（08-09）：将 TAOR 检查点从文件系统迁移到 app.db，
 * 确保服务端重启后检查点不丢失。
 *
 * 实现 CheckpointStorage 接口，与 FileTAORCheckpointStorage 可互换。
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveScopedDbPath } from '@modules/core';
// 多租户 P5：非本地身份的分区句柄登记（删租户时统一释放）
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '@modules/core/identity/requestScope.js';
import { registerScopedResource } from '@modules/core/identity/scopedResources.js';
import { getLogger } from '@modules/monitoring';
import { isCheckpointLogEnabled } from '@modules/config';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import type { TAORCheckpoint, TAORCheckpointStorage } from './types.js';

const logger = getLogger('query:dbTAORCheckpoint');

const TAOR_CHECKPOINTS_TABLE_NAME = 'taor_checkpoints';

export class DBTAORCheckpointStorage implements TAORCheckpointStorage {
  private db: Database | null = null;
  private dbPath: string;

  /**
   * 多租户 P1（2026-10-21）：缺省路径**按当前身份解析**。
   *
   * 本类的实例是**每会话/每循环**创建（`TAORLoop` / `ResumeManager` 各 new 一个），
   * 而非进程单例 ⇒ 在创建它的请求作用域内解析路径即可，不存在"共享实例换连接"的竞态。
   */
  constructor(dbPath: string = resolveScopedDbPath()) {
    this.dbPath = dbPath;
  }

  /** 登记器返回的摘除句柄（非本地身份才有；`close()` 时一并撤销） */
  private unregisterScopedResource: (() => void) | null = null;

  /**
   * 关闭连接（幂等）。
   *
   * 本类实例是**每会话/每循环**创建，用完不关会残留分区 `app.db` 句柄（Windows 上
   * 删租户目录会 `blocked`）。`close()` 由两处调用：
   *   - `TAORLoop` 在 `runCollect` / `flushCheckpoint` 收尾（自建存储时）；
   *   - 删租户时 `core/identity/scopedResources` 的登记器（覆盖"循环还在跑"的情况）。
   * 关闭后再次 `save()` 会重新开库（`initDatabase()` 以 `this.db` 为空为判据）。
   */
  close(): void {
    this.unregisterScopedResource?.();
    this.unregisterScopedResource = null;
    try {
      this.db?.close();
    } catch {
      // 已关闭 / 关闭中：忽略（幂等）
    }
    this.db = null;
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

    // 多租户 P5：非本地身份才登记（本地身份无租户归属，删租户与它无关）。
    // 登记后即使循环还在跑，删租户也能把句柄关掉；正常收尾由 TAORLoop 调 `close()` 撤销登记。
    if (!this.unregisterScopedResource) {
      const principal = getRequestPrincipal();
      if (!isLocalPrincipal(principal)) {
        this.unregisterScopedResource = registerScopedResource(
          principalKeyOf(principal),
          () => this.close()
        );
      }
    }
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
        `CREATE TABLE IF NOT EXISTS ${TAOR_CHECKPOINTS_TABLE_NAME} (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_count INTEGER NOT NULL,
          phase TEXT NOT NULL,
          budget_state TEXT NOT NULL,
          conversation_summary TEXT NOT NULL DEFAULT '',
          last_prompt TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          type TEXT NOT NULL DEFAULT 'auto',
          kind TEXT NOT NULL DEFAULT 'chat',
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
        `CREATE INDEX IF NOT EXISTS idx_taor_cp_session_id ON ${TAOR_CHECKPOINTS_TABLE_NAME}(session_id)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_taor_cp_created_at ON ${TAOR_CHECKPOINTS_TABLE_NAME}(created_at)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // A 阶段一（2026-09-05）：存量 DB 幂等补 kind 列（新库建表已含；旧库 ADD COLUMN）。
    // 与 PDCA 方案 §四 兼容策略同款「先加后 toggle」——列已存在时 ALTER 报错，忽略即可。
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${TAOR_CHECKPOINTS_TABLE_NAME} ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'`,
        () => resolve()
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
          `INSERT OR REPLACE INTO ${TAOR_CHECKPOINTS_TABLE_NAME}
        (id, session_id, turn_count, phase, budget_state, conversation_summary,
         last_prompt, created_at, type, kind, breaker_state, loop_detector_state,
         error_recovery_state, pending_tool_calls, message_count, inbox_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            // A 阶段一（2026-09-05）：恢复归属标记，缺省 chat（宽容读侧同）
            checkpoint.kind ?? 'chat',
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
          `SELECT * FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE id = ?`,
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
        `SELECT * FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE session_id = ? ORDER BY created_at DESC`,
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
      this.db!.run(
        `DELETE FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE id = ?`,
        [id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    return true;
  }

  async cleanup(expireTime: number): Promise<number> {
    await this.initDatabase();
    if (!this.db) return 0;

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as count FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE created_at < ?`,
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
          `DELETE FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE created_at < ?`,
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
        // P0 修复（2026-08-14 排查）：过滤空/非法 session_id——脏检查点
        // （session_id=''）会污染 TAORLoop 单例导致会话串扰，此处源头拦截
        `SELECT DISTINCT session_id FROM ${TAOR_CHECKPOINTS_TABLE_NAME}
         WHERE session_id IS NOT NULL AND session_id != ''`,
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
        `SELECT COUNT(*) as count FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE session_id = ?`,
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
          `DELETE FROM ${TAOR_CHECKPOINTS_TABLE_NAME} WHERE session_id = ?`,
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
      // A 阶段一（2026-09-05）：宽容读——历史存量无 kind 列/值，缺省按 chat 处理
      kind: row.kind ?? 'chat',
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
