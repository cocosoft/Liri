/**
 * VideoTaskPersistence
 * 视频生成异步任务的轻量持久化层
 *
 * 使用 SQLite 存储任务状态，应用重启后不丢失。
 * 写入独立的 video_tasks 表，不耦合 TaskRegistry 的 BaseTask 体系。
 */

// bun:sqlite 内置模块，tsc 类型检查时跳过（运行时由 Bun 提供）
// @ts-ignore — bun:sqlite 是 Bun 内置模块，tsc 无类型声明
import { Database } from 'bun:sqlite';
import { resolveDbPath } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:videoGenerate',
});

/** 持久化的任务状态 */
export interface VideoTaskRecord {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  prompt: string;
  model?: string;
  resultJson?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export class VideoTaskPersistence {
  private db: Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || resolveDbPath());
    this.ensureTable();
  }

  /** 创建 video_tasks 表 */
  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS video_tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        prompt TEXT NOT NULL DEFAULT '',
        model TEXT,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /** 创建任务记录 */
  create(task: VideoTaskRecord): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO video_tasks (id, status, prompt, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task.id, task.status, task.prompt, task.model || null, now, now]
    );
    logger.info('VideoTaskPersistence . 创建任务', {
      id: task.id,
      status: task.status,
    });
  }

  /** 更新任务状态 */
  update(
    id: string,
    fields: Partial<
      Pick<VideoTaskRecord, 'status' | 'resultJson' | 'error' | 'model'>
    >
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.status !== undefined) {
      sets.push('status = ?');
      params.push(fields.status);
    }
    if (fields.resultJson !== undefined) {
      sets.push('result_json = ?');
      params.push(fields.resultJson);
    }
    if (fields.error !== undefined) {
      sets.push('error = ?');
      params.push(fields.error);
    }
    if (fields.model !== undefined) {
      sets.push('model = ?');
      params.push(fields.model);
    }

    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.db.run(
      `UPDATE video_tasks SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    logger.info('VideoTaskPersistence . 更新任务', { id, ...fields });
  }

  /** 查询任务记录 */
  get(id: string): VideoTaskRecord | null {
    const row = this.db
      // @ts-ignore — bun:sqlite query API
      .query('SELECT * FROM video_tasks WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      status: row.status,
      prompt: row.prompt,
      model: row.model || undefined,
      resultJson: row.result_json || undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** 查询所有任务（按时间倒序） */
  list(limit: number = 20): VideoTaskRecord[] {
    // @ts-ignore — bun:sqlite query API
    const rows = this.db
      .query('SELECT * FROM video_tasks ORDER BY created_at DESC LIMIT ?')
      .all(limit) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      status: row.status,
      prompt: row.prompt,
      model: row.model || undefined,
      resultJson: row.result_json || undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}

/** 全局单例 */
let _instance: VideoTaskPersistence | null = null;

export function getVideoTaskPersistence(): VideoTaskPersistence {
  if (!_instance) {
    _instance = new VideoTaskPersistence();
  }
  return _instance;
}
