/**
 * Cron 作业持久化存储（SQLite）
 * 使用 SQLite 替代 JSON 文件提供更可靠的并发访问
 */

import { Database } from 'sqlite3';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  CronJob,
  CronJobState,
  CronSchedule,
  CronRepeat,
  CronOrigin,
  CronJobFilter,
} from './types';
import { validateCronTransition, isTerminalCronState } from './types';

const logger = new Logger({ level: LogLevel.INFO });

const TABLE_CRON_JOBS = 'cron_jobs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  schedule TEXT NOT NULL,
  schedule_display TEXT,
  repeat_times INTEGER,
  repeat_completed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'scheduled',
  paused_at INTEGER,
  paused_reason TEXT,
  created_at TEXT NOT NULL,
  next_run_at TEXT,
  last_run_at TEXT,
  last_status TEXT,
  last_error TEXT,
  last_delivery_error TEXT,
  deliver TEXT NOT NULL DEFAULT 'local',
  origin TEXT,
  enabled_toolsets TEXT,
  workdir TEXT,
  model TEXT,
  provider TEXT,
  base_url TEXT,
  script TEXT,
  no_agent INTEGER NOT NULL DEFAULT 0,
  context_from TEXT,
  owner_key TEXT,
  session_key TEXT,
  silent INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_state ON cron_jobs(state);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_created ON cron_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_owner ON cron_jobs(owner_key);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_session ON cron_jobs(session_key);
`;

function rowToCronJob(row: any): CronJob {
  const schedule: CronSchedule = JSON.parse(row.schedule);
  const skills: string[] = JSON.parse(row.skills || '[]');

  const job: CronJob = {
    id: row.id,
    name: row.name,
    prompt: row.prompt ?? undefined,
    skills,
    skill: skills[0] ?? undefined,
    schedule,
    scheduleDisplay: row.schedule_display ?? undefined,
    repeat: {
      times: row.repeat_times ?? null,
      completed: row.repeat_completed ?? 0,
    },
    enabled: row.enabled === 1,
    state: row.state,
    pausedAt: row.paused_at ?? undefined,
    pausedReason: row.paused_reason ?? undefined,
    createdAt: row.created_at,
    nextRunAt: row.next_run_at ?? undefined,
    runningAtMs: row.running_at_ms ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastStatus: row.last_status ?? undefined,
    lastError: row.last_error ?? undefined,
    lastDeliveryError: row.last_delivery_error ?? undefined,
    deliver: row.deliver,
    origin: row.origin ? JSON.parse(row.origin) : undefined,
    enabledToolsets: row.enabled_toolsets
      ? JSON.parse(row.enabled_toolsets)
      : undefined,
    workdir: row.workdir ?? undefined,
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    baseUrl: row.base_url ?? undefined,
    script: row.script ?? undefined,
    noAgent: row.no_agent === 1,
    contextFrom: row.context_from ? JSON.parse(row.context_from) : undefined,
    ownerKey: row.owner_key ?? undefined,
    sessionKey: row.session_key ?? undefined,
    silent: row.silent === 1,
    consecutiveErrors: row.consecutive_errors ?? 0,
    consecutiveSkipped: row.consecutive_skipped ?? 0,
    scheduleErrorCount: row.schedule_error_count ?? 0,
  };

  // 从 schedule JSON 中读取 tz（如果 schedule 中没有则尝试 row.schedule_tz）
  if (row.schedule_tz && !job.schedule.tz) {
    job.schedule.tz = row.schedule_tz;
  }

  return job;
}

function cronJobToRow(job: CronJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt ?? null,
    skills: JSON.stringify(job.skills || []),
    schedule: JSON.stringify(job.schedule),
    schedule_display: job.scheduleDisplay ?? null,
    repeat_times: job.repeat.times,
    repeat_completed: job.repeat.completed,
    enabled: job.enabled ? 1 : 0,
    state: job.state,
    paused_at: job.pausedAt ?? null,
    paused_reason: job.pausedReason ?? null,
    created_at: job.createdAt,
    next_run_at: job.nextRunAt ?? null,
    running_at_ms: job.runningAtMs ?? null,
    last_run_at: job.lastRunAt ?? null,
    last_status: job.lastStatus ?? null,
    last_error: job.lastError ?? null,
    last_delivery_error: job.lastDeliveryError ?? null,
    deliver: job.deliver,
    origin: job.origin ? JSON.stringify(job.origin) : null,
    enabled_toolsets: job.enabledToolsets
      ? JSON.stringify(job.enabledToolsets)
      : null,
    workdir: job.workdir ?? null,
    model: job.model ?? null,
    provider: job.provider ?? null,
    base_url: job.baseUrl ?? null,
    script: job.script ?? null,
    no_agent: job.noAgent ? 1 : 0,
    context_from: job.contextFrom ? JSON.stringify(job.contextFrom) : null,
    owner_key: job.ownerKey ?? null,
    session_key: job.sessionKey ?? null,
    silent: job.silent ? 1 : 0,
    consecutive_errors: job.consecutiveErrors ?? 0,
    consecutive_skipped: job.consecutiveSkipped ?? 0,
    schedule_error_count: job.scheduleErrorCount ?? 0,
    schedule_tz: job.schedule.tz ?? null,
    updated_at: Date.now(),
  };
}

export class CronJobStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /** 初始化数据库 */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (err) => {
        if (err) {
          logger.error('[CronJobStore] 打开数据库失败', { error: err.message });
          reject(err);
          return;
        }
        this.db!.exec(SCHEMA, (schemaErr) => {
          if (schemaErr) {
            logger.error('[CronJobStore] 初始化表结构失败', {
              error: schemaErr.message,
            });
            reject(schemaErr);
            return;
          }
          // 迁移：添加 silent 列（兼容旧库）
          this.db!.run(
            `ALTER TABLE cron_jobs ADD COLUMN silent INTEGER NOT NULL DEFAULT 0`,
            (/* noop */) => {
              // 忽略 "column already exists" 错误
            }
          );
          // 迁移：添加 running_at_ms 列
          this.db!.run(
            `ALTER TABLE cron_jobs ADD COLUMN running_at_ms INTEGER DEFAULT NULL`,
            (/* noop */) => {}
          );
          // 迁移：添加连续错误保护列
          this.db!.run(
            `ALTER TABLE cron_jobs ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0`,
            (/* noop */) => {
              this.db!.run(
                `ALTER TABLE cron_jobs ADD COLUMN consecutive_skipped INTEGER NOT NULL DEFAULT 0`,
                (/* noop */) => {
                  this.db!.run(
                    `ALTER TABLE cron_jobs ADD COLUMN schedule_error_count INTEGER NOT NULL DEFAULT 0`,
                    (/* noop */) => {
                      this.db!.run(
                        `ALTER TABLE cron_jobs ADD COLUMN schedule_tz TEXT DEFAULT NULL`,
                        (/* noop */) => {}
                      );
                    }
                  );
                }
              );
            }
          );
          logger.info('[CronJobStore] 数据库初始化完成');
          resolve();
        });
      });
    });
  }

  /** 关闭数据库 */
  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });
  }

  /** 确保数据库已初始化 */
  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('[CronJobStore] 数据库未初始化，请先调用 init()');
    }
    return this.db;
  }

  /** 插入或更新作业 */
  async upsertJob(job: CronJob): Promise<void> {
    const db = this.ensureDb();
    const row = cronJobToRow(job);
    const columns = Object.keys(row).join(', ');
    const placeholders = Object.keys(row)
      .map(() => '?')
      .join(', ');
    const values = Object.values(row);

    const sql = `INSERT OR REPLACE INTO ${TABLE_CRON_JOBS} (${columns}) VALUES (${placeholders})`;

    return new Promise((resolve, reject) => {
      db.run(sql, values, (err) => {
        if (err) {
          logger.error('[CronJobStore] 保存作业失败', {
            jobId: job.id,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /** 加载所有符合条件的作业 */
  async loadJobs(filter?: CronJobFilter): Promise<CronJob[]> {
    const db = this.ensureDb();
    let sql = `SELECT * FROM ${TABLE_CRON_JOBS}`;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter) {
      if (filter.enabled !== undefined) {
        conditions.push('enabled = ?');
        params.push(filter.enabled ? 1 : 0);
      }
      if (filter.state) {
        conditions.push('state = ?');
        params.push(filter.state);
      }
      if (filter.skill) {
        conditions.push('skills LIKE ?');
        params.push(`%"${filter.skill}"%`);
      }
      if (filter.ids && filter.ids.length > 0) {
        conditions.push(`id IN (${filter.ids.map(() => '?').join(', ')})`);
        params.push(...filter.ids);
      }
      if (filter.ownerKey) {
        conditions.push('owner_key = ?');
        params.push(filter.ownerKey);
      }
      if (filter.sessionKey) {
        conditions.push('session_key = ?');
        params.push(filter.sessionKey);
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at ASC';

    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('[CronJobStore] 加载作业失败', { error: err.message });
          reject(err);
          return;
        }
        resolve((rows as any[]).map(rowToCronJob));
      });
    });
  }

  /** 根据 ID 获取作业 */
  async getJob(jobId: string): Promise<CronJob | undefined> {
    const jobs = await this.loadJobs({ ids: [jobId] });
    return jobs[0];
  }

  /**
   * 更新作业状态（含状态流转守卫验证）
   * 读取当前状态 → 验证合法性 → 写入新状态
   */
  async updateJobState(jobId: string, newState: CronJobState): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`作业不存在: ${jobId}`);
    }

    validateCronTransition(job.state, newState);

    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET state = ?, updated_at = ?
      WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(sql, [newState, Date.now(), jobId], (err) => {
        if (err) {
          logger.error('[CronJobStore] 更新状态失败', {
            jobId,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /** 列出所有启用的作业 */
  async listEnabledJobs(): Promise<CronJob[]> {
    return this.loadJobs({ enabled: true });
  }

  /** 获取即将到期的作业 */
  async getDueJobs(nowIso: string): Promise<CronJob[]> {
    const db = this.ensureDb();
    const sql = `SELECT * FROM ${TABLE_CRON_JOBS}
      WHERE enabled = 1
        AND state = 'scheduled'
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC`;

    return new Promise((resolve, reject) => {
      db.all(sql, [nowIso], (err, rows) => {
        if (err) {
          logger.error('[CronJobStore] 获取到期作业失败', {
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve((rows as any[]).map(rowToCronJob));
      });
    });
  }

  /** 更新作业的执行记录 */
  async markJobRun(
    jobId: string,
    success: boolean,
    error?: string,
    deliveryError?: string
  ): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const status = success ? 'ok' : 'failed';

    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET last_run_at = ?,
          last_status = ?,
          last_error = ?,
          last_delivery_error = ?,
          updated_at = ?
      WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [now, status, error ?? null, deliveryError ?? null, Date.now(), jobId],
        (err) => {
          if (err) {
            logger.error('[CronJobStore] 标记作业运行失败', {
              jobId,
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /** 更新下次运行时间 */
  async updateNextRun(jobId: string, nextRunAt: string | null): Promise<void> {
    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET next_run_at = ?,
          updated_at = ?
      WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(sql, [nextRunAt, Date.now(), jobId], (err) => {
        if (err) {
          logger.error('[CronJobStore] 更新下次运行时间失败', {
            jobId,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /** 增加重复计数 */
  async incrementRepeatCompleted(jobId: string): Promise<void> {
    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET repeat_completed = repeat_completed + 1,
          updated_at = ?
      WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(sql, [Date.now(), jobId], (err) => {
        if (err) {
          logger.error('[CronJobStore] 增加重复计数失败', {
            jobId,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /** 暂停作业（含状态守卫验证） */
  async pauseJob(jobId: string, reason?: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`作业不存在: ${jobId}`);
    }

    validateCronTransition(job.state, 'paused');

    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET state = 'paused',
          paused_at = ?,
          paused_reason = ?,
          updated_at = ?
      WHERE id = ? AND state = ?`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [Date.now(), reason ?? null, Date.now(), jobId, job.state],
        (err) => {
          if (err) {
            logger.error('[CronJobStore] 暂停作业失败', {
              jobId,
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /** 恢复作业（含状态守卫验证） */
  async resumeJob(jobId: string, nextRunAt: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`作业不存在: ${jobId}`);
    }

    validateCronTransition(job.state, 'scheduled');

    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET state = 'scheduled',
          paused_at = NULL,
          paused_reason = NULL,
          next_run_at = ?,
          updated_at = ?
      WHERE id = ? AND state = ?`;

    return new Promise((resolve, reject) => {
      db.run(sql, [nextRunAt, Date.now(), jobId, job.state], (err) => {
        if (err) {
          logger.error('[CronJobStore] 恢复作业失败', {
            jobId,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /** 删除作业 */
  async deleteJob(jobId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM ${TABLE_CRON_JOBS} WHERE id = ?`, [jobId], (err) => {
        if (err) {
          logger.error('[CronJobStore] 删除作业失败', {
            jobId,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /** 禁用作业（连续错误超阈值时调用） */
  async disableJob(jobId: string, reason?: string): Promise<void> {
    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET enabled = 0, last_error = COALESCE(last_error, ?), updated_at = ?
      WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [reason ? `已自动禁用: ${reason}` : null, Date.now(), jobId],
        (err) => {
          if (err) {
            logger.error('[CronJobStore] 禁用作业失败', {
              jobId,
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /** 查找所有 running 状态的作业（用于启动恢复） */
  async findRunningJobs(): Promise<CronJob[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM ${TABLE_CRON_JOBS} WHERE state = 'running'`,
        [],
        (err, rows) => {
          if (err) {
            logger.error('[CronJobStore] 查询运行中作业失败', {
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve((rows as any[]).map(rowToCronJob));
        }
      );
    });
  }

  /** 更新作业连续错误计数 */
  async updateConsecutiveErrors(
    jobId: string,
    errors: number,
    skipped: number,
    scheduleErrors: number
  ): Promise<void> {
    const db = this.ensureDb();
    const sql = `UPDATE ${TABLE_CRON_JOBS}
      SET consecutive_errors = ?, consecutive_skipped = ?,
          schedule_error_count = ?, updated_at = ?
      WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [errors, skipped, scheduleErrors, Date.now(), jobId],
        (err) => {
          if (err) {
            logger.error('[CronJobStore] 更新错误计数失败', {
              jobId,
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /** 获取作业统计 */
  async getStats(): Promise<{
    total: number;
    enabled: number;
    paused: number;
    failed: number;
    completed: number;
  }> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled,
          SUM(CASE WHEN state = 'paused' THEN 1 ELSE 0 END) as paused,
          SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) as completed
        FROM ${TABLE_CRON_JOBS}`,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          const row = (rows as any[])[0] || {};
          resolve({
            total: row.total || 0,
            enabled: row.enabled || 0,
            paused: row.paused || 0,
            failed: row.failed || 0,
            completed: row.completed || 0,
          });
        }
      );
    });
  }
}
