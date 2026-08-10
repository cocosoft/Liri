/**
 * Cron 运行日志持久化
 * 对标 openclaw src/cron/run-log.ts
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { CronJob, CronJobResult, CronRunStatus } from './types';

const logger = getLogger('tasks:cron:runLog');

export interface CronRunLogEntry {
  id: string;
  jobId: string;
  ts: number;
  action: 'finished';
  status: CronRunStatus;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs: number;
  durationMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  deliveryStatus?: string;
  deliveryError?: string;
}

export interface CronRunLogPage {
  entries: CronRunLogEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

const TABLE_CRON_RUN_LOGS = 'cron_run_logs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ${TABLE_CRON_RUN_LOGS} (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL DEFAULT 'finished',
  status TEXT,
  error TEXT,
  summary TEXT,
  session_id TEXT,
  session_key TEXT,
  run_at_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  next_run_at_ms INTEGER,
  model TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  delivery_status TEXT,
  delivery_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_run_logs_job ON ${TABLE_CRON_RUN_LOGS}(job_id);
CREATE INDEX IF NOT EXISTS idx_cron_run_logs_ts ON ${TABLE_CRON_RUN_LOGS}(ts);
CREATE INDEX IF NOT EXISTS idx_cron_run_logs_status ON ${TABLE_CRON_RUN_LOGS}(status);
`;

const DEFAULT_MAX_LINES_PER_JOB = 2000;
const DEFAULT_MAX_ENTRIES_PER_JOB = 2000;

function rowToEntry(row: Record<string, unknown>): CronRunLogEntry {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    ts: row.ts as number,
    action: 'finished',
    status: (row.status as CronRunStatus) ?? undefined,
    error: row.error as string | undefined,
    summary: row.summary as string | undefined,
    sessionId: row.session_id as string | undefined,
    sessionKey: row.session_key as string | undefined,
    runAtMs: row.run_at_ms as number,
    durationMs: (row.duration_ms as number | undefined) ?? undefined,
    nextRunAtMs: (row.next_run_at_ms as number | undefined) ?? undefined,
    model: row.model as string | undefined,
    provider: row.provider as string | undefined,
    inputTokens: (row.input_tokens as number | undefined) ?? undefined,
    outputTokens: (row.output_tokens as number | undefined) ?? undefined,
    deliveryStatus: row.delivery_status as string | undefined,
    deliveryError: row.delivery_error as string | undefined,
  };
}

export class CronRunLog {
  private db: Database | null = null;
  private dbPath: string;
  private maxLinesPerJob: number;

  constructor(dbPath: string, maxLinesPerJob?: number) {
    this.dbPath = dbPath;
    this.maxLinesPerJob = maxLinesPerJob ?? DEFAULT_MAX_LINES_PER_JOB;
  }

  /** 打开数据库并初始化表 */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (err: Error | null) => {
        if (err) {
          handleError(err, {
            module: 'tasks:cron:runlog',
            action: '打开数据库失败',
          });
          reject(err);
          return;
        }
        this.db!.exec(SCHEMA, (schemaErr) => {
          if (schemaErr) {
            handleError(schemaErr, {
              module: 'tasks:cron:runlog',
              action: '初始化表结构失败',
            });
            reject(schemaErr);
            return;
          }
          logger.info('[CronRunLog] 数据库初始化完成');
          resolve();
        });
      });
    });
  }

  /** 关闭数据库 */
  async close(): Promise<void> {
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
      throw new Error('[CronRunLog] 数据库未初始化，请先调用 init()');
    }
    return this.db;
  }

  /** 追加运行日志条目 */
  async appendEntry(entry: CronRunLogEntry): Promise<void> {
    const db = this.ensureDb();
    const now = Date.now();

    const sql = `INSERT INTO ${TABLE_CRON_RUN_LOGS}
      (id, job_id, ts, action, status, error, summary, session_id, session_key,
       run_at_ms, duration_ms, next_run_at_ms, model, provider,
       input_tokens, output_tokens, delivery_status, delivery_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [
          entry.id,
          entry.jobId,
          entry.ts,
          entry.action,
          entry.status ?? null,
          entry.error ?? null,
          entry.summary ?? null,
          entry.sessionId ?? null,
          entry.sessionKey ?? null,
          entry.runAtMs,
          entry.durationMs ?? null,
          entry.nextRunAtMs ?? null,
          entry.model ?? null,
          entry.provider ?? null,
          entry.inputTokens ?? null,
          entry.outputTokens ?? null,
          entry.deliveryStatus ?? null,
          entry.deliveryError ?? null,
          now,
        ],
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'tasks:cron:runlog',
              action: '写入日志失败',
            });
            reject(err);
            return;
          }
        }
      );
    });
  }

  /** 从结果对象快照启动器构建日志条目 */
  buildEntry(
    job: CronJob,
    result: CronJobResult,
    startedAt: number,
    nextRunAtMs?: number,
    sessionId?: string,
    sessionKey?: string,
    deliveryError?: string
  ): CronRunLogEntry {
    const id = `cron:${job.id}:${startedAt}`;
    return {
      id,
      jobId: job.id,
      ts: startedAt,
      action: 'finished',
      status: result.success ? 'ok' : 'failed',
      error: result.error,
      summary: result.success
        ? `执行成功`
        : `执行失败: ${result.error ?? '未知错误'}`,
      sessionId,
      sessionKey,
      runAtMs: startedAt,
      durationMs: result.durationMs,
      nextRunAtMs,
      model: result.model || job.model,
      provider: result.provider || job.provider,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      deliveryStatus: deliveryError ? 'failed' : 'pending',
      deliveryError,
    };
  }

  /**
   * 记录作业运行结果，并自动裁剪旧日志
   */
  async recordRun(
    job: CronJob,
    result: CronJobResult,
    startedAt: number,
    nextRunAtMs?: number,
    sessionId?: string,
    sessionKey?: string,
    deliveryError?: string
  ): Promise<void> {
    const entry = this.buildEntry(
      job,
      result,
      startedAt,
      nextRunAtMs,
      sessionId,
      sessionKey,
      deliveryError
    );
    await this.appendEntry(entry);
    await this.prune(job.id);
  }

  /** 裁剪旧日志（保留最近 N 条） */
  private async prune(jobId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve) => {
      db.run(
        `DELETE FROM ${TABLE_CRON_RUN_LOGS}
         WHERE job_id = ? AND id NOT IN (
           SELECT id FROM ${TABLE_CRON_RUN_LOGS}
           WHERE job_id = ?
           ORDER BY ts DESC
           LIMIT ?
         )`,
        [jobId, jobId, this.maxLinesPerJob],
        (err: Error | null) => {
          if (err) {
            logger.warning('[CronRunLog] 裁剪日志失败', {
              jobId,
              error: err.message,
            });
          }
          resolve();
        }
      );
    });
  }

  /** 分页查询运行日志 */
  async queryPage(opts: {
    jobId?: string;
    limit?: number;
    offset?: number;
    status?: CronRunStatus;
  }): Promise<CronRunLogPage> {
    const db = this.ensureDb();
    const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
    const offset = Math.max(0, opts.offset ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.jobId) {
      conditions.push('job_id = ?');
      params.push(opts.jobId);
    }
    if (opts.status) {
      conditions.push('status = ?');
      params.push(opts.status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM ${TABLE_CRON_RUN_LOGS} ${whereClause}`,
        params,
        (err, row: any) => {
          if (err) {
            handleError(err, {
              module: 'tasks:cron:runlog',
              action: '查询总数失败',
            });
            reject(err);
            return;
          }
          const total = row?.total ?? 0;

          db.all(
            `SELECT * FROM ${TABLE_CRON_RUN_LOGS} ${whereClause}
             ORDER BY ts DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset],
            (err2, rows: any[]) => {
              if (err2) {
                handleError(err2, {
                  module: 'tasks:cron:runlog',
                  action: '查询日志失败',
                });
                reject(err2);
                return;
              }
              const entries = (rows ?? []).map(rowToEntry);
              resolve({
                entries,
                total,
                offset,
                limit,
                hasMore: offset + limit < total,
              });
            }
          );
        }
      );
    });
  }

  /** 获取作业总数 */
  async getTotalCount(): Promise<number> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM ${TABLE_CRON_RUN_LOGS}`,
        [],
        (err, row: any) => {
          if (err) reject(err);
          else resolve(row?.total ?? 0);
        }
      );
    });
  }

  /** 获取指定作业的总执行次数 */
  async getCount(jobId: string): Promise<number> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM ${TABLE_CRON_RUN_LOGS} WHERE job_id = ?`,
        [jobId],
        (err, row: any) => {
          if (err) reject(err);
          else resolve(row?.total ?? 0);
        }
      );
    });
  }

  /** 设置传入 db 实例（用于复用已有数据库连接） */
  setDb(db: Database): void {
    this.db = db;
  }
}
