/**
 * 查询日志存储
 * 基于 SQLite 的查询日志持久化，记录每次 API 调用、工具调用和完整查询的执行信息
 */

import { Database } from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type {
  QueryLogEntry,
  QueryLogFilter,
  QueryLogStats,
} from './QueryLogTypes';

const logger = new Logger('QueryLogStore');

const QUERY_LOG_TABLE = 'query_logs';

/**
 * 查询日志存储
 */
export class QueryLogStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './backend/data/query_logs.db') {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库连接和表结构
   */
  async init(): Promise<void> {
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
    logger.info('查询日志存储初始化完成', { dbPath: this.dbPath });
  }

  /**
   * 创建表结构和索引
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'QLS_001'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `CREATE TABLE IF NOT EXISTS ${QUERY_LOG_TABLE} (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          model TEXT,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          success INTEGER NOT NULL DEFAULT 1,
          error TEXT,
          tool_name TEXT,
          retry_count INTEGER,
          turn_count INTEGER,
          tool_call_count INTEGER,
          timestamp INTEGER NOT NULL,
          metadata TEXT
        )`,
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
        `CREATE INDEX IF NOT EXISTS idx_query_logs_session_id
         ON ${QUERY_LOG_TABLE}(session_id)`,
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
        `CREATE INDEX IF NOT EXISTS idx_query_logs_type
         ON ${QUERY_LOG_TABLE}(type)`,
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
        `CREATE INDEX IF NOT EXISTS idx_query_logs_timestamp
         ON ${QUERY_LOG_TABLE}(timestamp)`,
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

  /**
   * 记录一条日志
   */
  async log(entry: Omit<QueryLogEntry, 'id'>): Promise<string> {
    await this.init();
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'QLS_002'
      );
    }

    const id = uuidv4();
    const metadataStr = entry.metadata ? JSON.stringify(entry.metadata) : null;

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO ${QUERY_LOG_TABLE}
        (id, session_id, type, model, prompt_tokens, output_tokens, total_tokens,
         duration_ms, success, error, tool_name, retry_count, turn_count,
         tool_call_count, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          entry.sessionId,
          entry.type,
          entry.model || null,
          entry.promptTokens,
          entry.outputTokens,
          entry.totalTokens,
          entry.durationMs,
          entry.success ? 1 : 0,
          entry.error || null,
          entry.toolName || null,
          entry.retryCount ?? null,
          entry.turnCount ?? null,
          entry.toolCallCount ?? null,
          entry.timestamp,
          metadataStr,
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

    logger.debug('查询日志已记录', {
      id,
      type: entry.type,
      sessionId: entry.sessionId,
    });
    return id;
  }

  /**
   * 查询日志，支持按条件过滤
   */
  async query(filter: QueryLogFilter = {}): Promise<QueryLogEntry[]> {
    await this.init();
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'QLS_003'
      );
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }
    if (filter.successOnly !== undefined) {
      conditions.push('success = ?');
      params.push(filter.successOnly ? 1 : 0);
    }
    if (filter.model) {
      conditions.push('model = ?');
      params.push(filter.model);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM ${QUERY_LOG_TABLE} ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });

    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * 获取指定会话的日志
   */
  async getBySession(
    sessionId: string,
    limit: number = 50
  ): Promise<QueryLogEntry[]> {
    return this.query({ sessionId, limit });
  }

  /**
   * 获取时间范围内的日志统计
   */
  async getStats(startTime?: number, endTime?: number): Promise<QueryLogStats> {
    await this.init();
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'QLS_004'
      );
    }

    const now = Date.now();
    const actualStart = startTime ?? 0;
    const actualEnd = endTime ?? now;

    const stats = await new Promise<any>((resolve, reject) => {
      this.db?.get(
        `SELECT
          COUNT(*) FILTER (WHERE type = 'api_call') AS total_api_calls,
          COALESCE(SUM(duration_ms) FILTER (WHERE type = 'api_call'), 0) AS total_api_duration_ms,
          COALESCE(SUM(total_tokens) FILTER (WHERE type = 'api_call'), 0) AS total_tokens,
          COALESCE(SUM(CASE WHEN type = 'api_call' AND success = 0 THEN 1 ELSE 0 END), 0) AS api_error_count,
          COUNT(*) FILTER (WHERE type = 'tool_call') AS total_tool_calls,
          COALESCE(SUM(CASE WHEN type = 'tool_call' AND success = 0 THEN 1 ELSE 0 END), 0) AS tool_error_count,
          COUNT(*) FILTER (WHERE type = 'query') AS total_queries
        FROM ${QUERY_LOG_TABLE}
        WHERE timestamp >= ? AND timestamp <= ?`,
        [actualStart, actualEnd],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    const totalApiCalls = stats.total_api_calls || 0;
    const apiErrorCount = stats.api_error_count || 0;
    const totalToolCalls = stats.total_tool_calls || 0;
    const toolErrorCount = stats.tool_error_count || 0;

    return {
      totalApiCalls,
      totalApiDurationMs: stats.total_api_duration_ms || 0,
      totalTokens: stats.total_tokens || 0,
      avgApiDurationMs:
        totalApiCalls > 0
          ? Math.round((stats.total_api_duration_ms || 0) / totalApiCalls)
          : 0,
      apiErrorCount,
      apiSuccessRate:
        totalApiCalls > 0 ? (totalApiCalls - apiErrorCount) / totalApiCalls : 1,
      totalToolCalls,
      toolErrorCount,
      toolSuccessRate:
        totalToolCalls > 0
          ? (totalToolCalls - toolErrorCount) / totalToolCalls
          : 1,
      totalQueries: stats.total_queries || 0,
      startTime: actualStart,
      endTime: actualEnd,
    };
  }

  /**
   * 清理指定时间之前的日志
   */
  async prune(beforeTimestamp: number): Promise<number> {
    await this.init();
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'QLS_005'
      );
    }

    const result = await new Promise<any>((resolve, reject) => {
      this.db?.run(
        `DELETE FROM ${QUERY_LOG_TABLE} WHERE timestamp < ?`,
        [beforeTimestamp],
        function (this: any, err) {
          if (err) {
            reject(err);
          } else {
            resolve(this);
          }
        }
      );
    });

    const deletedCount = result?.changes || 0;
    if (deletedCount > 0) {
      logger.info('查询日志清理完成', { deletedCount, beforeTimestamp });
    }
    return deletedCount;
  }

  /**
   * 关闭数据库连接
   */
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

  /**
   * 数据库行记录转 QueryLogEntry
   */
  private rowToEntry(row: any): QueryLogEntry {
    const entry: QueryLogEntry = {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      model: row.model || undefined,
      promptTokens: row.prompt_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      durationMs: row.duration_ms,
      success: row.success === 1,
      error: row.error || undefined,
      toolName: row.tool_name || undefined,
      retryCount: row.retry_count ?? undefined,
      turnCount: row.turn_count ?? undefined,
      toolCallCount: row.tool_call_count ?? undefined,
      timestamp: row.timestamp,
    };

    if (row.metadata) {
      try {
        entry.metadata = JSON.parse(row.metadata);
      } catch {
        entry.metadata = { raw: row.metadata };
      }
    }

    return entry;
  }
}

/**
 * 全局单例
 */
let globalQueryLogStore: QueryLogStore | null = null;

/**
 * 获取全局查询日志存储实例
 */
export function getQueryLogStore(): QueryLogStore {
  if (!globalQueryLogStore) {
    globalQueryLogStore = new QueryLogStore();
  }
  return globalQueryLogStore;
}

/**
 * 重置全局实例（主要用于测试）
 */
export function resetQueryLogStore(): void {
  globalQueryLogStore = null;
}
