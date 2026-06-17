// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * 供应商余额存储
 * 管理 provider_balances 表的读写，缓存余额查询结果。
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

const BALANCES_TABLE = 'provider_balances';

/** 余额记录 */
export interface BalanceRecord {
  providerId: string;
  remaining: number | null;
  total: number | null;
  used: number | null;
  unit: string;
  queriedAt: number;
  isSupported: boolean;
  belowThreshold: boolean;
}

/**
 * 供应商余额存储
 */
export class BalanceStore {
  private static instance: BalanceStore;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): BalanceStore {
    if (!BalanceStore.instance) {
      BalanceStore.instance = new BalanceStore(dbPath);
    }
    return BalanceStore.instance;
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
        const db = new Database(this.dbPath, (err: Error | null) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTables();
      this.initialized = true;
      logger.info('BalanceStore 初始化完成');
    } catch (error) {
      await handleError(error, { module: 'ai:balance', action: 'initialize' });
      throw new AppError(
        'Failed to initialize BalanceStore',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'BALANCE_STORE_INIT_FAILED',
        { cause: error }
      );
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        this.db!.run(sql, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

    await run(`
      CREATE TABLE IF NOT EXISTS ${BALANCES_TABLE} (
        provider_id TEXT PRIMARY KEY,
        remaining REAL,
        total REAL,
        used REAL,
        unit TEXT DEFAULT 'CNY',
        queried_at INTEGER NOT NULL,
        is_supported INTEGER NOT NULL DEFAULT 1,
        below_threshold INTEGER NOT NULL DEFAULT 0
      )
    `);

    logger.debug('BalanceStore: 表已就绪');
  }

  /** 确保数据库已初始化 */
  private ensureDb(): Database {
    if (!this.db) {
      throw new AppError(
        'BalanceStore 未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'BALANCE_STORE_NOT_INIT'
      );
    }
    return this.db;
  }

  /** 获取单个供应商余额 */
  async getBalance(providerId: string): Promise<BalanceRecord | undefined> {
    const db = this.ensureDb();

    return new Promise<BalanceRecord | undefined>((resolve, reject) => {
      db.get(
        `SELECT provider_id, remaining, total, used, unit, queried_at, is_supported, below_threshold
         FROM ${BALANCES_TABLE}
         WHERE provider_id = ?`,
        [providerId],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else if (row) {
            const r = row as Record<string, unknown>;
            resolve({
              providerId: r.provider_id as string,
              remaining: r.remaining as number | null,
              total: r.total as number | null,
              used: r.used as number | null,
              unit: (r.unit as string) || 'CNY',
              queriedAt: r.queried_at as number,
              isSupported: (r.is_supported as number) === 1,
              belowThreshold: (r.below_threshold as number) === 1,
            });
          } else {
            resolve(undefined);
          }
        }
      );
    });
  }

  /** 批量获取所有供应商余额 */
  async getAllBalances(): Promise<BalanceRecord[]> {
    const db = this.ensureDb();

    return new Promise<BalanceRecord[]>((resolve, reject) => {
      db.all(
        `SELECT provider_id, remaining, total, used, unit, queried_at, is_supported, below_threshold
         FROM ${BALANCES_TABLE}
         ORDER BY provider_id`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else {
            resolve(
              (rows as Record<string, unknown>[]).map((r) => ({
                providerId: r.provider_id as string,
                remaining: r.remaining as number | null,
                total: r.total as number | null,
                used: r.used as number | null,
                unit: (r.unit as string) || 'CNY',
                queriedAt: r.queried_at as number,
                isSupported: (r.is_supported as number) === 1,
                belowThreshold: (r.below_threshold as number) === 1,
              }))
            );
          }
        }
      );
    });
  }

  /** 写入/更新供应商余额 */
  async setBalance(
    providerId: string,
    data: {
      remaining: number | null;
      total: number | null;
      used: number | null;
      unit?: string;
      isSupported: boolean;
      belowThreshold: boolean;
    }
  ): Promise<void> {
    const db = this.ensureDb();
    const now = Math.floor(Date.now() / 1000);

    return new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO ${BALANCES_TABLE}
         (provider_id, remaining, total, used, unit, queried_at, is_supported, below_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          providerId,
          data.remaining,
          data.total,
          data.used,
          data.unit || 'CNY',
          now,
          data.isSupported ? 1 : 0,
          data.belowThreshold ? 1 : 0,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 删除供应商余额记录 */
  async deleteBalance(providerId: string): Promise<void> {
    const db = this.ensureDb();

    return new Promise<void>((resolve, reject) => {
      db.run(
        `DELETE FROM ${BALANCES_TABLE} WHERE provider_id = ?`,
        [providerId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
}
