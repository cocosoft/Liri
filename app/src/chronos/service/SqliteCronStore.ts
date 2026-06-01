import { join } from 'path';
import { Database } from 'sqlite3';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveDbPath } from '@modules/config/paths';
import { nextCronRunMs } from '../CronTasks';
import type { ScheduledTask } from '../types';

const logger = new Logger({ level: LogLevel.INFO });

const TABLE = 'scheduled_tasks';
const RUNS_TABLE = 'cron_runs';

function rowToScheduledTask(row: any): ScheduledTask {
  return {
    id: row.id,
    cron: row.cron,
    prompt: row.prompt,
    createdAt: row.created_at,
    lastFiredAt: row.last_fired_at ?? undefined,
    recurring: row.recurring === 1,
    permanent: row.permanent === 1,
    durable: row.durable === 1,
    agentId: row.agent_id ?? undefined,
    taskType: row.task_type ?? 'prompt',
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

function scheduledTaskToRow(task: ScheduledTask): Record<string, unknown> {
  return {
    id: task.id,
    cron: task.cron,
    prompt: task.prompt,
    created_at: task.createdAt,
    last_fired_at: task.lastFiredAt ?? null,
    recurring: task.recurring ? 1 : 0,
    permanent: task.permanent ? 1 : 0,
    durable: task.durable ? 1 : 0,
    agent_id: task.agentId ?? null,
    task_type: task.taskType,
    metadata: task.metadata ? JSON.stringify(task.metadata) : null,
  };
}

export interface CronRun {
  id: string;
  taskId: string;
  startedAt: number;
  completedAt?: number;
  status: string;
  exitCode?: number;
  output?: string;
  error?: string;
}

export interface SqliteCronStoreOptions {
  dbPath?: string;
}

export class SqliteCronStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(options: SqliteCronStoreOptions = {}) {
    this.dbPath = options.dbPath ?? resolveDbPath();
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
    logger.info('SqliteCronStore initialized', { dbPath: this.dbPath });
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id TEXT PRIMARY KEY,
          cron TEXT NOT NULL,
          prompt TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_fired_at INTEGER,
          recurring INTEGER DEFAULT 1,
          permanent INTEGER DEFAULT 0,
          durable INTEGER DEFAULT 1,
          agent_id TEXT,
          task_type TEXT DEFAULT 'prompt',
          metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_cron ON ${TABLE}(cron);
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_created ON ${TABLE}(created_at);

        CREATE TABLE IF NOT EXISTS ${RUNS_TABLE} (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          status TEXT NOT NULL DEFAULT 'running',
          exit_code INTEGER,
          output TEXT,
          error TEXT,
          FOREIGN KEY (task_id) REFERENCES ${TABLE}(id)
        );

        CREATE INDEX IF NOT EXISTS idx_cron_runs_task_id ON ${RUNS_TABLE}(task_id);
        CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON ${RUNS_TABLE}(status);
        `,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async listTasks(): Promise<ScheduledTask[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${TABLE} ORDER BY created_at DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
    return rows.map(rowToScheduledTask);
  }

  async getTask(taskId: string): Promise<ScheduledTask | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${TABLE} WHERE id = ?`,
        [taskId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    return row ? rowToScheduledTask(row) : null;
  }

  async addTask(task: ScheduledTask): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const row = scheduledTaskToRow(task);
    const keys = Object.keys(row);
    const values = Object.values(row);
    const placeholders = keys.map(() => '?').join(', ');

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO ${TABLE} (${keys.join(', ')})
         VALUES (${placeholders})`,
        values,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async removeTasks(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const placeholders = ids.map(() => '?').join(', ');
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TABLE} WHERE id IN (${placeholders})`,
        ids,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async markFired(ids: string[], firedAt: number): Promise<void> {
    if (ids.length === 0) return;
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const placeholders = ids.map(() => '?').join(', ');
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${TABLE} SET last_fired_at = ? WHERE id IN (${placeholders})`,
        [firedAt, ...ids],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async updateTask(
    taskId: string,
    updates: Partial<ScheduledTask>
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const row = scheduledTaskToRow(updates as ScheduledTask);
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(row)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) return;

    values.push(taskId);
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = ?`,
        values,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async countTasks(): Promise<number> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(`SELECT COUNT(*) as count FROM ${TABLE}`, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    return row?.count ?? 0;
  }

  /** 保存 cron 任务运行记录 */
  async addRun(run: CronRun): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO ${RUNS_TABLE} (id, task_id, started_at, completed_at, status, exit_code, output, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.id,
          run.taskId,
          run.startedAt,
          run.completedAt ?? null,
          run.status,
          run.exitCode ?? null,
          run.output ?? null,
          run.error ?? null,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 获取指定 cron 任务的所有运行记录 */
  async getRunsByTaskId(taskId: string): Promise<CronRun[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${RUNS_TABLE} WHERE task_id = ? ORDER BY started_at DESC`,
        [taskId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
    return rows.map(rowToCronRun);
  }

  /** 删除指定 cron 任务的所有运行记录 */
  async deleteRunsByTaskId(taskId: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${RUNS_TABLE} WHERE task_id = ?`,
        [taskId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 恢复启动时遗漏的 cron 任务（检测上次 fired 后应触发但未触发的任务） */
  async recoverMissedJobs(
    nowMs: number = Date.now()
  ): Promise<ScheduledTask[]> {
    const tasks = await this.listTasks();
    const missed: ScheduledTask[] = [];

    for (const task of tasks) {
      if (!task.recurring || !task.permanent) continue;
      const nextRun = nextCronRunMs(
        task.cron,
        task.lastFiredAt ?? task.createdAt
      );
      if (nextRun !== null && nextRun < nowMs) {
        missed.push(task);
      }
    }

    if (missed.length > 0) {
      logger.info('Recovered missed cron jobs', {
        count: missed.length,
        ids: missed.map((m) => m.id),
      });
    }

    return missed;
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
}

function rowToCronRun(row: any): CronRun {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status,
    exitCode: row.exit_code ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}

export function createSqliteCronStore(dbPath?: string): SqliteCronStore {
  return new SqliteCronStore({ dbPath });
}
