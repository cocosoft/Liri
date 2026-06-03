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
 * 模型使用量统计服务
 * 对标 CC 源码 cc-switch/src-tauri/src/services/usage_stats.rs 实现
 *
 * 负责：
 * - model_usage_logs 表的创建和维护
 * - 请求日志记录
 * - 多维度聚合统计（总览/每日趋势/模型/供应商）
 */

import { Database } from 'sqlite3';
import { randomUUID } from 'node:crypto';
import { resolveDbPath } from '@modules/config/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

const USAGE_LOGS_TABLE = 'model_usage_logs';

// ─── 数据类型 ───────────────────────────────────────────

/** 使用量汇总 */
export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  successRate: number;
}

/** 每日统计 */
export interface DailyStats {
  date: string;
  requestCount: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** 模型统计 */
export interface ModelStats {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
}

/** 供应商统计 */
export interface ProviderStats {
  providerId: string;
  providerName: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  avgLatencyMs: number;
}

/** 请求日志记录 */
export interface UsageLogRecord {
  /** 主键 */
  id: string;
  /** 模型名称 */
  model: string;
  /** 供应商ID */
  providerId?: string;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 缓存读取 token 数 */
  cacheReadTokens: number;
  /** 缓存写入 token 数 */
  cacheCreationTokens: number;
  /** 总成本 (USD) */
  costUSD: number;
  /** 延迟 (ms) */
  latencyMs: number;
  /** HTTP 状态码 */
  statusCode: number;
  /** 是否为流式请求 */
  isStreaming: boolean;
  /** 请求时间戳 (秒) */
  timestamp: number;
  /** 错误信息 */
  errorMessage?: string;
}

/** 创建日志记录的参数 */
export interface CreateUsageLogParams {
  model: string;
  providerId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUSD: number;
  latencyMs: number;
  statusCode?: number;
  isStreaming?: boolean;
  errorMessage?: string;
}

/** 查询过滤器 */
export interface UsageLogFilter {
  model?: string;
  providerId?: string;
  startDate?: number;
  endDate?: number;
  statusCode?: number;
  limit?: number;
  offset?: number;
}

/** 分页结果 */
export interface PaginatedLogs {
  data: UsageLogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 模型使用量统计服务
 */
export class UsageStatsService {
  private static instance: UsageStatsService;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): UsageStatsService {
    if (!UsageStatsService.instance) {
      UsageStatsService.instance = new UsageStatsService(dbPath);
    }
    return UsageStatsService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTables();
      this.initialized = true;
      logger.info('UsageStatsService 初始化完成');
    } catch (error) {
      logger.error('UsageStatsService 初始化失败', error);
      throw new AppError(
        'Failed to initialize UsageStatsService',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'USAGE_INIT_FAILED',
        { cause: error },
      );
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        this.db!.run(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

    await run(`
      CREATE TABLE IF NOT EXISTS ${USAGE_LOGS_TABLE} (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        provider_id TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER NOT NULL DEFAULT 200,
        is_streaming INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        error_message TEXT
      )
    `);

    await run(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_model
      ON ${USAGE_LOGS_TABLE}(model)
    `);

    await run(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp
      ON ${USAGE_LOGS_TABLE}(timestamp)
    `);

    await run(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_provider
      ON ${USAGE_LOGS_TABLE}(provider_id)
    `);

    logger.info('model_usage_logs 表创建/验证完成');
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new AppError(
        'UsageStatsService not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'USAGE_NOT_INIT',
      );
    }
  }

  private runAsync(sql: string, params?: unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db!.run(sql, params || [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private getAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.db!.get(sql, params || [], (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  private allAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params || [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  // ─── 日志记录 ────────────────────────────────────────

  /** 记录一条使用日志 */
  async logUsage(params: CreateUsageLogParams): Promise<UsageLogRecord> {
    this.ensureInitialized();

    const id = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    await this.runAsync(
      `INSERT INTO ${USAGE_LOGS_TABLE}
       (id, model, provider_id, input_tokens, output_tokens, cache_read_tokens,
        cache_creation_tokens, cost_usd, latency_ms, status_code, is_streaming,
        timestamp, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.model,
        params.providerId || null,
        params.inputTokens,
        params.outputTokens,
        params.cacheReadTokens || 0,
        params.cacheCreationTokens || 0,
        params.costUSD,
        params.latencyMs,
        params.statusCode || 200,
        params.isStreaming ? 1 : 0,
        timestamp,
        params.errorMessage || null,
      ],
    );

    return {
      id,
      model: params.model,
      providerId: params.providerId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cacheReadTokens: params.cacheReadTokens || 0,
      cacheCreationTokens: params.cacheCreationTokens || 0,
      costUSD: params.costUSD,
      latencyMs: params.latencyMs,
      statusCode: params.statusCode || 200,
      isStreaming: params.isStreaming || false,
      timestamp,
      errorMessage: params.errorMessage,
    };
  }

  // ─── 统计查询 ────────────────────────────────────────

  /** 获取使用量汇总 */
  async getUsageSummary(
    startDate?: number,
    endDate?: number,
    model?: string,
    providerId?: string,
  ): Promise<UsageSummary> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (startDate !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(startDate);
    }
    if (endDate !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(endDate);
    }
    if (model) {
      conditions.push('model = ?');
      values.push(model);
    }
    if (providerId) {
      conditions.push('provider_id = ?');
      values.push(providerId);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const row = await this.getAsync<{
      total_requests: number;
      total_cost: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_creation_tokens: number;
      success_count: number;
    }>(
      `SELECT
        COUNT(*) as total_requests,
        ROUND(SUM(cost_usd), 6) as total_cost,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cache_read_tokens) as total_cache_read_tokens,
        SUM(cache_creation_tokens) as total_cache_creation_tokens,
        SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as success_count
      FROM ${USAGE_LOGS_TABLE} ${where}`,
      values,
    );

    if (!row || row.total_requests === 0) {
      return {
        totalRequests: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        successRate: 100,
      };
    }

    return {
      totalRequests: row.total_requests,
      totalCost: row.total_cost,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      successRate:
        row.total_requests > 0
          ? Math.round((row.success_count / row.total_requests) * 1000) / 10
          : 100,
    };
  }

  /** 获取每日统计趋势 */
  async getDailyTrends(
    startDate?: number,
    endDate?: number,
    model?: string,
  ): Promise<DailyStats[]> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (startDate !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(startDate);
    }
    if (endDate !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(endDate);
    }
    if (model) {
      conditions.push('model = ?');
      values.push(model);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = await this.allAsync<{
      date: string;
      request_count: number;
      total_cost: number;
      total_tokens: number;
      total_input_tokens: number;
      total_output_tokens: number;
    }>(
      `SELECT
        date(timestamp, 'unixepoch') as date,
        COUNT(*) as request_count,
        ROUND(SUM(cost_usd), 6) as total_cost,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) as total_tokens,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens
      FROM ${USAGE_LOGS_TABLE} ${where}
      GROUP BY date
      ORDER BY date ASC`,
      values,
    );

    return rows.map((r) => ({
      date: r.date,
      requestCount: r.request_count,
      totalCost: r.total_cost,
      totalTokens: r.total_tokens,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
    }));
  }

  /** 获取按模型统计 */
  async getModelStats(
    startDate?: number,
    endDate?: number,
  ): Promise<ModelStats[]> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (startDate !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(startDate);
    }
    if (endDate !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(endDate);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = await this.allAsync<{
      model: string;
      request_count: number;
      total_tokens: number;
      total_cost: number;
      avg_latency_ms: number;
    }>(
      `SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) as total_tokens,
        ROUND(SUM(cost_usd), 6) as total_cost,
        ROUND(AVG(latency_ms)) as avg_latency_ms
      FROM ${USAGE_LOGS_TABLE} ${where}
      GROUP BY model
      ORDER BY request_count DESC`,
      values,
    );

    return rows.map((r) => ({
      model: r.model,
      requestCount: r.request_count,
      totalTokens: r.total_tokens,
      totalCost: r.total_cost,
      avgLatencyMs: r.avg_latency_ms,
    }));
  }

  /** 获取按供应商统计 */
  async getProviderStats(
    startDate?: number,
    endDate?: number,
  ): Promise<ProviderStats[]> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (startDate !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(startDate);
    }
    if (endDate !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(endDate);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = await this.allAsync<{
      provider_id: string;
      request_count: number;
      total_tokens: number;
      total_cost: number;
      success_rate: number;
      avg_latency_ms: number;
    }>(
      `SELECT
        COALESCE(provider_id, 'unknown') as provider_id,
        COUNT(*) as request_count,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) as total_tokens,
        ROUND(SUM(cost_usd), 6) as total_cost,
        ROUND(100.0 * SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate,
        ROUND(AVG(latency_ms)) as avg_latency_ms
      FROM ${USAGE_LOGS_TABLE} ${where}
      GROUP BY provider_id
      ORDER BY request_count DESC`,
      values,
    );

    return rows.map((r) => ({
      providerId: r.provider_id,
      providerName: r.provider_id,
      requestCount: r.request_count,
      totalTokens: r.total_tokens,
      totalCost: r.total_cost,
      successRate: r.success_rate,
      avgLatencyMs: r.avg_latency_ms,
    }));
  }

  /** 获取请求日志（分页） */
  async getRequestLogs(
    filter: UsageLogFilter,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedLogs> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.model) {
      conditions.push('model = ?');
      values.push(filter.model);
    }
    if (filter.providerId) {
      conditions.push('provider_id = ?');
      values.push(filter.providerId);
    }
    if (filter.startDate !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(filter.startDate);
    }
    if (filter.endDate !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(filter.endDate);
    }
    if (filter.statusCode !== undefined) {
      conditions.push('status_code = ?');
      values.push(filter.statusCode);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const countRow = await this.getAsync<{ total: number }>(
      `SELECT COUNT(*) as total FROM ${USAGE_LOGS_TABLE} ${where}`,
      values,
    );
    const total = countRow?.total || 0;

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const offset = (safePage - 1) * safePageSize;

    const rows = await this.allAsync<{
      id: string;
      model: string;
      provider_id: string | null;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      cost_usd: number;
      latency_ms: number;
      status_code: number;
      is_streaming: number;
      timestamp: number;
      error_message: string | null;
    }>(
      `SELECT * FROM ${USAGE_LOGS_TABLE} ${where}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [...values, safePageSize, offset],
    );

    return {
      data: rows.map((r) => ({
        id: r.id,
        model: r.model,
        providerId: r.provider_id || undefined,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        costUSD: r.cost_usd,
        latencyMs: r.latency_ms,
        statusCode: r.status_code,
        isStreaming: r.is_streaming === 1,
        timestamp: r.timestamp,
        errorMessage: r.error_message || undefined,
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  /** 获取请求总数（用于监控） */
  async getTotalLogCount(): Promise<number> {
    this.ensureInitialized();

    const row = await this.getAsync<{ total: number }>(
      `SELECT COUNT(*) as total FROM ${USAGE_LOGS_TABLE}`,
    );
    return row?.total || 0;
  }
}

export const usageStatsService = UsageStatsService.getInstance();
