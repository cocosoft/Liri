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
 * MessageTraceStore — 消息链路**终态持久化**（入站监视 G2，2026-11-21）
 *
 * 背景：`MessageTraceBuffer` 是 500 条内存环形缓冲，重启即清 ⇒ 断流后重启，
 * 「当时卡在哪一阶段」的证据消失（`.trae/specs/inbound-message-monitoring-gaps.md` §2-G2）。
 *
 * 边界：
 * - **只写终态**（ok / fail / rejected）：`inflight` 不落盘，避免半成品行污染历史；
 * - **best-effort**：写盘/裁剪失败只留痕，**不得**反噬入站主流程（观测面不是新故障源）；
 * - 复用仓内既定 DB 模式（单例 + 惰性 `CREATE TABLE IF NOT EXISTS`，对标 `DedupStore`）；
 * - 只新增表（`project_rules §1.5`）；保留策略 = 7 天 + 最多 5000 行（每 6h 裁剪）。
 */

import { Database } from '@openliri/infra/external';
import { getLogger } from '@openliri/infra/monitoring';
import type {
  FinishedMessageTrace,
  MessageTrace,
  MessageTraceStage,
  MessageTraceStatus,
} from './messageTraceTypes';

const logger = getLogger('channels:monitoring:trace-store');

export const MESSAGE_TRACES_TABLE = 'channel_message_traces';

/** 保留窗口（7 天）与行数上限（5000）—— 见方案 §5.2 的写放大评估 */
export const TRACE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TRACE_MAX_ROWS = 5000;
/** 裁剪周期（6 小时） */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 历史查询条件 */
export interface MessageTraceHistoryQuery {
  channel?: string;
  status?: Exclude<MessageTraceStatus, 'inflight'>;
  /** 起始时间（epoch ms，含） */
  fromMs?: number;
  /** 结束时间（epoch ms，含） */
  toMs?: number;
  /** 单页条数（默认 100，上限 500） */
  limit?: number;
  /** 复合游标 `${startedAtMs}:${traceId}`（同毫秒多条时防漏/重） */
  cursor?: string;
}

/** 历史查询结果 */
export interface MessageTraceHistoryPage {
  traces: MessageTrace[];
  total: number;
  nextCursor: string | null;
}

interface TraceRow {
  trace_id: string;
  channel: string;
  message_id: string;
  session_id: string | null;
  sender_id: string | null;
  status: string;
  error: string | null;
  content_preview: string;
  started_at: number;
  finished_at: number;
  total_ms: number;
  stages_json: string;
}

function parseCursor(
  cursor: string | undefined
): { startedAt: number; traceId: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf(':');
  if (sep <= 0) return null;
  const startedAt = Number(cursor.slice(0, sep));
  const traceId = cursor.slice(sep + 1);
  if (!Number.isFinite(startedAt) || !traceId) return null;
  return { startedAt, traceId };
}

export class MessageTraceStore {
  private db: Database | null = null;
  private dbPath?: string;
  private initPromise: Promise<void> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  /** @param dbPath 显式库路径（测试用）；缺省惰性解析 `resolveDbPath()` */
  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  private async doInit(): Promise<void> {
    const dbPath =
      this.dbPath ??
      (await import('@openliri/infra/environment')).resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${MESSAGE_TRACES_TABLE} (
        trace_id        TEXT PRIMARY KEY,
        channel         TEXT NOT NULL,
        message_id      TEXT NOT NULL,
        session_id      TEXT,
        sender_id       TEXT,
        status          TEXT NOT NULL,
        error           TEXT,
        content_preview TEXT NOT NULL DEFAULT '',
        started_at      INTEGER NOT NULL,
        finished_at     INTEGER NOT NULL,
        total_ms        INTEGER NOT NULL,
        stages_json     TEXT NOT NULL
      )`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_chmt_started
       ON ${MESSAGE_TRACES_TABLE} (started_at)`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_chmt_channel_started
       ON ${MESSAGE_TRACES_TABLE} (channel, started_at)`
    );
    // 启动即裁剪一次；此后每 6h 一次（unref ⇒ 不阻止进程退出）
    // 注意：这里**不能**调 `this.prune()`（它会 await `init()`，而本函数正处在 init 中 ⇒ 死锁）
    await this.pruneRows(Date.now()).catch((err) => {
      // @ignore-catch 裁剪失败只留痕，不影响读写
      logger.warn('链路历史裁剪失败（非致命）', { error: String(err) });
    });
    this.startPruneTimer();
  }

  private startPruneTimer(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      void this.prune().catch((err) => {
        // @ignore-catch 周期裁剪失败只留痕
        logger.warn('链路历史周期裁剪失败（非致命）', {
          error: String(err),
        });
      });
    }, PRUNE_INTERVAL_MS);
    // Bun/Node 的 Timeout 都提供 unref；缺失时（测试桩）静默跳过
    this.pruneTimer.unref?.();
  }

  /** 写入一条**终态**链路（同 trace_id 覆盖，幂等） */
  async upsert(trace: FinishedMessageTrace): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${MESSAGE_TRACES_TABLE}
        (trace_id, channel, message_id, session_id, sender_id, status, error,
         content_preview, started_at, finished_at, total_ms, stages_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(trace_id) DO UPDATE SET
         status = excluded.status,
         error = excluded.error,
         content_preview = excluded.content_preview,
         finished_at = excluded.finished_at,
         total_ms = excluded.total_ms,
         stages_json = excluded.stages_json`,
      [
        trace.traceId,
        trace.channelName,
        trace.messageId,
        trace.sessionId ?? null,
        trace.senderId ?? null,
        trace.status,
        trace.error ?? null,
        trace.contentPreview,
        trace.startedAtMs,
        trace.finishedAtMs ?? trace.startedAtMs,
        trace.totalMs ?? 0,
        JSON.stringify(trace.stages),
      ]
    );
  }

  /**
   * 历史分页查询（`started_at DESC, trace_id DESC`）。
   *
   * 游标用 `(started_at, trace_id)` 复合键：同毫秒多条时单列游标会漏/重
   * （先例：`NotificationPersistence` P0-6）。
   */
  async history(
    query: MessageTraceHistoryQuery = {}
  ): Promise<MessageTraceHistoryPage> {
    await this.init();
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (query.channel) {
      conditions.push('channel = ?');
      values.push(query.channel);
    }
    if (query.status) {
      conditions.push('status = ?');
      values.push(query.status);
    }
    if (query.fromMs !== undefined) {
      conditions.push('started_at >= ?');
      values.push(query.fromMs);
    }
    if (query.toMs !== undefined) {
      conditions.push('started_at <= ?');
      values.push(query.toMs);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = await this.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ${MESSAGE_TRACES_TABLE} ${where}`,
      values
    );

    const pageConditions = [...conditions];
    const pageValues = [...values];
    const cursor = parseCursor(query.cursor);
    if (cursor) {
      pageConditions.push(
        '(started_at < ? OR (started_at = ? AND trace_id < ?))'
      );
      pageValues.push(cursor.startedAt, cursor.startedAt, cursor.traceId);
    }
    const pageWhere =
      pageConditions.length > 0 ? `WHERE ${pageConditions.join(' AND ')}` : '';

    // 多取 1 条用于判定"是否还有下一页"（否则最后一页恰好满行时会给出行不通的游标）
    const rows = await this.all<TraceRow>(
      `SELECT * FROM ${MESSAGE_TRACES_TABLE} ${pageWhere}
       ORDER BY started_at DESC, trace_id DESC
       LIMIT ?`,
      [...pageValues, limit + 1]
    );

    const hasMore = rows.length > limit;
    const traces = rows.slice(0, limit).map((row) => this.toTrace(row));
    const last = traces[traces.length - 1];
    const nextCursor =
      hasMore && last ? `${last.startedAtMs}:${last.traceId}` : null;
    return { traces, total: total?.cnt ?? 0, nextCursor };
  }

  /** 裁剪：先按时间（7 天），再按行数（保留最近 5000 行）；返回删除行数 */
  async prune(now: number = Date.now()): Promise<number> {
    await this.init();
    return this.pruneRows(now);
  }

  /** 裁剪实现（要求 DB 已就绪；init 期间直接调用，避免重入 init 死锁） */
  private async pruneRows(now: number): Promise<number> {
    const byAge = await this.run(
      `DELETE FROM ${MESSAGE_TRACES_TABLE} WHERE started_at < ?`,
      [now - TRACE_RETENTION_MS]
    );
    const byRows = await this.run(
      `DELETE FROM ${MESSAGE_TRACES_TABLE} WHERE trace_id IN (
         SELECT trace_id FROM ${MESSAGE_TRACES_TABLE}
         ORDER BY started_at DESC, trace_id DESC
         LIMIT -1 OFFSET ?
       )`,
      [TRACE_MAX_ROWS]
    );
    return byAge + byRows;
  }

  close(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initPromise = null;
  }

  private toTrace(row: TraceRow): MessageTrace {
    let stages: MessageTraceStage[] = [];
    try {
      stages = JSON.parse(row.stages_json) as MessageTraceStage[];
    } catch (err) {
      // @ignore-catch 单行 JSON 损坏不应打断整页历史查询（该行按"无阶段"展示）
      logger.warn('链路阶段 JSON 解析失败（按空阶段返回）', {
        traceId: row.trace_id,
        error: String(err),
      });
    }
    return {
      traceId: row.trace_id,
      channelName: row.channel,
      messageId: row.message_id,
      sessionId: row.session_id ?? undefined,
      senderId: row.sender_id ?? undefined,
      contentPreview: row.content_preview,
      startedAtMs: row.started_at,
      finishedAtMs: row.finished_at,
      totalMs: row.total_ms,
      status: row.status as MessageTraceStatus,
      error: row.error ?? undefined,
      stages,
    };
  }

  private run(sql: string, params: unknown[] = []): Promise<number> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<number>((resolve, reject) => {
      db.run(
        sql,
        params,
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
  }

  private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<T | undefined>((resolve, reject) => {
      db.get(sql, params, (err: Error | null, row: T | undefined) =>
        err ? reject(err) : resolve(row)
      );
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<T[]>((resolve, reject) => {
      db.all(sql, params, (err: Error | null, rows: T[] | undefined) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }
}

let _instance: MessageTraceStore | null = null;

/** 全局单例（惰性建表；与 `getDedupStore` 同构） */
export function getMessageTraceStore(): MessageTraceStore {
  if (!_instance) _instance = new MessageTraceStore();
  return _instance;
}

/** 重置单例（仅测试用） */
export function resetMessageTraceStoreForTest(): void {
  _instance?.close();
  _instance = null;
}

/**
 * best-effort 持久化一条终态链路（fire-and-forget）。
 *
 * 失败只 `logger.warn`，**不向上抛** —— 观测面写盘不得阻塞入站主流程。
 */
export function persistFinishedMessageTrace(trace: FinishedMessageTrace): void {
  void getMessageTraceStore()
    .upsert(trace)
    .catch((err) => {
      // @ignore-catch 观测面写盘失败不得反噬入站主流程
      logger.warn('消息链路持久化失败（非致命）', {
        traceId: trace.traceId,
        error: String(err),
      });
    });
}
