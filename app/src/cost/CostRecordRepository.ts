/**
 * 成本记录存储库
 * 提供 SQLite 持久化的成本记录存储，
 * 支持逐条记录、会话摘要和历史查询。
 */
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Database } from '@modules/external';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveDbPath, resolveTenantDbPath } from '@modules/environment';
import { SimpleMutex } from '@openliri/kernel';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';

const logger = getLogger('cost:recordRepository');

export const COST_RECORDS_TABLE = 'cost_records';
export const COST_SESSION_SUMMARY_TABLE = 'session_cost_summaries';

/**
 * 成本记录
 */
export interface CostRecordRow {
  id: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
  durationMs: number;
  requestId?: string;
  timestamp: number;
  createdAt: number;
}

/**
 * 会话成本摘要
 */
export interface SessionCostSummaryRow {
  sessionId: string;
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  modelBreakdown: string;
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
}

/**
 * 成本查询过滤器
 */
export interface CostQueryFilter {
  sessionId?: string;
  model?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * 成本聚合结果
 */
export interface CostAggregation {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  modelBreakdown: Record<
    string,
    {
      totalCost: number;
      totalTokens: number;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
}

/**
 * 成本记录数据库仓库
 * 基于 sqlite3，遵循现有 CheckpointDatabase 模式
 */
export class CostRecordRepository {
  private db: Database | null = null;
  private dbPath: string;

  /**
   * 写操作互斥锁（防止并发 SQLite WAL 锁冲突）
   */
  private dbMutex = new SimpleMutex();

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  async initDatabase(): Promise<void> {
    if (this.db) {
      return;
    }

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });

    await this.createTables();
  }

  private async createTables(): Promise<void> {
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
        CREATE TABLE IF NOT EXISTS ${COST_RECORDS_TABLE} (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          cache_read_tokens INTEGER DEFAULT 0,
          cache_creation_tokens INTEGER DEFAULT 0,
          cost_usd REAL NOT NULL,
          duration_ms INTEGER DEFAULT 0,
          request_id TEXT,
          timestamp INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          owner_key TEXT NOT NULL DEFAULT 'local:local'
        )
      `,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
    await this.ensureOwnerColumn(COST_RECORDS_TABLE);

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE INDEX IF NOT EXISTS idx_cost_records_session_id
        ON ${COST_RECORDS_TABLE}(session_id)
      `,
        (err: Error | null) => {
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
        CREATE INDEX IF NOT EXISTS idx_cost_records_timestamp
        ON ${COST_RECORDS_TABLE}(timestamp)
      `,
        (err: Error | null) => {
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
        CREATE INDEX IF NOT EXISTS idx_cost_records_model
        ON ${COST_RECORDS_TABLE}(model)
      `,
        (err: Error | null) => {
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
        CREATE TABLE IF NOT EXISTS ${COST_SESSION_SUMMARY_TABLE} (
          session_id TEXT NOT NULL,
          total_cost_usd REAL DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0,
          total_cache_read_tokens INTEGER DEFAULT 0,
          total_cache_creation_tokens INTEGER DEFAULT 0,
          total_requests INTEGER DEFAULT 0,
          model_breakdown TEXT DEFAULT '{}',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          updated_at INTEGER NOT NULL,
          owner_key TEXT NOT NULL DEFAULT 'local:local',
          -- 租户级库：同一 sessionId 可能属于同租户的不同用户 ⇒ 主键必须带 owner_key
          PRIMARY KEY (session_id, owner_key)
        )
      `,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
    await this.ensureOwnerColumn(COST_SESSION_SUMMARY_TABLE);
  }

  /**
   * 存量库补 `owner_key` 列（两张表各自一次）。
   * 默认 `local:local` ⇒ 桌面端历史行自然归属本地身份，加 owner 过滤后仍可见。
   *
   * ⚠️ 如实边界：`ALTER TABLE` **不能改主键** —— 旧库的 `session_cost_summaries`
   * 仍是单列 PK；但旧库只属本地单身份（全 `local:local`），不会碰撞。
   * 租户库是**新库**，按复合主键 `(session_id, owner_key)` 建表。
   */
  private async ensureOwnerColumn(table: string): Promise<void> {
    const columns = await new Promise<Array<Record<string, unknown>>>(
      (resolve, reject) => {
        this.db?.all(
          `PRAGMA table_info(${table})`,
          [],
          (err: Error | null, rows: unknown[]) =>
            err
              ? reject(err)
              : resolve((rows || []) as Array<Record<string, unknown>>)
        );
      }
    );
    if (columns.some((c) => c.name === 'owner_key')) return;
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `ALTER TABLE ${table} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  /** 当前写入/查询的归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  async recordCost(params: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    costUSD: number;
    durationMs?: number;
    sessionId?: string;
    requestId?: string;
  }): Promise<string> {
    await this.initDatabase();

    const id = randomUUID();
    const timestamp = Date.now();
    const sessionId = params.sessionId || 'global';
    const durationMs = params.durationMs || 0;
    const cacheReadTokens = params.cacheReadTokens || 0;
    const cacheCreationTokens = params.cacheCreationTokens || 0;

    await this.dbMutex.run(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db?.run(
          `INSERT INTO ${COST_RECORDS_TABLE}
          (id, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, request_id, timestamp, owner_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            sessionId,
            params.model,
            params.inputTokens,
            params.outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            params.costUSD,
            durationMs,
            params.requestId || null,
            timestamp,
            this.owner(),
          ],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });

      await this.upsertSessionSummaryUnlocked(sessionId, {
        costUSD: params.costUSD,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        model: params.model,
      });
    });

    return id;
  }

  private async upsertSessionSummaryUnlocked(
    sessionId: string,
    delta: {
      costUSD: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      model: string;
    }
  ): Promise<void> {
    const existing = await this.getSessionSummary(sessionId);
    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      const breakdown = JSON.parse(existing.modelBreakdown || '{}');
      if (!breakdown[delta.model]) {
        breakdown[delta.model] = {
          totalCost: 0,
          totalTokens: 0,
          requestCount: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      const m = breakdown[delta.model];
      m.totalCost += delta.costUSD;
      m.totalTokens += delta.inputTokens + delta.outputTokens;
      m.requestCount += 1;
      m.inputTokens += delta.inputTokens;
      m.outputTokens += delta.outputTokens;

      await new Promise<void>((resolve, reject) => {
        this.db?.run(
          `UPDATE ${COST_SESSION_SUMMARY_TABLE}
          SET total_cost_usd = total_cost_usd + ?,
              total_input_tokens = total_input_tokens + ?,
              total_output_tokens = total_output_tokens + ?,
              total_cache_read_tokens = total_cache_read_tokens + ?,
              total_cache_creation_tokens = total_cache_creation_tokens + ?,
              total_requests = total_requests + 1,
              model_breakdown = ?,
              updated_at = ?
          WHERE session_id = ? AND owner_key = ?`,
          [
            delta.costUSD,
            delta.inputTokens,
            delta.outputTokens,
            delta.cacheReadTokens,
            delta.cacheCreationTokens,
            JSON.stringify(breakdown),
            now,
            sessionId,
            this.owner(),
          ],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    } else {
      const breakdown: Record<string, unknown> = {};
      breakdown[delta.model] = {
        totalCost: delta.costUSD,
        totalTokens: delta.inputTokens + delta.outputTokens,
        requestCount: 1,
        inputTokens: delta.inputTokens,
        outputTokens: delta.outputTokens,
      };

      await new Promise<void>((resolve, reject) => {
        this.db?.run(
          `INSERT INTO ${COST_SESSION_SUMMARY_TABLE}
          (session_id, total_cost_usd, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_requests, model_breakdown, started_at, updated_at, owner_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            delta.costUSD,
            delta.inputTokens,
            delta.outputTokens,
            delta.cacheReadTokens,
            delta.cacheCreationTokens,
            1,
            JSON.stringify(breakdown),
            now,
            now,
            this.owner(),
          ],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    }
  }

  async getSessionSummary(
    sessionId: string
  ): Promise<SessionCostSummaryRow | null> {
    await this.initDatabase();

    const row = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT * FROM ${COST_SESSION_SUMMARY_TABLE}
         WHERE session_id = ? AND owner_key = ?`,
        [sessionId, this.owner()],
        (err: Error | null, row: unknown) => {
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

    return this.rowToSessionSummary(row as Record<string, unknown>);
  }

  async getSessionCostRecords(
    sessionId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<CostRecordRow[]> {
    await this.initDatabase();

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${COST_RECORDS_TABLE}
        WHERE session_id = ? AND owner_key = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?`,
        [sessionId, this.owner(), limit, offset],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((row) =>
      this.rowToCostRecord(row as Record<string, unknown>)
    );
  }

  async getCostRecords(filter: CostQueryFilter): Promise<CostRecordRow[]> {
    await this.initDatabase();

    // owner 过滤**恒在首位**（本地 ⇒ `local:local`；租户内 ⇒ `<tenant>:<user>`）
    const conditions: string[] = ['owner_key = ?'];
    const params: unknown[] = [this.owner()];

    if (filter.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }

    if (filter.model) {
      conditions.push('model = ?');
      params.push(filter.model);
    }

    if (filter.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filter.limit ? `LIMIT ${filter.limit}` : '';
    const offsetClause = filter.offset ? `OFFSET ${filter.offset}` : '';

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${COST_RECORDS_TABLE}
        ${whereClause}
        ORDER BY timestamp DESC
        ${limitClause} ${offsetClause}`,
        params,
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((row) =>
      this.rowToCostRecord(row as Record<string, unknown>)
    );
  }

  async getAggregatedCosts(filter: CostQueryFilter): Promise<CostAggregation> {
    await this.initDatabase();

    // owner 过滤**恒在首位**（本地 ⇒ `local:local`；租户内 ⇒ `<tenant>:<user>`）
    const conditions: string[] = ['owner_key = ?'];
    const params: unknown[] = [this.owner()];

    if (filter.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }

    if (filter.model) {
      conditions.push('model = ?');
      params.push(filter.model);
    }

    if (filter.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT
          COALESCE(SUM(cost_usd), 0) as total_cost_usd,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
          COUNT(*) as total_requests
        FROM ${COST_RECORDS_TABLE}
        ${whereClause}`,
        params,
        (err: Error | null, row: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    const modelRows = await new Promise<unknown[]>((resolve, reject) => {
      this.db?.all(
        `SELECT
          model,
          COALESCE(SUM(cost_usd), 0) as total_cost,
          COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
          COUNT(*) as request_count,
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output
        FROM ${COST_RECORDS_TABLE}
        ${whereClause}
        GROUP BY model
        ORDER BY total_cost DESC`,
        params,
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    const modelBreakdown: CostAggregation['modelBreakdown'] = {};
    const resultRow = result as Record<string, unknown>;
    for (const item of modelRows) {
      const row = item as Record<string, unknown>;
      modelBreakdown[row.model as string] = {
        totalCost: row.total_cost as number,
        totalTokens: row.total_tokens as number,
        requestCount: row.request_count as number,
        inputTokens: row.total_input as number,
        outputTokens: row.total_output as number,
      };
    }

    return {
      totalCostUSD: resultRow.total_cost_usd as number,
      totalInputTokens: resultRow.total_input_tokens as number,
      totalOutputTokens: resultRow.total_output_tokens as number,
      totalCacheReadTokens: resultRow.total_cache_read_tokens as number,
      totalCacheCreationTokens: resultRow.total_cache_creation_tokens as number,
      totalRequests: resultRow.total_requests as number,
      modelBreakdown,
    };
  }

  async deleteSessionRecords(sessionId: string): Promise<void> {
    await this.initDatabase();

    await this.dbMutex.run(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db?.run(
          `DELETE FROM ${COST_RECORDS_TABLE}
            WHERE session_id = ? AND owner_key = ?`,
          [sessionId, this.owner()],
          (err: Error | null) => {
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
          `DELETE FROM ${COST_SESSION_SUMMARY_TABLE}
            WHERE session_id = ? AND owner_key = ?`,
          [sessionId, this.owner()],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });
  }

  /** 某张表里出现过的会话 id（当前身份） */
  private async distinctSessionIds(table: string): Promise<string[]> {
    await this.initDatabase();

    return new Promise<string[]>((resolve, reject) => {
      this.db?.all(
        `SELECT DISTINCT session_id AS sid FROM ${table} WHERE owner_key = ?`,
        [this.owner()],
        (err: Error | null, rows: Array<Record<string, unknown>>) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []).map((row) => String(row.sid)));
          }
        }
      );
    });
  }

  /**
   * #24（2026-10-30）：找出"会话已不存在"的成本痕迹（**只读**，dry-run 用）。
   *
   * 实测（本机）：`session_cost_summaries` 404 行 ≫ 磁盘 32 个会话 —— 历史删除会话时
   * 并非所有路径都调了 `deleteSessionRecords`，孤儿行只增不减。
   *
   * @param keepSessionIds 仍存在的会话 id（调用方以磁盘真源为准）
   * @returns 孤儿会话 id 及其在两表中的出现情况（供 CLI 如实报告）
   */
  async findOrphanSessions(keepSessionIds: ReadonlySet<string>): Promise<{
    orphanSessionIds: string[];
    withSummary: number;
    withRecords: number;
  }> {
    const [summaryIds, recordIds] = await Promise.all([
      this.distinctSessionIds(COST_SESSION_SUMMARY_TABLE),
      this.distinctSessionIds(COST_RECORDS_TABLE),
    ]);
    const summarySet = new Set(summaryIds);
    const recordSet = new Set(recordIds);
    const orphanSessionIds = [...new Set([...summaryIds, ...recordIds])]
      .filter((id) => !keepSessionIds.has(id))
      // 稳定输出：便于 dry-run 复现同一份清单
      .sort();

    return {
      orphanSessionIds,
      withSummary: orphanSessionIds.filter((id) => summarySet.has(id)).length,
      withRecords: orphanSessionIds.filter((id) => recordSet.has(id)).length,
    };
  }

  /**
   * #24：按给定 id 清理成本痕迹（摘要 + 明细），复用删除路径的同一语义。
   *
   * @returns 实际清理的会话数
   */
  async pruneOrphanSessions(
    orphanSessionIds: readonly string[]
  ): Promise<number> {
    for (const id of orphanSessionIds) {
      await this.deleteSessionRecords(id);
    }
    return orphanSessionIds.length;
  }

  async endSession(sessionId: string): Promise<void> {
    await this.initDatabase();

    const now = Math.floor(Date.now() / 1000);

    await this.dbMutex.run(async () => {
      await new Promise<void>((resolve, reject) => {
        this.db?.run(
          `UPDATE ${COST_SESSION_SUMMARY_TABLE}
          SET ended_at = ?, updated_at = ?
          WHERE session_id = ? AND owner_key = ?`,
          [now, now, sessionId, this.owner()],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });
  }

  async getAllSessionSummaries(
    limit: number = 20,
    offset: number = 0
  ): Promise<SessionCostSummaryRow[]> {
    await this.initDatabase();

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${COST_SESSION_SUMMARY_TABLE}
        WHERE owner_key = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?`,
        [this.owner(), limit, offset],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((row) =>
      this.rowToSessionSummary(row as Record<string, unknown>)
    );
  }

  /**
   * 统计有成本记录的会话总数（session_cost_summaries 行数）
   */
  async countSessionSummaries(): Promise<number> {
    await this.initDatabase();

    const row = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        this.db?.get(
          `SELECT COUNT(*) AS cnt FROM ${COST_SESSION_SUMMARY_TABLE}
           WHERE owner_key = ?`,
          [this.owner()],
          (err: Error | null, row: unknown) => {
            if (err) {
              reject(err);
            } else {
              resolve(row as Record<string, unknown> | undefined);
            }
          }
        );
      }
    );

    return Number(row?.cnt || 0);
  }

  /**
   * 统计活动会话数（session_cost_summaries 中未结束的会话）
   */
  async countActiveSessionSummaries(): Promise<number> {
    await this.initDatabase();

    const row = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        this.db?.get(
          `SELECT COUNT(*) AS cnt FROM ${COST_SESSION_SUMMARY_TABLE}
           WHERE ended_at IS NULL AND owner_key = ?`,
          [this.owner()],
          (err: Error | null, row: unknown) => {
            if (err) {
              reject(err);
            } else {
              resolve(row as Record<string, unknown> | undefined);
            }
          }
        );
      }
    );

    return Number(row?.cnt || 0);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ============================================================
  // [v1.2] 按天聚合查询（UTC 日界，供成本 API 使用）
  // ============================================================

  /**
   * 按 UTC 日界聚合每日成本数据
   * SQLite `date(timestamp/1000, 'unixepoch')` 返回 UTC 日期
   */
  async getDailyAggregatedCosts(
    startTime?: number,
    endTime?: number
  ): Promise<
    Array<{
      date: string;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      requests: number;
    }>
  > {
    await this.initDatabase();

    // owner 过滤**恒在首位**（本地 ⇒ `local:local`；租户内 ⇒ `<tenant>:<user>`）
    const conditions: string[] = ['owner_key = ?'];
    const params: unknown[] = [this.owner()];

    if (startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(startTime);
    }
    if (endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(endTime);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      this.db?.all(
        `SELECT
          date(timestamp / 1000, 'unixepoch') as date,
          COALESCE(SUM(cost_usd), 0) as cost,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
          COUNT(*) as requests
        FROM ${COST_RECORDS_TABLE}
        ${whereClause}
        GROUP BY date
        ORDER BY date ASC`,
        params,
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        date: row.date as string,
        cost: row.cost as number,
        inputTokens: row.input_tokens as number,
        outputTokens: row.output_tokens as number,
        cacheReadTokens: row.cache_read_tokens as number,
        cacheCreationTokens: row.cache_creation_tokens as number,
        requests: row.requests as number,
      };
    });
  }

  /**
   * 获取成本记录列表（分页，供 API 使用）
   */
  async getCostRecordsWithPagination(
    startTime?: number,
    endTime?: number,
    limit: number = 50,
    offset: number = 0
  ): Promise<Array<CostRecordRow & { date: string }>> {
    return this.getCostRecords({
      startTime,
      endTime,
      limit,
      offset,
    }) as Promise<Array<CostRecordRow & { date: string }>>;
  }

  // ============================================================
  // [v1.2] 对账查询（model_usage_logs vs cost_records）
  // ============================================================

  async reconcileUsageAndCost(
    startTime?: number,
    endTime?: number
  ): Promise<{
    matched: number;
    onlyInUsage: number;
    onlyInCost: number;
    costDiffs: Array<{
      requestId: string;
      model: string;
      costUsageLogs: number;
      costRecords: number;
      diff: number;
    }>;
  }> {
    await this.initDatabase();

    const owner = this.owner();
    // `model_usage_logs.owner_key` 可空（历史/本地行 = NULL）：本地身份要连 NULL 一起看；
    // 已认证身份只看自己的行（fail-closed）。
    const local = isLocalPrincipal(getRequestPrincipal());
    const usageOwnerAliased = local
      ? '(u.owner_key IS NULL OR u.owner_key = ?)'
      : 'u.owner_key = ?';
    const usageOwnerBare = local
      ? '(owner_key IS NULL OR owner_key = ?)'
      : 'owner_key = ?';

    const conds: string[] = ['u.status_code < 400', usageOwnerAliased];
    const params: unknown[] = [owner];

    if (startTime !== undefined) {
      conds.push('u.timestamp >= ?');
      params.push(Math.floor(startTime / 1000));
    }
    if (endTime !== undefined) {
      conds.push('u.timestamp <= ?');
      params.push(Math.floor(endTime / 1000));
    }
    const where = conds.join(' AND ');

    interface DiffRow {
      request_id: string;
      model: string;
      cost_usage: number;
      cost_cost: number;
    }
    const diffs = await new Promise<DiffRow[]>((resolve, reject) => {
      this.db?.all(
        `SELECT u.request_id, u.model, u.cost_usd as cost_usage, c.cost_usd as cost_cost
         FROM model_usage_logs u
         INNER JOIN cost_records c ON u.request_id = c.request_id
         WHERE ${where} AND u.request_id IS NOT NULL AND c.request_id IS NOT NULL
           AND c.owner_key = ?
           AND ABS(u.cost_usd - c.cost_usd) > 0.000001`,
        [...params, owner],
        (err: Error | null, rows: unknown[]) => {
          if (err) reject(err);
          else resolve((rows || []) as DiffRow[]);
        }
      );
    });

    const s = startTime ?? 0,
      e = endTime ?? 9999999999999;
    const counts = await new Promise<{
      matched: number;
      only_usage: number;
      only_cost: number;
    }>((resolve, reject) => {
      this.db?.get(
        `SELECT
          (SELECT COUNT(*) FROM model_usage_logs u
           INNER JOIN cost_records c ON u.request_id = c.request_id
           WHERE ${where} AND u.request_id IS NOT NULL
             AND c.owner_key = ?) as matched,
          (SELECT COUNT(*) FROM model_usage_logs u
           WHERE ${where} AND u.request_id IS NOT NULL
           AND u.request_id NOT IN (SELECT request_id FROM cost_records
                                     WHERE request_id IS NOT NULL AND owner_key = ?)) as only_usage,
          (SELECT COUNT(*) FROM cost_records c
           WHERE c.timestamp >= ? AND c.timestamp <= ? AND c.owner_key = ?
           AND c.request_id IS NOT NULL
           AND c.request_id NOT IN (SELECT request_id FROM model_usage_logs
                                     WHERE request_id IS NOT NULL AND ${usageOwnerBare})) as only_cost`,
        [...params, owner, ...params, owner, s, e, owner, owner],
        (err: Error | null, row: unknown) => {
          if (err) reject(err);
          else
            resolve(
              (row || { matched: 0, only_usage: 0, only_cost: 0 }) as {
                matched: number;
                only_usage: number;
                only_cost: number;
              }
            );
        }
      );
    });

    return {
      matched: counts.matched,
      onlyInUsage: counts.only_usage,
      onlyInCost: counts.only_cost,
      costDiffs: diffs.map((d) => ({
        requestId: d.request_id,
        model: d.model,
        costUsageLogs: d.cost_usage,
        costRecords: d.cost_cost,
        diff: Math.abs(d.cost_usage - d.cost_cost),
      })),
    };
  }

  private rowToCostRecord(row: Record<string, unknown>): CostRecordRow {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      model: row.model as string,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cacheReadTokens: row.cache_read_tokens as number,
      cacheCreationTokens: row.cache_creation_tokens as number,
      costUSD: row.cost_usd as number,
      durationMs: row.duration_ms as number,
      requestId: (row.request_id as string | null) || undefined,
      timestamp: row.timestamp as number,
      createdAt: row.created_at as number,
    };
  }

  private rowToSessionSummary(
    row: Record<string, unknown>
  ): SessionCostSummaryRow {
    return {
      sessionId: row.session_id as string,
      totalCostUSD: row.total_cost_usd as number,
      totalInputTokens: row.total_input_tokens as number,
      totalOutputTokens: row.total_output_tokens as number,
      totalCacheReadTokens: row.total_cache_read_tokens as number,
      totalCacheCreationTokens: row.total_cache_creation_tokens as number,
      totalRequests: row.total_requests as number,
      modelBreakdown: row.model_breakdown as string,
      startedAt: row.started_at as number,
      endedAt: (row.ended_at as number) || undefined,
      updatedAt: row.updated_at as number,
    };
  }
}

let defaultRepository: CostRecordRepository | null = null;
/** 租户级 DB（§6.1）：实例按**租户**缓存（同租户用户共用连接，行级隔离靠 `owner_key`） */
const scopedRepositories = new Map<string, CostRecordRepository>(); // key = tenantId

/**
 * 取成本记录仓库。
 *
 * 多租户 §6.1：本地身份 ⇒ 原单例（零变更）；已认证身份 ⇒ 该**租户**的实例
 * （`tenants/<t>/app.db`），用户维度靠 `owner_key` 过滤。
 */
export function getCostRecordRepository(): CostRecordRepository {
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const tenantKey = principal.tenantId;
    const existing = scopedRepositories.get(tenantKey);
    if (existing) return existing;
    const scoped = new CostRecordRepository(resolveTenantDbPath(principal));
    scopedRepositories.set(tenantKey, scoped);
    // 登记键用**创建者**的 `<tenant>:<user>`：purge 按 `<tenant>:` 前缀关闭 ⇒ 删租户能命中
    registerScopedResource(principalKeyOf(principal), async () => {
      await scoped.close();
      scopedRepositories.delete(tenantKey);
    });
    return scoped;
  }
  if (!defaultRepository) {
    defaultRepository = new CostRecordRepository();
  }
  return defaultRepository;
}
