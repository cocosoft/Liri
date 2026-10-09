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
 * ExecutionStore —— Execution 生命周期的**持久化记录**（PR5-S1 / 2026-10-09）
 *
 * 见 `.trae/specs/durable-execution.md` §3。
 *
 * 职责：
 * - 单例 + **惰性建表**（`CREATE TABLE IF NOT EXISTS`，复用仓内既定模式，对照
 *   `chat/yield/SettlementOutbox.ts`）；**仅新增表/索引**（`project_rules §1.5`）。
 * - 3 张表：`executions` / `execution_events` / `tool_calls`。
 * - 为 `ExecutionManager`（S2）的写穿与 `recover()` 提供持久层；本模块**不**做恢复决策。
 *
 * 诚实边界：本版 DB 是**持久记录 + 恢复依据**，运行时权威仍是内存（`ExecutionManager`）；
 * 不做多进程/分布式。
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import type {
  ExecutionGeneration,
  ExecutionId,
  ExecutionStatus,
} from './types';

const logger = getLogger('execution:store');

export const EXECUTIONS_TABLE = 'executions';
export const EXECUTION_EVENTS_TABLE = 'execution_events';
export const TOOL_CALLS_TABLE = 'tool_calls';

/** 占用中的执行状态（恢复时的"孤儿候选"集合） */
const ACTIVE_STATUSES: readonly ExecutionStatus[] = [
  'RUNNING',
  'WAITING_USER',
  'CANCEL_REQUESTED',
];

/** 持久化的执行记录（与 `ExecutionRecord` 同形） */
export interface PersistedExecution {
  executionId: ExecutionId;
  sessionId: string;
  messageId?: string;
  generation: ExecutionGeneration;
  status: ExecutionStatus;
  startedAt: number;
  updatedAt: number;
  heartbeatAt: number;
}

/** 持久化的执行事件 */
export interface PersistedExecutionEvent {
  id: number;
  executionId: ExecutionId;
  seq: number;
  type: string;
  payload?: unknown;
  createdAt: number;
}

/** 持久化的工具调用记账 */
export interface PersistedToolCall {
  id: number;
  executionId: ExecutionId;
  toolCallId: string;
  toolName: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

interface ExecutionRow {
  execution_id: string;
  session_id: string;
  message_id: string | null;
  generation: number;
  status: string;
  started_at: number;
  updated_at: number;
  heartbeat_at: number;
}

interface EventRow {
  id: number;
  execution_id: string;
  seq: number;
  type: string;
  payload_json: string | null;
  created_at: number;
}

interface ToolCallRow {
  id: number;
  execution_id: string;
  tool_call_id: string;
  tool_name: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  error: string | null;
}

function rowToExecution(row: ExecutionRow): PersistedExecution {
  return {
    executionId: row.execution_id as ExecutionId,
    sessionId: row.session_id,
    messageId: row.message_id ?? undefined,
    generation: row.generation as ExecutionGeneration,
    status: row.status as ExecutionStatus,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    heartbeatAt: row.heartbeat_at,
  };
}

export class ExecutionStore {
  private db: Database | null = null;
  private dbPath?: string;
  private initPromise: Promise<void> | null = null;

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
      // 失败后清空 initPromise（避免永久复用陈旧的 rejected promise）
      this.initPromise = null;
      throw err;
    }
  }

  private async doInit(): Promise<void> {
    const dbPath =
      this.dbPath ?? (await import('@modules/core')).resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });

    await this.run(
      `CREATE TABLE IF NOT EXISTS ${EXECUTIONS_TABLE} (
        execution_id TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        message_id   TEXT,
        generation   INTEGER NOT NULL,
        status       TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL
      )`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_executions_session
       ON ${EXECUTIONS_TABLE} (session_id, status)`
    );

    await this.run(
      `CREATE TABLE IF NOT EXISTS ${EXECUTION_EVENTS_TABLE} (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        seq          INTEGER NOT NULL,
        type         TEXT NOT NULL,
        payload_json TEXT,
        created_at   INTEGER NOT NULL
      )`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_execution_events_exec
       ON ${EXECUTION_EVENTS_TABLE} (execution_id, seq)`
    );

    await this.run(
      `CREATE TABLE IF NOT EXISTS ${TOOL_CALLS_TABLE} (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name    TEXT NOT NULL,
        status       TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        error        TEXT
      )`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_tool_calls_exec
       ON ${TOOL_CALLS_TABLE} (execution_id)`
    );

    logger.debug('executionStore:initialized', { dbPath });
  }

  /** 写入/更新执行记录（幂等 upsert） */
  async upsertExecution(rec: PersistedExecution): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${EXECUTIONS_TABLE}
        (execution_id, session_id, message_id, generation, status,
         started_at, updated_at, heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(execution_id) DO UPDATE SET
         status = excluded.status,
         generation = excluded.generation,
         updated_at = excluded.updated_at,
         heartbeat_at = excluded.heartbeat_at`,
      [
        rec.executionId,
        rec.sessionId,
        rec.messageId ?? null,
        rec.generation,
        rec.status,
        rec.startedAt,
        rec.updatedAt,
        rec.heartbeatAt,
      ]
    );
  }

  async getExecution(
    executionId: ExecutionId
  ): Promise<PersistedExecution | null> {
    await this.init();
    const row = await this.get<ExecutionRow>(
      `SELECT * FROM ${EXECUTIONS_TABLE} WHERE execution_id = ?`,
      [executionId]
    );
    return row ? rowToExecution(row) : null;
  }

  /** 占用中的执行（恢复的孤儿候选） */
  async listActive(): Promise<PersistedExecution[]> {
    await this.init();
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const rows = await this.all<ExecutionRow>(
      `SELECT * FROM ${EXECUTIONS_TABLE}
        WHERE status IN (${placeholders})
        ORDER BY updated_at ASC`,
      [...ACTIVE_STATUSES]
    );
    return rows.map(rowToExecution);
  }

  /** 某 session 已发放的最大代次（恢复期抬高内存 `lastGeneration` 用） */
  async maxGeneration(sessionId: string): Promise<number> {
    await this.init();
    const row = await this.get<{ max_gen: number | null }>(
      `SELECT MAX(generation) AS max_gen FROM ${EXECUTIONS_TABLE}
        WHERE session_id = ?`,
      [sessionId]
    );
    return row?.max_gen ?? 0;
  }

  /** 追加执行事件（`seq` 为该执行内自增；单进程假设） */
  async appendEvent(
    executionId: ExecutionId,
    type: string,
    payload?: unknown
  ): Promise<number> {
    await this.init();
    const row = await this.get<{ next_seq: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
         FROM ${EXECUTION_EVENTS_TABLE} WHERE execution_id = ?`,
      [executionId]
    );
    const seq = row?.next_seq ?? 1;
    await this.run(
      `INSERT INTO ${EXECUTION_EVENTS_TABLE}
        (execution_id, seq, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        executionId,
        seq,
        type,
        payload === undefined ? null : JSON.stringify(payload),
        Date.now(),
      ]
    );
    return seq;
  }

  async listEvents(
    executionId: ExecutionId
  ): Promise<PersistedExecutionEvent[]> {
    await this.init();
    const rows = await this.all<EventRow>(
      `SELECT * FROM ${EXECUTION_EVENTS_TABLE}
        WHERE execution_id = ? ORDER BY seq ASC`,
      [executionId]
    );
    return rows.map((r) => ({
      id: r.id,
      executionId: r.execution_id as ExecutionId,
      seq: r.seq,
      type: r.type,
      payload: r.payload_json ? JSON.parse(r.payload_json) : undefined,
      createdAt: r.created_at,
    }));
  }

  /** 记录一次工具调用（开始）。**幂等**：同 (execution,toolCallId) 已有未结算行则不再插入。 */
  async recordToolCall(
    executionId: ExecutionId,
    toolCallId: string,
    toolName: string,
    startedAt: number = Date.now()
  ): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${TOOL_CALLS_TABLE}
        (execution_id, tool_call_id, tool_name, status, started_at)
       SELECT ?, ?, ?, 'running', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM ${TOOL_CALLS_TABLE}
          WHERE execution_id = ? AND tool_call_id = ? AND ended_at IS NULL
       )`,
      [executionId, toolCallId, toolName, startedAt, executionId, toolCallId]
    );
  }

  /**
   * 结算工具调用（结束）。**健壮**：若从未记录过开始（只收到终态 chunk），
   * 先补建一行再结算 ⇒ 不丢记录。
   */
  async settleToolCall(
    executionId: ExecutionId,
    toolCallId: string,
    toolName: string,
    status: string,
    error?: string,
    endedAt: number = Date.now()
  ): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${TOOL_CALLS_TABLE}
        (execution_id, tool_call_id, tool_name, status, started_at)
       SELECT ?, ?, ?, 'running', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM ${TOOL_CALLS_TABLE}
          WHERE execution_id = ? AND tool_call_id = ?
       )`,
      [executionId, toolCallId, toolName, endedAt, executionId, toolCallId]
    );
    await this.run(
      `UPDATE ${TOOL_CALLS_TABLE}
         SET status = ?, ended_at = ?, error = ?
       WHERE execution_id = ? AND tool_call_id = ? AND ended_at IS NULL`,
      [status, endedAt, error ?? null, executionId, toolCallId]
    );
  }

  /** 结算工具调用（结束；仅更新既有的未结算行） */
  async finishToolCall(
    executionId: ExecutionId,
    toolCallId: string,
    status: string,
    error?: string,
    endedAt: number = Date.now()
  ): Promise<boolean> {
    await this.init();
    const changed = await this.run(
      `UPDATE ${TOOL_CALLS_TABLE}
         SET status = ?, ended_at = ?, error = ?
       WHERE execution_id = ? AND tool_call_id = ? AND ended_at IS NULL`,
      [status, endedAt, error ?? null, executionId, toolCallId]
    );
    return changed > 0;
  }

  /**
   * R3（2026-10-09，第九轮 §2.2 崩溃窗口）：把某执行的**未结算**工具调用（`ended_at IS NULL`）
   * 标为 **`unknown`** —— 崩溃后该次外部副作用**是否完成不可知**（既非成功也非失败）。
   *
   * 恢复侧据此**不盲目重放不可逆操作**（写文件/发消息/建资源等应走幂等键/状态查询/人工确认）。
   * 返回受影响行数（供恢复审计）。
   */
  async markUnsettledToolCallsUnknown(
    executionId: ExecutionId,
    endedAt: number = Date.now()
  ): Promise<number> {
    await this.init();
    return this.run(
      `UPDATE ${TOOL_CALLS_TABLE}
         SET status = 'unknown', ended_at = ?
       WHERE execution_id = ? AND ended_at IS NULL`,
      [endedAt, executionId]
    );
  }

  async listToolCalls(executionId: ExecutionId): Promise<PersistedToolCall[]> {
    await this.init();
    const rows = await this.all<ToolCallRow>(
      `SELECT * FROM ${TOOL_CALLS_TABLE}
        WHERE execution_id = ? ORDER BY id ASC`,
      [executionId]
    );
    return rows.map((r) => ({
      id: r.id,
      executionId: r.execution_id as ExecutionId,
      toolCallId: r.tool_call_id,
      toolName: r.tool_name,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
      error: r.error ?? undefined,
    }));
  }

  /**
   * 恢复用：把孤儿执行置 `STALE` 并提升代次（跨重启 fencing）。
   * 仅对**占用中**状态生效（终态不可改写，CS05/单向状态机）。
   */
  async markStale(
    executionId: ExecutionId,
    newGeneration: ExecutionGeneration
  ): Promise<boolean> {
    await this.init();
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const changed = await this.run(
      `UPDATE ${EXECUTIONS_TABLE}
         SET status = 'STALE', generation = ?, updated_at = ?
       WHERE execution_id = ? AND status IN (${placeholders})`,
      [newGeneration, Date.now(), executionId, ...ACTIVE_STATUSES]
    );
    return changed > 0;
  }

  /** 清理超期记录（**非占用中**且超过 `maxAgeMs`）——防无界增长 */
  async purgeOlderThan(
    maxAgeMs: number,
    now: number = Date.now()
  ): Promise<number> {
    await this.init();
    const cutoff = now - maxAgeMs;
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const removedExecs = await this.run(
      `DELETE FROM ${EXECUTIONS_TABLE}
        WHERE status NOT IN (${placeholders})
          AND updated_at < ?`,
      [...ACTIVE_STATUSES, cutoff]
    );
    // 事件/工具调用随执行一并清理（无跨表外键，显式删除）
    await this.run(
      `DELETE FROM ${EXECUTION_EVENTS_TABLE}
        WHERE execution_id NOT IN (SELECT execution_id FROM ${EXECUTIONS_TABLE})`
    );
    await this.run(
      `DELETE FROM ${TOOL_CALLS_TABLE}
        WHERE execution_id NOT IN (SELECT execution_id FROM ${EXECUTIONS_TABLE})`
    );
    return removedExecs;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initPromise = null;
  }

  // ── 低层：Database 回调 → Promise（对照 SettlementOutbox） ──

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

  private get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<T | null>((resolve, reject) => {
      db.get(sql, params, (err: Error | null, row: T | undefined) =>
        err ? reject(err) : resolve(row ?? null)
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

let _instance: ExecutionStore | null = null;

/** 全局单例（惰性建表） */
export function getExecutionStore(): ExecutionStore {
  if (!_instance) _instance = new ExecutionStore();
  return _instance;
}

/** 重置单例（仅测试用） */
export function resetExecutionStore(): void {
  _instance?.close();
  _instance = null;
}
