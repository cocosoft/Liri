// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * G-10 P2（2026-10-19）：主动消息**挂起队列 + 扫描器**。
 *
 * 设计真源：`dev_docs/20261019/proactive-draft.md` §4。
 * - SQLite 持久化（`pending_proactive_pushes`），状态机：pending → delivered / dropped / expired；
 * - 扫描器只消费注入的 `deliver` 回调（**不直接接通道**，P4 再接 `DeliveryRouter`）；
 * - 重试指数退避（有上限），超过最大次数即 dropped；
 * - **不写 `events.jsonl`**、不触碰 `SUSPENDED` 投影（草案 §5/§6）。
 */
import { Database } from '@modules/external';
import { resolveDbPath } from '@modules/environment';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  MS_PER_DAY,
  PROACTIVE_QUEUE_BASE_RETRY_MS,
  PROACTIVE_QUEUE_MAX_ATTEMPTS,
  PROACTIVE_QUEUE_MAX_RETRY_MS,
  PROACTIVE_QUEUE_RETENTION_DAYS,
  PROACTIVE_QUEUE_SCAN_INTERVAL_MS,
} from '@modules/constants';
import type { ProactiveMessagePayload } from './types';

const logger = getLogger('proactive:pushQueue');

const TABLE = 'pending_proactive_pushes';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  id             TEXT PRIMARY KEY,
  dedupe_key     TEXT NOT NULL,
  kind           TEXT NOT NULL,
  priority       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  payload_json   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  delivered_at   INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proactive_pending_dedupe
  ON ${TABLE}(dedupe_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proactive_due
  ON ${TABLE}(status, next_attempt_at);
`;

/** 队列状态（终态不可回退） */
export type ProactiveQueueStatus =
  | 'pending'
  | 'delivered'
  | 'dropped'
  | 'expired';

/** 队列中的一条主动消息 */
export interface ProactiveQueueEntry {
  id: string;
  dedupeKey: string;
  kind: string;
  priority: string;
  status: ProactiveQueueStatus;
  payload: ProactiveMessagePayload;
  createdAt: number;
  expiresAt: number;
  nextAttemptAt: number;
  attempts: number;
  lastError?: string;
  deliveredAt?: number;
}

/** 队列统计（仅观测） */
export interface ProactiveQueueStats {
  pending: number;
  delivered: number;
  dropped: number;
  expired: number;
  total: number;
}

/** 投递回调：抛错/拒绝 = 本次失败，进入退避重试 */
export type ProactiveDeliver = (
  payload: ProactiveMessagePayload
) => Promise<void>;

export interface ProactivePushQueueOptions {
  dbPath?: string;
  maxAttempts?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  scanIntervalMs?: number;
  retentionDays?: number;
}

interface ResolvedOptions {
  dbPath: string;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
  scanIntervalMs: number;
  retentionDays: number;
}

function rowToEntry(row: Record<string, unknown>): ProactiveQueueEntry {
  return {
    id: row.id as string,
    dedupeKey: row.dedupe_key as string,
    kind: row.kind as string,
    priority: row.priority as string,
    status: row.status as ProactiveQueueStatus,
    payload: JSON.parse(row.payload_json as string) as ProactiveMessagePayload,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    nextAttemptAt: row.next_attempt_at as number,
    attempts: row.attempts as number,
    lastError: (row.last_error as string | null) ?? undefined,
    deliveredAt: (row.delivered_at as number | null) ?? undefined,
  };
}

/**
 * 主动消息挂起队列。
 *
 * 用法：`await queue.init()` → `queue.enqueue(payload)` → `queue.startScanner(deliver)`。
 * 测试用 `scanOnce(deliver, now)` 同步驱动，不依赖真实定时器。
 */
export class ProactivePushQueue {
  private db: Database | null = null;
  private readonly options: ResolvedOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(options: ProactivePushQueueOptions = {}) {
    this.options = {
      dbPath: options.dbPath ?? resolveDbPath(),
      maxAttempts: options.maxAttempts ?? PROACTIVE_QUEUE_MAX_ATTEMPTS,
      baseRetryMs: options.baseRetryMs ?? PROACTIVE_QUEUE_BASE_RETRY_MS,
      maxRetryMs: options.maxRetryMs ?? PROACTIVE_QUEUE_MAX_RETRY_MS,
      scanIntervalMs:
        options.scanIntervalMs ?? PROACTIVE_QUEUE_SCAN_INTERVAL_MS,
      retentionDays: options.retentionDays ?? PROACTIVE_QUEUE_RETENTION_DAYS,
    };
  }

  /** 打开数据库并建表（幂等） */
  async init(): Promise<void> {
    if (this.db) return;
    const db = await new Promise<Database>((resolve, reject) => {
      const opened = new Database(this.options.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(opened);
      });
    });
    await new Promise<void>((resolve, reject) => {
      db.exec(SCHEMA, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.db = db;
    logger.info('proactive:queue_initialized', {
      dbPath: this.options.dbPath,
    });
  }

  /** 停止扫描并关闭数据库 */
  async close(): Promise<void> {
    this.stopScanner();
    if (!this.db) return;
    const db = this.db;
    this.db = null;
    await new Promise<void>((resolve) => {
      db.close(() => resolve());
    });
  }

  /**
   * 入队（`dedupeKey` 在 pending 期间唯一）。
   * @param now 当前时刻
   * @param nextAttemptAt 最早可投递时刻（DND / 冷却排队时由门禁给出；缺省 = 立即）
   * @returns true = 新增；false = 已有同 dedupeKey 的 pending（或 id 重复）
   */
  async enqueue(
    payload: ProactiveMessagePayload,
    now: number = Date.now(),
    nextAttemptAt: number = now
  ): Promise<boolean> {
    const db = this.ensureDb();
    const sql = `INSERT OR IGNORE INTO ${TABLE}
      (id, dedupe_key, kind, priority, status, payload_json,
       created_at, expires_at, next_attempt_at, attempts, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?)`;
    const changes = await new Promise<number>((resolve, reject) => {
      db.run(
        sql,
        [
          payload.id,
          payload.dedupeKey,
          payload.kind,
          payload.priority,
          JSON.stringify(payload),
          payload.createdAt,
          payload.expiresAt,
          nextAttemptAt,
          now,
        ],
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
    return changes > 0;
  }

  /**
   * 查询**已承诺**的近期投递记录（pending + delivered，门禁的去重 / 冷却 / 限流输入）。
   *
   * **为什么必须含 pending**（2026-10-31 根因修复）：AlwaysOn 一个 tick 内并发为 N 个项目
   * 产生结果，`enqueue` 后行是 `pending`（投递循环异步、`delivered_at` 尚未写）。
   * 若只回看 `delivered`，这一批全部读到同一份"空"快照 ⇒ 门禁的 24h 去重 / 同类冷却 /
   * 每小时上限被**整批穿透**（真机：25 个项目同拍通过，一分钟内 3 条）。
   * 用 `COALESCE(delivered_at, created_at)` 作为"承诺时刻"，让已排队但未投递的条目也计入预算。
   */
  async listRecentCommitted(
    sinceMs: number,
    limit = 200
  ): Promise<
    Array<{
      dedupeKey: string;
      kind: ProactiveMessagePayload['kind'];
      deliveredAt: number;
    }>
  > {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT dedupe_key, kind, COALESCE(delivered_at, created_at) AS at
           FROM ${TABLE}
          WHERE status IN ('pending', 'delivered')
            AND COALESCE(delivered_at, created_at) >= ?
          ORDER BY at DESC
          LIMIT ?`,
        [sinceMs, limit],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else
            resolve(
              rows.map((row) => ({
                dedupeKey: row.dedupe_key as string,
                kind: row.kind as ProactiveMessagePayload['kind'],
                deliveredAt: row.at as number,
              }))
            );
        }
      );
    });
  }

  /**
   * 查询近期已投递记录（门禁的去重 / 冷却 / 限流输入）。
   *
   * 只返回 `delivered` 终态；调用方仍需按自己的 TTL 口径过滤。
   * ⚠️ 生产者接入门禁时请用 `listRecentCommitted`（含 pending），否则同批并发会穿透限流。
   */
  async listRecentDelivered(
    sinceMs: number,
    limit = 200
  ): Promise<
    Array<{
      dedupeKey: string;
      kind: ProactiveMessagePayload['kind'];
      deliveredAt: number;
    }>
  > {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT dedupe_key, kind, delivered_at FROM ${TABLE}
         WHERE status = 'delivered' AND delivered_at IS NOT NULL AND delivered_at >= ?
         ORDER BY delivered_at DESC
         LIMIT ?`,
        [sinceMs, limit],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else
            resolve(
              rows.map((row) => ({
                dedupeKey: row.dedupe_key as string,
                kind: row.kind as ProactiveMessagePayload['kind'],
                deliveredAt: row.delivered_at as number,
              }))
            );
        }
      );
    });
  }

  /** 把已过期的 pending 标记为 expired */
  async expireDue(now: number = Date.now()): Promise<number> {
    const db = this.ensureDb();
    return new Promise<number>((resolve, reject) => {
      db.run(
        `UPDATE ${TABLE} SET status = 'expired', updated_at = ?
         WHERE status = 'pending' AND expires_at <= ?`,
        [now, now],
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
  }

  /** 取到期任务（critical > high > normal > low，再按创建时间） */
  async claimDue(
    now: number = Date.now(),
    limit = 10
  ): Promise<ProactiveQueueEntry[]> {
    await this.expireDue(now);
    const db = this.ensureDb();
    return new Promise<ProactiveQueueEntry[]>((resolve, reject) => {
      db.all(
        `SELECT * FROM ${TABLE}
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY CASE priority
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           ELSE 3 END,
           created_at ASC
         LIMIT ?`,
        [now, limit],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows.map(rowToEntry));
        }
      );
    });
  }

  /** 标记投递成功 */
  async markDelivered(id: string, now: number = Date.now()): Promise<void> {
    await this.run(
      `UPDATE ${TABLE}
       SET status = 'delivered', delivered_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      [now, now, id]
    );
  }

  /** 标记终止失败 */
  async markDropped(
    id: string,
    reason: string,
    now: number = Date.now()
  ): Promise<void> {
    await this.run(
      `UPDATE ${TABLE}
       SET status = 'dropped', last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      [reason.slice(0, 500), now, id]
    );
  }

  /**
   * 记录一次失败：未达上限 ⇒ 指数退避；达上限 ⇒ dropped。
   * @returns true = 仍会重试；false = 已终止
   */
  async markRetry(
    entry: ProactiveQueueEntry,
    error: string,
    now: number = Date.now()
  ): Promise<boolean> {
    const attempts = entry.attempts + 1;
    if (attempts >= this.options.maxAttempts) {
      await this.run(
        `UPDATE ${TABLE}
         SET status = 'dropped', attempts = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [attempts, error.slice(0, 500), now, entry.id]
      );
      return false;
    }
    const backoff = Math.min(
      this.options.baseRetryMs * 2 ** entry.attempts,
      this.options.maxRetryMs
    );
    await this.run(
      `UPDATE ${TABLE}
       SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      [attempts, now + backoff, error.slice(0, 500), now, entry.id]
    );
    return true;
  }

  /**
   * 扫描一次：过期 → 取到期 → 逐条投递 → 成功/退避。
   * 供测试与扫描器共用；并发调用会被忽略（`scanning` 守卫）。
   */
  async scanOnce(
    deliver: ProactiveDeliver,
    now: number = Date.now(),
    limit = 10
  ): Promise<{ delivered: number; retried: number; dropped: number }> {
    if (this.scanning) return { delivered: 0, retried: 0, dropped: 0 };
    this.scanning = true;
    let delivered = 0;
    let retried = 0;
    let dropped = 0;
    try {
      const due = await this.claimDue(now, limit);
      for (const entry of due) {
        try {
          await deliver(entry.payload);
          await this.markDelivered(entry.id, now);
          delivered++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await handleError(err, {
            module: 'proactive:pushQueue',
            action: 'deliver',
            context: { id: entry.id, kind: entry.kind },
          });
          const willRetry = await this.markRetry(entry, message, now);
          if (willRetry) retried++;
          else dropped++;
        }
      }
      await this.pruneRetention(now);
      return { delivered, retried, dropped };
    } finally {
      this.scanning = false;
    }
  }

  /** 启动扫描器（定时器 `unref`，不阻止进程退出） */
  startScanner(
    deliver: ProactiveDeliver,
    intervalMs: number = this.options.scanIntervalMs
  ): void {
    if (this.timer) return;
    const tick = (): void => {
      void this.scanOnce(deliver).catch((err) =>
        handleError(err, { module: 'proactive:pushQueue', action: 'scan' })
      );
    };
    // 启动即扫一次，避免首条消息等一个完整周期
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
  }

  /** 停止扫描器 */
  stopScanner(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 清理超过保留期的终态记录 */
  async pruneRetention(now: number = Date.now()): Promise<number> {
    const cutoff = now - this.options.retentionDays * MS_PER_DAY;
    const db = this.ensureDb();
    return new Promise<number>((resolve, reject) => {
      db.run(
        `DELETE FROM ${TABLE}
         WHERE status IN ('delivered', 'dropped', 'expired')
           AND updated_at < ?`,
        [cutoff],
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
  }

  /** 队列统计 */
  async stats(): Promise<ProactiveQueueStats> {
    const db = this.ensureDb();
    return new Promise<ProactiveQueueStats>((resolve, reject) => {
      db.all(
        `SELECT status, COUNT(*) AS n FROM ${TABLE} GROUP BY status`,
        [],
        (
          err: Error | null,
          rows: Array<{ status: ProactiveQueueStatus; n: number }>
        ) => {
          if (err) {
            reject(err);
            return;
          }
          const out: ProactiveQueueStats = {
            pending: 0,
            delivered: 0,
            dropped: 0,
            expired: 0,
            total: 0,
          };
          for (const row of rows) {
            out[row.status] = row.n;
            out.total += row.n;
          }
          resolve(out);
        }
      );
    });
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('ProactivePushQueue 未初始化（先 await init()）');
    }
    return this.db;
  }

  private run(sql: string, params: unknown[]): Promise<void> {
    const db = this.ensureDb();
    return new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
