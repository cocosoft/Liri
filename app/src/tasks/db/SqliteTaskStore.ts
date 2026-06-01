import { join } from 'path';
import { Database } from 'sqlite3';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { DatabaseError } from '@modules/error';
import { resolveDbPath } from '@modules/config/paths';
import { SCHEMA, FTS5_SCHEMA, TABLE_NAMES } from './schema';
import type { TaskState } from '../types';
import type {
  TaskFlowRecord,
  TaskFlowSyncMode,
  TaskFlowStatus,
} from '../types';
import type { DeliveryRecord } from '../TaskNotificationService';
import type { TaskDeliveryConfig } from '../TaskDeliveryAdapter';
import type { ITaskStore } from '../store/ITaskStore';

export interface TaskRun {
  id: string;
  taskId: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
}

export interface SearchResult {
  taskId: string;
  description: string;
  error?: string;
  score: number;
}

const logger = new Logger({ level: LogLevel.INFO });

function rowToTaskState(row: any): TaskState {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time ?? undefined,
    toolUseCount: row.tool_use_count,
    tokenCount: row.token_count,
    outputFile: row.output_file,
    outputOffset: row.output_offset,
    notified: row.notified === 1,
    error: row.error ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

function taskStateToRow(state: TaskState): Record<string, unknown> {
  return {
    id: state.id,
    type: state.type,
    status: state.status,
    description: state.description,
    start_time: state.startTime,
    end_time: state.endTime ?? null,
    tool_use_count: state.toolUseCount,
    token_count: state.tokenCount,
    output_file: state.outputFile,
    output_offset: state.outputOffset,
    notified: state.notified ? 1 : 0,
    error: state.error ?? null,
    metadata: state.metadata ? JSON.stringify(state.metadata) : null,
    updated_at: Date.now(),
  };
}

function rowToTaskFlowRecord(row: any): TaskFlowRecord {
  return {
    flowId: row.flow_id,
    syncMode: row.sync_mode as TaskFlowSyncMode,
    ownerKey: row.owner_key,
    revision: row.revision,
    status: row.status as TaskFlowStatus,
    goal: row.goal,
    currentStep: row.current_step ?? undefined,
    blockedTaskId: row.blocked_task_id ?? undefined,
    stateJson: row.state_json ? JSON.parse(row.state_json) : undefined,
    waitJson: row.wait_json ? JSON.parse(row.wait_json) : undefined,
    cancelRequestedAt: row.cancel_requested_at ?? undefined,
  };
}

function taskFlowRecordToRow(record: TaskFlowRecord): Record<string, unknown> {
  return {
    flow_id: record.flowId,
    sync_mode: record.syncMode,
    owner_key: record.ownerKey,
    revision: record.revision,
    status: record.status,
    goal: record.goal,
    current_step: record.currentStep ?? null,
    blocked_task_id: record.blockedTaskId ?? null,
    state_json: record.stateJson ? JSON.stringify(record.stateJson) : null,
    wait_json: record.waitJson ? JSON.stringify(record.waitJson) : null,
    cancel_requested_at: record.cancelRequestedAt ?? null,
  };
}

export class SqliteTaskStore implements ITaskStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTables();
    logger.info('SqliteTaskStore initialized', { dbPath: this.dbPath });
  }

  private async createTables(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not initialized',
        undefined,
        undefined,
        { method: 'createTables' }
      );
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(SCHEMA, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.db!.exec(FTS5_SCHEMA, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch {
      logger.warn('FTS5 not available, full-text search disabled');
    }
  }

  private withDb<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.db)
      throw new DatabaseError(
        'SqliteTaskStore not initialized. Call init() first.'
      );
    return fn();
  }

  async saveTaskState(state: TaskState): Promise<void> {
    return this.withDb(async () => {
      const row = taskStateToRow(state);
      const keys = Object.keys(row);
      const values = Object.values(row);
      const placeholders = keys.map(() => '?').join(', ');
      const updates = keys.map((k) => `${k} = ?`).join(', ');

      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${TABLE_NAMES.TASK_STATES} (${keys.join(', ')})
           VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updates}`,
          [...values, ...values],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      await this.tryUpdateFtsIndex(state);
    });
  }

  /** 更新 FTS 索引 */
  private async tryUpdateFtsIndex(state: TaskState): Promise<void> {
    try {
      const description = state.description || '';
      const error = state.error || '';
      const metadata = state.metadata ? JSON.stringify(state.metadata) : '';
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO task_states_fts (rowid, description, error, metadata)
           VALUES ((SELECT rowid FROM ${TABLE_NAMES.TASK_STATES} WHERE id = ?), ?, ?, ?)
           ON CONFLICT(rowid) DO UPDATE SET
             description = excluded.description,
             error = excluded.error,
             metadata = excluded.metadata`,
          [state.id, description, error, metadata],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch {
      logger.warn('FTS5 not available, full-text search disabled');
    }
  }

  async saveTaskStates(states: TaskState[]): Promise<void> {
    for (const state of states) {
      await this.saveTaskState(state);
    }
  }

  async loadTaskStates(): Promise<TaskState[]> {
    return this.withDb(async () => {
      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${TABLE_NAMES.TASK_STATES} ORDER BY start_time DESC`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      return rows.map(rowToTaskState);
    });
  }

  async getTaskState(taskId: string): Promise<TaskState | null> {
    return this.withDb(async () => {
      const row = await new Promise<any>((resolve, reject) => {
        this.db!.get(
          `SELECT * FROM ${TABLE_NAMES.TASK_STATES} WHERE id = ?`,
          [taskId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      return row ? rowToTaskState(row) : null;
    });
  }

  async deleteTaskState(taskId: string): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAMES.TASK_STATES} WHERE id = ?`,
          [taskId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  async clearFinishedStates(): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAMES.TASK_STATES}
           WHERE status IN ('completed', 'failed', 'killed')`,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  async countByStatus(): Promise<Record<string, number>> {
    return this.withDb(async () => {
      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(
          `SELECT status, COUNT(*) as count FROM ${TABLE_NAMES.TASK_STATES} GROUP BY status`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      const result: Record<string, number> = {};
      for (const row of rows) {
        result[row.status] = row.count;
      }
      return result;
    });
  }

  async queryByStatus(status: string): Promise<TaskState[]> {
    return this.withDb(async () => {
      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${TABLE_NAMES.TASK_STATES} WHERE status = ? ORDER BY start_time DESC`,
          [status],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      return rows.map(rowToTaskState);
    });
  }

  /** 审计日志 */
  async appendAuditLog(
    taskId: string,
    eventType: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${TABLE_NAMES.TASK_AUDIT_LOG}
           (task_id, event_type, old_status, new_status, detail, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            eventType,
            detail.oldStatus ?? null,
            detail.newStatus ?? null,
            detail.message ? JSON.stringify(detail.message) : null,
            Date.now(),
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  async queryAuditLog(
    taskId?: string,
    limit: number = 100
  ): Promise<
    Array<{
      taskId: string;
      eventType: string;
      detail: Record<string, unknown>;
      timestamp: number;
    }>
  > {
    return this.withDb(async () => {
      let sql = `SELECT * FROM ${TABLE_NAMES.TASK_AUDIT_LOG}`;
      const params: unknown[] = [];
      if (taskId) {
        sql += ' WHERE task_id = ?';
        params.push(taskId);
      }
      sql += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      return rows.map((r) => ({
        taskId: r.task_id,
        eventType: r.event_type,
        detail: r.detail ? JSON.parse(r.detail) : {},
        timestamp: r.timestamp,
      }));
    });
  }

  /** 保存任务流记录 */
  async saveTaskFlowRecord(record: TaskFlowRecord): Promise<void> {
    return this.withDb(async () => {
      const row = taskFlowRecordToRow(record);
      const keys = Object.keys(row);
      const values = Object.values(row);
      const placeholders = keys.map(() => '?').join(', ');
      const updates = keys.map((k) => `${k} = ?`).join(', ');

      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${TABLE_NAMES.TASK_FLOW} (${keys.join(', ')})
           VALUES (${placeholders})
           ON CONFLICT(flow_id) DO UPDATE SET ${updates}`,
          [...values, ...values],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /** 加载所有任务流记录 */
  async loadTaskFlowRecords(): Promise<TaskFlowRecord[]> {
    return this.withDb(async () => {
      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${TABLE_NAMES.TASK_FLOW} ORDER BY flow_id`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      return rows.map(rowToTaskFlowRecord);
    });
  }

  /** 获取指定任务流记录 */
  async getTaskFlowRecord(flowId: string): Promise<TaskFlowRecord | null> {
    return this.withDb(async () => {
      const row = await new Promise<any>((resolve, reject) => {
        this.db!.get(
          `SELECT * FROM ${TABLE_NAMES.TASK_FLOW} WHERE flow_id = ?`,
          [flowId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      return row ? rowToTaskFlowRecord(row) : null;
    });
  }

  /** 删除任务流记录 */
  async deleteTaskFlowRecord(flowId: string): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAMES.TASK_FLOW} WHERE flow_id = ?`,
          [flowId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /** 保存投递记录 */
  async saveDeliveryRecord(record: DeliveryRecord): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT OR REPLACE INTO ${TABLE_NAMES.TASK_DELIVERY}
           (task_id, status, deliver_at, delivered_at, retry_count, error, notify_policy)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            record.taskId,
            record.status,
            Date.now(),
            record.lastAttempt,
            record.attemptCount,
            record.error ?? null,
            'done_only',
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /** 加载所有投递记录 */
  async loadDeliveryRecords(): Promise<DeliveryRecord[]> {
    return this.withDb(async () => {
      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${TABLE_NAMES.TASK_DELIVERY} ORDER BY task_id`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      return rows.map(rowToDeliveryRecord);
    });
  }

  /** 删除投递记录 */
  async deleteDeliveryRecord(taskId: string): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAMES.TASK_DELIVERY} WHERE task_id = ?`,
          [taskId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /** 保存任务运行记录 */
  async saveRun(run: TaskRun): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${TABLE_NAMES.TASK_RUNS} (id, task_id, status, started_at, completed_at, output, error)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             started_at = excluded.started_at,
             completed_at = excluded.completed_at,
             output = excluded.output,
             error = excluded.error`,
          [
            run.id,
            run.taskId,
            run.status,
            run.startedAt ?? null,
            run.completedAt ?? null,
            run.output ?? null,
            run.error ?? null,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /** 获取指定任务的所有运行记录 */
  async getRunsByTaskId(taskId: string): Promise<TaskRun[]> {
    return this.withDb(async () => {
      const rows = await new Promise<any[]>((resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${TABLE_NAMES.TASK_RUNS} WHERE task_id = ? ORDER BY started_at DESC`,
          [taskId],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      return rows.map(rowToTaskRun);
    });
  }

  /** 删除指定任务的所有运行记录 */
  async deleteRunsByTaskId(taskId: string): Promise<void> {
    return this.withDb(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${TABLE_NAMES.TASK_RUNS} WHERE task_id = ?`,
          [taskId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /** 全文搜索任务（FTS5），降级到 LIKE 搜索 */
  async searchTasks(
    query: string,
    limit: number = 20
  ): Promise<SearchResult[]> {
    return this.withDb(async () => {
      try {
        const rows = await new Promise<any[]>((resolve, reject) => {
          this.db!.all(
            `SELECT t.id, t.description, t.error, rank
             FROM task_states_fts f
             JOIN ${TABLE_NAMES.TASK_STATES} t ON f.rowid = t.rowid
             WHERE task_states_fts MATCH ?
             ORDER BY rank
             LIMIT ?`,
            [query, limit],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });
        return rows.map((r) => ({
          taskId: r.id,
          description: r.description,
          error: r.error ?? undefined,
          score: r.rank,
        }));
      } catch {
        return this.searchTasksFallback(query, limit);
      }
    });
  }

  /** LIKE 搜索（FTS5 不可用时的降级方案） */
  private async searchTasksFallback(
    query: string,
    limit: number
  ): Promise<SearchResult[]> {
    const pattern = `%${query}%`;
    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT id, description, error FROM ${TABLE_NAMES.TASK_STATES}
         WHERE description LIKE ? OR error LIKE ?
         ORDER BY updated_at DESC
         LIMIT ?`,
        [pattern, pattern, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
    return rows.map((r) => ({
      taskId: r.id,
      description: r.description,
      error: r.error ?? undefined,
      score: 0,
    }));
  }

  /** 从 JSON 文件迁移到 SQLite */
  async migrateFromJsonFile(
    jsonPath: string
  ): Promise<{ migrated: number; skipped: number }> {
    const fs = await import('fs/promises');
    try {
      const content = await fs.readFile(jsonPath, 'utf-8');
      const states: TaskState[] = JSON.parse(content);
      let migrated = 0;
      let skipped = 0;

      for (const state of states) {
        const existing = await this.getTaskState(state.id);
        if (existing) {
          skipped++;
          continue;
        }
        await this.saveTaskState(state);
        migrated++;
      }

      logger.info('Migration from JSON file completed', {
        jsonPath,
        migrated,
        skipped,
      });
      return { migrated, skipped };
    } catch (error) {
      logger.error(
        'Migration from JSON file failed',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.db = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.db) return false;
    try {
      await new Promise<void>((resolve, reject) => {
        this.db!.get('SELECT 1 AS ok', (err, row) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return true;
    } catch {
      return false;
    }
  }
}

function rowToTaskRun(row: any): TaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToDeliveryRecord(row: any): DeliveryRecord {
  return {
    taskId: row.task_id,
    status: row.status,
    lastAttempt: row.delivered_at ?? row.deliver_at ?? Date.now(),
    attemptCount: row.retry_count ?? 0,
    error: row.error ?? undefined,
  };
}

export function createSqliteTaskStore(dbPath?: string): SqliteTaskStore {
  return new SqliteTaskStore(dbPath);
}
