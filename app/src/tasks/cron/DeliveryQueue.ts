/**
 * Cron 投递重试队列
 * 基于 SQLite 持久化，支持指数退避重试、失败管理、统计查询
 */

import { Database } from 'sqlite3';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { CronJob, CronJobResult } from './types';

const logger = new Logger({ level: LogLevel.INFO });

const TABLE_DELIVERY_QUEUE = 'delivery_queue';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS delivery_queue (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_queue(status);
CREATE INDEX IF NOT EXISTS idx_delivery_retry ON delivery_queue(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_delivery_job ON delivery_queue(job_id);
`;

export interface DeliveryQueueConfig {
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  defaultMaxAttempts: number;
}

export interface DeliveryQueueEntry {
  id: string;
  jobId: string;
  payload: DeliveryPayload;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface DeliveryPayload {
  deliver: string;
  origin?: {
    platform: string;
    chatId: string;
    chatName?: string;
    threadId?: string;
  };
  result: {
    success: boolean;
    output: string;
    finalResponse: string;
    error?: string;
    durationMs: number;
  };
}

export interface DeliveryQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

const DEFAULT_CONFIG: DeliveryQueueConfig = {
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 60000,
  defaultMaxAttempts: 5,
};

function rowToEntry(row: any): DeliveryQueueEntry {
  return {
    id: row.id,
    jobId: row.job_id,
    payload: JSON.parse(row.payload),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
  };
}

export class DeliveryQueue {
  private db: Database | null = null;
  private dbPath: string;
  private config: DeliveryQueueConfig;
  private processingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string, config?: Partial<DeliveryQueueConfig>) {
    this.dbPath = dbPath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (err: Error | null) => {
        if (err) {
          logger.error('[DeliveryQueue] 打开数据库失败', {
            error: err.message,
          });
          reject(err);
          return;
        }
        this.db!.exec(SCHEMA, (schemaErr) => {
          if (schemaErr) {
            logger.error('[DeliveryQueue] 初始化表结构失败', {
              error: schemaErr.message,
            });
            reject(schemaErr);
            return;
          }
          resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    this.stopAutoRetry();
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err: Error | null) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('[DeliveryQueue] 数据库未初始化，请先调用 init()');
    }
    return this.db;
  }

  /** 将投递任务加入队列 */
  async enqueue(
    job: CronJob,
    result: CronJobResult,
    error?: string
  ): Promise<string> {
    const db = this.ensureDb();
    const id = `del-${job.id}-${Date.now()}`;
    const now = new Date().toISOString();

    const payload: DeliveryPayload = {
      deliver: job.deliver,
      origin: job.origin,
      result: {
        success: result.success,
        output: result.output,
        finalResponse: result.finalResponse,
        error: result.error,
        durationMs: result.durationMs,
      },
    };

    // 首次入队 next_retry_at 设为当前时间，立即可重试

    const sql = `INSERT INTO ${TABLE_DELIVERY_QUEUE}
      (id, job_id, payload, status, attempts, max_attempts, next_retry_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [
          id,
          job.id,
          JSON.stringify(payload),
          this.config.defaultMaxAttempts,
          now,
          error ?? null,
          now,
          Date.now(),
        ],
        (err: Error | null) => {
          if (err) {
            logger.error('[DeliveryQueue] 入队失败', {
              jobId: job.id,
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve(id);
        }
      );
    });
  }

  /** 获取待处理的投递任务（按重试时间排序） */
  async getPending(): Promise<DeliveryQueueEntry[]> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    const sql = `SELECT * FROM ${TABLE_DELIVERY_QUEUE}
      WHERE status = 'pending'
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= ?
      ORDER BY next_retry_at ASC
      LIMIT 50`;

    return new Promise((resolve, reject) => {
      db.all(sql, [now], (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((rows as any[]).map(rowToEntry));
      });
    });
  }

  /** 标记投递为处理中 */
  async markProcessing(entryId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE ${TABLE_DELIVERY_QUEUE} SET status = 'processing', updated_at = ? WHERE id = ?`,
        [Date.now(), entryId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 标记投递成功 */
  async markCompleted(entryId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE ${TABLE_DELIVERY_QUEUE} SET status = 'completed', updated_at = ? WHERE id = ?`,
        [Date.now(), entryId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 标记投递失败（自动计算下次重试或标记为永久失败） */
  async markFailed(entryId: string, error: string): Promise<boolean> {
    const db = this.ensureDb();
    const entry = await this.getEntry(entryId);
    if (!entry) throw new Error(`投递记录不存在: ${entryId}`);

    const newAttempts = entry.attempts + 1;

    if (newAttempts >= entry.maxAttempts) {
      await new Promise<void>((resolve, reject) => {
        db.run(
          `UPDATE ${TABLE_DELIVERY_QUEUE}
            SET status = 'failed', attempts = ?, last_error = ?, updated_at = ?
            WHERE id = ?`,
          [newAttempts, error, Date.now(), entryId],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      return false;
    }

    const nextRetryAt = this.computeNextRetry(newAttempts);
    await new Promise<void>((resolve, reject) => {
      db.run(
        `UPDATE ${TABLE_DELIVERY_QUEUE}
          SET status = 'pending', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ?
          WHERE id = ?`,
        [newAttempts, error, nextRetryAt, Date.now(), entryId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    return true;
  }

  /** 根据 ID 获取投递记录 */
  async getEntry(entryId: string): Promise<DeliveryQueueEntry | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM ${TABLE_DELIVERY_QUEUE} WHERE id = ?`,
        [entryId],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(row ? rowToEntry(row) : undefined);
        }
      );
    });
  }

  /** 获取指定作业的所有投递记录 */
  async getEntriesByJobId(jobId: string): Promise<DeliveryQueueEntry[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM ${TABLE_DELIVERY_QUEUE} WHERE job_id = ? ORDER BY created_at DESC`,
        [jobId],
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve((rows as any[]).map(rowToEntry));
        }
      );
    });
  }

  /** 获取统计信息 */
  async getStats(): Promise<DeliveryQueueStats> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          COUNT(*) as total
        FROM ${TABLE_DELIVERY_QUEUE}`,
        [],
        (err: Error | null, rows: any[]) => {
          if (err) {
            reject(err);
            return;
          }
          const row = (rows as any[])[0] || {};
          resolve({
            pending: row.pending || 0,
            processing: row.processing || 0,
            completed: row.completed || 0,
            failed: row.failed || 0,
            total: row.total || 0,
          });
        }
      );
    });
  }

  /** 重试所有失败投递 */
  async retryAllFailed(): Promise<number> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE ${TABLE_DELIVERY_QUEUE}
          SET status = 'pending', next_retry_at = ?, updated_at = ?
          WHERE status = 'failed'`,
        [now, Date.now()],
        function (this: any, err) {
          if (err) reject(err);
          else resolve(this.changes || 0);
        }
      );
    });
  }

  /** 重试单个失败投递 */
  async retryEntry(entryId: string): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE ${TABLE_DELIVERY_QUEUE}
          SET status = 'pending', attempts = 0, next_retry_at = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND status = 'failed'`,
        [now, Date.now(), entryId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 清理已完成/过期的记录 */
  async cleanOlderThan(ageMs: number): Promise<number> {
    const db = this.ensureDb();
    const cutoff = Date.now() - ageMs;

    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM ${TABLE_DELIVERY_QUEUE}
          WHERE (status = 'completed' OR status = 'failed')
          AND updated_at < ?`,
        [cutoff],
        function (this: any, err) {
          if (err) reject(err);
          else resolve(this.changes || 0);
        }
      );
    });
  }

  /** 启动自动重试处理 */
  startAutoRetry(intervalMs: number = 5000): void {
    if (this.processingTimer) return;
    this.processingTimer = setInterval(() => {
      void this.processNext();
    }, intervalMs);
  }

  /** 停止自动重试 */
  stopAutoRetry(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
  }

  /** 处理下一批待重试投递 */
  async processNext(
    handler?: (entry: DeliveryQueueEntry) => Promise<boolean>
  ): Promise<number> {
    const pending = await this.getPending();
    if (pending.length === 0) return 0;

    let processed = 0;
    for (const entry of pending) {
      try {
        if (handler) {
          await this.markProcessing(entry.id);
          const ok = await handler(entry);
          if (ok) {
            await this.markCompleted(entry.id);
          } else {
            await this.markFailed(entry.id, '投递处理器返回失败');
          }
        }
        processed++;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.markFailed(entry.id, errMsg);
        processed++;
      }
    }

    return processed;
  }

  /** 计算下次重试时间（指数退避 + 随机抖动） */
  private computeNextRetry(attempt: number): string {
    const exponential = this.config.baseRetryDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, this.config.maxRetryDelayMs);
    const jitter = Math.random() * 0.1 * capped;
    return new Date(Date.now() + capped + jitter).toISOString();
  }
}
