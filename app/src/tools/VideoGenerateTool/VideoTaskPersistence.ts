/**
 * VideoTaskPersistence
 * 视频生成异步任务的轻量持久化层
 *
 * 使用 SQLite 存储任务状态，应用重启后不丢失。
 * 写入独立的 video_tasks 表，不耦合 TaskRegistry 的 BaseTask 体系。
 *
 * v2.0 — Phase 1 扩展: 新增 mode/imageUrl/progress/queued/worker 恢复等字段
 */

// bun:sqlite 内置模块，tsc 类型检查时跳过（运行时由 Bun 提供）
// @ts-ignore — bun:sqlite 是 Bun 内置模块，tsc 无类型声明
import { Database } from 'bun:sqlite';
import { resolveDbPath } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('tools:videoGenerate');

/** 持久化的任务状态 */
export interface VideoTaskRecord {
  id: string;
  /** pending→queued→running→completed/failed/cancelled */
  status:
    | 'pending'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';
  /** 视频生成模式 */
  mode: 'text-to-video' | 'image-to-video';
  prompt: string;
  model?: string;
  /** 来源图片 URL（图生视频时） */
  sourceImageUrl?: string;
  /** 来源图片 DB ID */
  sourceImageId?: string;
  /** 来源图片本地路径（Phase 6.1: 图生视频溯源） */
  sourceImagePath?: string;
  /** 模板 ID（从模板预设触发时） */
  templateId?: string;
  /** 生成进度 0-100 */
  progress: number;
  /** 生成结果视频 URL */
  resultVideoUrl?: string;
  /** 生成结果视频 DB/file ID */
  resultVideoId?: string;
  /** 失败时的错误信息 */
  error?: string;
  /** 完成结果的 JSON 序列化 */
  resultJson?: string;
  /** 入队时间戳 */
  queuedAt?: number;
  /** 开始执行时间戳 */
  startedAt?: number;
  /** 完成时间戳 */
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export class VideoTaskPersistence {
  private db: Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || resolveDbPath());
    this.ensureTable();
  }

  /** 创建 video_tasks 表（含 v2.0 迁移） */
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

    // v2.0 迁移：添加 Phase 1 新字段
    this.migrateV2();
  }

  /** Phase 1 迁移：新增字段 */
  private migrateV2(): void {
    const existingCols = this.getTableColumns('video_tasks');

    const migrations: Array<{ col: string; ddl: string }> = [
      {
        col: 'mode',
        ddl: "ALTER TABLE video_tasks ADD COLUMN mode TEXT DEFAULT 'text-to-video'",
      },
      {
        col: 'source_image_url',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN source_image_url TEXT',
      },
      {
        col: 'source_image_id',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN source_image_id TEXT',
      },
      {
        col: 'template_id',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN template_id TEXT',
      },
      {
        col: 'progress',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN progress INTEGER DEFAULT 0',
      },
      {
        col: 'result_video_url',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN result_video_url TEXT',
      },
      {
        col: 'result_video_id',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN result_video_id TEXT',
      },
      {
        col: 'queued_at',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN queued_at INTEGER',
      },
      {
        col: 'started_at',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN started_at INTEGER',
      },
      {
        col: 'completed_at',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN completed_at INTEGER',
      },
      // Phase 6.1: 图生视频溯源 — 来源图片本地路径
      {
        col: 'source_image_path',
        ddl: 'ALTER TABLE video_tasks ADD COLUMN source_image_path TEXT',
      },
    ];

    for (const m of migrations) {
      if (!existingCols.has(m.col)) {
        try {
          this.db.run(m.ddl);
          logger.info('VideoTaskPersistence 迁移', { col: m.col });
        } catch (e) {
          void handleError(e, {
            module: 'tools:videoGenerate',
            action: 'migrate',
            context: { col: m.col },
          });
        }
      }
    }
  }

  /** 获取表的所有列名 */
  private getTableColumns(tableName: string): Set<string> {
    try {
      const rows = this.db
        // @ts-ignore
        .query(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name: string }>;
      return new Set(rows.map((r) => r.name));
    } catch {
      return new Set();
    }
  }

  /** 创建任务记录 */
  create(task: VideoTaskRecord): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO video_tasks
        (id, status, mode, prompt, model, source_image_url, source_image_id,
         source_image_path, template_id, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.status || 'pending',
        task.mode || 'text-to-video',
        task.prompt,
        task.model || null,
        task.sourceImageUrl || null,
        task.sourceImageId || null,
        task.sourceImagePath || null,
        task.templateId || null,
        task.progress || 0,
        now,
        now,
      ]
    );

    logger.info('VideoTaskPersistence 创建任务', {
      id: task.id,
      mode: task.mode,
      status: task.status,
    });
  }

  /** 更新任务状态（支持所有字段的部分更新） */
  update(
    id: string,
    fields: Partial<
      Pick<
        VideoTaskRecord,
        | 'status'
        | 'mode'
        | 'prompt'
        | 'progress'
        | 'sourceImageUrl'
        | 'sourceImageId'
        | 'sourceImagePath'
        | 'templateId'
        | 'resultVideoUrl'
        | 'resultVideoId'
        | 'resultJson'
        | 'error'
        | 'model'
        | 'queuedAt'
        | 'startedAt'
        | 'completedAt'
      >
    >
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    // 字段映射：TS camelCase → DB snake_case
    const fieldMap: Record<string, string> = {
      status: 'status',
      mode: 'mode',
      prompt: 'prompt',
      progress: 'progress',
      sourceImageUrl: 'source_image_url',
      sourceImageId: 'source_image_id',
      sourceImagePath: 'source_image_path',
      templateId: 'template_id',
      resultVideoUrl: 'result_video_url',
      resultVideoId: 'result_video_id',
      resultJson: 'result_json',
      error: 'error',
      model: 'model',
      queuedAt: 'queued_at',
      startedAt: 'started_at',
      completedAt: 'completed_at',
    };

    for (const [key, dbCol] of Object.entries(fieldMap)) {
      const value = (fields as any)[key];
      if (value !== undefined) {
        sets.push(`${dbCol} = ?`);
        params.push(value);
      }
    }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.db.run(
      `UPDATE video_tasks SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    logger.debug('VideoTaskPersistence 更新任务', { id, ...fields });
  }

  /** 查询单个任务记录 */
  get(id: string): VideoTaskRecord | null {
    const row = this.db
      // @ts-ignore — bun:sqlite query API
      .query('SELECT * FROM video_tasks WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    return this.mapRow(row);
  }

  /** 查询所有任务（按创建时间倒序） */
  list(limit: number = 20): VideoTaskRecord[] {
    // @ts-ignore — bun:sqlite query API
    const rows = this.db
      .query('SELECT * FROM video_tasks ORDER BY created_at DESC LIMIT ?')
      .all(limit) as any[];

    return rows.map((row: any) => this.mapRow(row));
  }

  /** 按状态查询任务（用于启动恢复 + 前端轮询） */
  listByStatus(
    statuses: VideoTaskRecord['status'][],
    limit: number = 20
  ): VideoTaskRecord[] {
    const placeholders = statuses.map(() => '?').join(',');
    // @ts-ignore
    const rows = this.db
      .query(
        `SELECT * FROM video_tasks WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
      )
      .all(...statuses, limit) as any[];

    return rows.map((row: any) => this.mapRow(row));
  }

  /** Phase 6.1: 按来源图片路径查询生成视频（图生视频溯源） */
  listBySourceImagePath(imagePath: string): VideoTaskRecord[] {
    // 支持部分匹配：图片路径可能包含文件名片段
    // @ts-ignore
    const rows = this.db
      .query(
        `SELECT * FROM video_tasks WHERE source_image_path = ? ORDER BY created_at DESC`
      )
      .all(imagePath) as any[];

    // 精确匹配未找到，尝试 LIKE 模糊匹配
    if (rows.length === 0) {
      const likePath = `%${imagePath.replace(/\\/g, '/').split('/').pop() || imagePath}%`;
      // @ts-ignore
      const fuzzyRows = this.db
        .query(
          `SELECT * FROM video_tasks WHERE source_image_url LIKE ? ORDER BY created_at DESC`
        )
        .all(likePath) as any[];
      return fuzzyRows.map((row: any) => this.mapRow(row));
    }

    return rows.map((row: any) => this.mapRow(row));
  }

  /** DB 行 → VideoTaskRecord 映射 */
  private mapRow(row: any): VideoTaskRecord {
    return {
      id: row.id,
      status: row.status,
      mode: row.mode || 'text-to-video',
      prompt: row.prompt,
      model: row.model || undefined,
      sourceImageUrl: row.source_image_url || undefined,
      sourceImageId: row.source_image_id || undefined,
      sourceImagePath: row.source_image_path || undefined,
      templateId: row.template_id || undefined,
      progress: row.progress || 0,
      resultVideoUrl: row.result_video_url || undefined,
      resultVideoId: row.result_video_id || undefined,
      error: row.error || undefined,
      resultJson: row.result_json || undefined,
      queuedAt: row.queued_at || undefined,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 清理过期活跃任务：将超过 maxAgeMs 仍处于活跃状态的任务标记为 failed。
   * 用于防止应用重启后残留的旧任务被错误恢复。
   *
   * @returns 被标记为 failed 的任务数
   */
  cleanupStaleTasks(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    const cutoff = now - maxAgeMs;

    const result = this.db.run(
      `UPDATE video_tasks
       SET status = 'failed',
           error = '任务超时未完成（超过 ${Math.round(maxAgeMs / 60000)} 分钟），已自动标记为失败',
           updated_at = ?
       WHERE status IN ('pending', 'queued', 'running')
         AND created_at < ?`,
      [now, cutoff]
    );

    const count = result.changes;
    if (count > 0) {
      logger.info('VideoTaskPersistence 清理过期任务', { count, cutoff });
    }
    return count;
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
