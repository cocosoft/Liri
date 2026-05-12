/**
 * 成本记录存储库
 * 提供 SQLite 持久化的成本记录存储，
 * 支持逐条记录、会话摘要和历史查询。
 */
import { randomUUID } from 'node:crypto';
import { Database } from 'sqlite3';
import { Logger } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger();

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

  constructor(dbPath: string = './data/py_copilot.db') {
    this.dbPath = dbPath;
  }

  async initDatabase(): Promise<void> {
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
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
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
        CREATE INDEX IF NOT EXISTS idx_cost_records_session_id
        ON ${COST_RECORDS_TABLE}(session_id)
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
        CREATE INDEX IF NOT EXISTS idx_cost_records_timestamp
        ON ${COST_RECORDS_TABLE}(timestamp)
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
        CREATE INDEX IF NOT EXISTS idx_cost_records_model
        ON ${COST_RECORDS_TABLE}(model)
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
        CREATE TABLE IF NOT EXISTS ${COST_SESSION_SUMMARY_TABLE} (
          session_id TEXT PRIMARY KEY,
          total_cost_usd REAL DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0,
          total_cache_read_tokens INTEGER DEFAULT 0,
          total_cache_creation_tokens INTEGER DEFAULT 0,
          total_requests INTEGER DEFAULT 0,
          model_breakdown TEXT DEFAULT '{}',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
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

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO ${COST_RECORDS_TABLE}
        (id, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, request_id, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    await this.upsertSessionSummary(sessionId, {
      costUSD: params.costUSD,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      model: params.model,
    });

    return id;
  }

  private async upsertSessionSummary(
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
          WHERE session_id = ?`,
          [
            delta.costUSD,
            delta.inputTokens,
            delta.outputTokens,
            delta.cacheReadTokens,
            delta.cacheCreationTokens,
            JSON.stringify(breakdown),
            now,
            sessionId,
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
    } else {
      const breakdown: Record<string, any> = {};
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
          (session_id, total_cost_usd, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_requests, model_breakdown, started_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  }

  async getSessionSummary(
    sessionId: string
  ): Promise<SessionCostSummaryRow | null> {
    await this.initDatabase();

    const row = await new Promise<any>((resolve, reject) => {
      this.db?.get(
        `SELECT * FROM ${COST_SESSION_SUMMARY_TABLE} WHERE session_id = ?`,
        [sessionId],
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

    return this.rowToSessionSummary(row);
  }

  async getSessionCostRecords(
    sessionId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<CostRecordRow[]> {
    await this.initDatabase();

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${COST_RECORDS_TABLE}
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?`,
        [sessionId, limit, offset],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((row) => this.rowToCostRecord(row));
  }

  async getCostRecords(filter: CostQueryFilter): Promise<CostRecordRow[]> {
    await this.initDatabase();

    const conditions: string[] = [];
    const params: any[] = [];

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

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${COST_RECORDS_TABLE}
        ${whereClause}
        ORDER BY timestamp DESC
        ${limitClause} ${offsetClause}`,
        params,
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((row) => this.rowToCostRecord(row));
  }

  async getAggregatedCosts(filter: CostQueryFilter): Promise<CostAggregation> {
    await this.initDatabase();

    const conditions: string[] = [];
    const params: any[] = [];

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

    const result = await new Promise<any>((resolve, reject) => {
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
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    const modelRows = await new Promise<any[]>((resolve, reject) => {
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
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    const modelBreakdown: CostAggregation['modelBreakdown'] = {};
    for (const row of modelRows) {
      modelBreakdown[row.model] = {
        totalCost: row.total_cost,
        totalTokens: row.total_tokens,
        requestCount: row.request_count,
        inputTokens: row.total_input,
        outputTokens: row.total_output,
      };
    }

    return {
      totalCostUSD: result.total_cost_usd,
      totalInputTokens: result.total_input_tokens,
      totalOutputTokens: result.total_output_tokens,
      totalCacheReadTokens: result.total_cache_read_tokens,
      totalCacheCreationTokens: result.total_cache_creation_tokens,
      totalRequests: result.total_requests,
      modelBreakdown,
    };
  }

  async deleteSessionRecords(sessionId: string): Promise<void> {
    await this.initDatabase();

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `DELETE FROM ${COST_RECORDS_TABLE} WHERE session_id = ?`,
        [sessionId],
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
        `DELETE FROM ${COST_SESSION_SUMMARY_TABLE} WHERE session_id = ?`,
        [sessionId],
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

  async endSession(sessionId: string): Promise<void> {
    await this.initDatabase();

    const now = Math.floor(Date.now() / 1000);

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `UPDATE ${COST_SESSION_SUMMARY_TABLE}
        SET ended_at = ?, updated_at = ?
        WHERE session_id = ?`,
        [now, now, sessionId],
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

  async getAllSessionSummaries(
    limit: number = 20,
    offset: number = 0
  ): Promise<SessionCostSummaryRow[]> {
    await this.initDatabase();

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${COST_SESSION_SUMMARY_TABLE}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    return rows.map((row) => this.rowToSessionSummary(row));
  }

  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db?.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      this.db = null;
    }
  }

  private rowToCostRecord(row: any): CostRecordRow {
    return {
      id: row.id,
      sessionId: row.session_id,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      costUSD: row.cost_usd,
      durationMs: row.duration_ms,
      requestId: row.request_id || undefined,
      timestamp: row.timestamp,
      createdAt: row.created_at,
    };
  }

  private rowToSessionSummary(row: any): SessionCostSummaryRow {
    return {
      sessionId: row.session_id,
      totalCostUSD: row.total_cost_usd,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      totalRequests: row.total_requests,
      modelBreakdown: row.model_breakdown,
      startedAt: row.started_at,
      endedAt: row.ended_at || undefined,
      updatedAt: row.updated_at,
    };
  }
}

let defaultRepository: CostRecordRepository | null = null;

export function getCostRecordRepository(): CostRecordRepository {
  if (!defaultRepository) {
    defaultRepository = new CostRecordRepository();
  }
  return defaultRepository;
}
