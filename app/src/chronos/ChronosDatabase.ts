import { join } from 'path';
import { Database } from 'sqlite3';
import type {
  ScheduledTask,
  TaskExecutionHistory,
  SystemConfig,
  TaskStatus,
} from './types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { resolveDbPath } from '@modules/config/paths';

/**
 * Chronos数据库存储实现
 * 用于存储定时任务、执行历史和系统配置
 */
export class ChronosDatabase {
  /**
   * 数据库连接
   */
  private db: Database | null = null;

  /**
   * 数据库文件路径
   */
  private dbPath: string;

  /**
   * 构造函数
   * @param dbPath 数据库文件路径
   */
  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库
   */
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
    await this.initSystemConfig();
  }

  /**
   * 创建数据库表
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await this.createScheduledTasksTable();
    await this.createTaskExecutionHistoryTable();
    await this.createSystemConfigTable();
  }

  /**
   * 创建scheduled_tasks表
   */
  private async createScheduledTasksTable(): Promise<void> {
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
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
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
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_cron 
        ON scheduled_tasks(cron)
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
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_created 
        ON scheduled_tasks(created_at)
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
   * 创建task_execution_history表
   */
  private async createTaskExecutionHistoryTable(): Promise<void> {
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
        CREATE TABLE IF NOT EXISTS task_execution_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          fired_at INTEGER NOT NULL,
          completed_at INTEGER,
          status TEXT DEFAULT 'pending',
          result TEXT,
          error TEXT,
          FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
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
        CREATE INDEX IF NOT EXISTS idx_history_task 
        ON task_execution_history(task_id)
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
        CREATE INDEX IF NOT EXISTS idx_history_fired 
        ON task_execution_history(fired_at)
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
   * 创建system_config表
   */
  private async createSystemConfigTable(): Promise<void> {
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
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
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
  }

  /**
   * 初始化系统配置
   */
  private async initSystemConfig(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const initialConfigs: Array<{ key: string; value: string }> = [
      { key: 'chronos_cron_enabled', value: 'true' },
      { key: 'chronos_cron_durable', value: 'true' },
      { key: 'auto_dream_min_hours', value: '24' },
      { key: 'auto_dream_min_sessions', value: '5' },
      { key: 'auto_dream_enabled', value: 'true' },
    ];

    for (const config of initialConfigs) {
      await this.setConfig(config.key, config.value, now);
    }
  }

  /**
   * 添加定时任务
   * @param task 任务对象
   */
  async addTask(task: ScheduledTask): Promise<void> {
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
        `INSERT OR REPLACE INTO scheduled_tasks 
         (id, cron, prompt, created_at, last_fired_at, recurring, permanent, durable, agent_id, task_type, metadata) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.cron,
          task.prompt,
          task.createdAt,
          task.lastFiredAt || null,
          task.recurring ? 1 : 0,
          task.permanent ? 1 : 0,
          task.durable ? 1 : 0,
          task.agentId || null,
          task.taskType,
          task.metadata ? JSON.stringify(task.metadata) : null,
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
  }

  /**
   * 获取定时任务
   * @param taskId 任务ID
   * @returns 任务对象或null
   */
  async getTask(taskId: string): Promise<ScheduledTask | null> {
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
        `SELECT * FROM scheduled_tasks WHERE id = ?`,
        [taskId],
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

    return this.rowToTask(row);
  }

  /**
   * 列出所有定时任务
   * @returns 任务列表
   */
  async listTasks(): Promise<ScheduledTask[]> {
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
        `SELECT * FROM scheduled_tasks ORDER BY created_at DESC`,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });

    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * 更新定时任务
   * @param taskId 任务ID
   * @param updates 更新内容
   */
  async updateTask(
    taskId: string,
    updates: Partial<ScheduledTask>
  ): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (updates.cron !== undefined) {
      setClauses.push('cron = ?');
      params.push(updates.cron);
    }
    if (updates.prompt !== undefined) {
      setClauses.push('prompt = ?');
      params.push(updates.prompt);
    }
    if (updates.lastFiredAt !== undefined) {
      setClauses.push('last_fired_at = ?');
      params.push(updates.lastFiredAt);
    }
    if (updates.recurring !== undefined) {
      setClauses.push('recurring = ?');
      params.push(updates.recurring ? 1 : 0);
    }
    if (updates.permanent !== undefined) {
      setClauses.push('permanent = ?');
      params.push(updates.permanent ? 1 : 0);
    }
    if (updates.durable !== undefined) {
      setClauses.push('durable = ?');
      params.push(updates.durable ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return;
    }

    params.push(taskId);

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`,
        params,
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
   * 删除定时任务
   * @param taskId 任务ID
   */
  async deleteTask(taskId: string): Promise<void> {
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
        `DELETE FROM scheduled_tasks WHERE id = ?`,
        [taskId],
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
   * 添加任务执行历史
   * @param history 历史记录
   * @returns 历史记录ID
   */
  async addExecutionHistory(history: TaskExecutionHistory): Promise<number> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const id = await new Promise<number>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO task_execution_history 
         (task_id, fired_at, completed_at, status, result, error) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          history.taskId,
          history.firedAt,
          history.completedAt || null,
          history.status,
          history.result || null,
          history.error || null,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });

    return id;
  }

  /**
   * 更新任务执行历史
   * @param historyId 历史记录ID
   * @param updates 更新内容
   */
  async updateExecutionHistory(
    historyId: number,
    updates: Partial<TaskExecutionHistory>
  ): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = ?');
      params.push(updates.completedAt);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.result !== undefined) {
      setClauses.push('result = ?');
      params.push(updates.result);
    }
    if (updates.error !== undefined) {
      setClauses.push('error = ?');
      params.push(updates.error);
    }

    if (setClauses.length === 0) {
      return;
    }

    params.push(historyId);

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `UPDATE task_execution_history SET ${setClauses.join(', ')} WHERE id = ?`,
        params,
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
   * 获取系统配置
   * @param key 配置键
   * @returns 配置值或null
   */
  async getConfig(key: string): Promise<string | null> {
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
        `SELECT value FROM system_config WHERE key = ?`,
        [key],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    return row ? ((row as Record<string, unknown>).value as string) : null;
  }

  /**
   * 设置系统配置
   * @param key 配置键
   * @param value 配置值
   * @param updatedAt 更新时间戳（可选）
   */
  async setConfig(
    key: string,
    value: string,
    updatedAt?: number
  ): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const timestamp = updatedAt || Math.floor(Date.now() / 1000);

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
        [key, value, timestamp],
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
   * 将数据库行转换为任务对象
   * @param row 数据库行
   * @returns 任务对象
   */
  private rowToTask(row: any): ScheduledTask {
    return {
      id: row.id,
      cron: row.cron,
      prompt: row.prompt,
      createdAt: row.created_at,
      lastFiredAt: row.last_fired_at,
      recurring: row.recurring === 1,
      permanent: row.permanent === 1,
      durable: row.durable === 1,
      agentId: row.agent_id,
      taskType: row.task_type,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db?.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.db = null;
            resolve();
          }
        });
      });
    }
  }
}
