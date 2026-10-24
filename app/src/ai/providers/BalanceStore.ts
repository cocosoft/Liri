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

import { Database } from '@openliri/kernel/external/sqlite3';
import { resolveDbPath, resolveTenantDbPath } from '@openliri/kernel';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('ai:providers:balanceStore');

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
  /** 租户级库实例缓存（键 = `tenantId`；库按租户分，用户靠 `owner_key` 行级隔离） */
  private static scopedInstances = new Map<string, BalanceStore>();

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入，如 `':memory:'`） */
  private static explicitInstances = new Map<string, BalanceStore>();

  /**
   * 取余额存储实例。
   *
   * 租户级 DB（基础设施专项 §6.1 期 3）：本地身份 ⇒ 原单例（零变更）；已认证身份 ⇒
   * 该**租户**的实例（`tenants/<t>/app.db`），同租户内不同用户共用连接、按 `owner_key`
   * 行级隔离。**不做"共享实例换连接"**——单字段连接在 `await` 交错点会串库。
   */
  static getInstance(dbPath?: string): BalanceStore {
    // 2026-10-24：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例 ——
    // 原"首次创建后忽略入参"会让 `:memory:` 在默认单例已存在时拿到真实 `app.db`。
    if (dbPath !== undefined) {
      const existing = BalanceStore.explicitInstances.get(dbPath);
      if (existing) return existing;
      const created = new BalanceStore(dbPath);
      BalanceStore.explicitInstances.set(dbPath, created);
      return created;
    }
    const principal = getRequestPrincipal();
    if (!isLocalPrincipal(principal)) {
      const key = principal.tenantId;
      const existing = BalanceStore.scopedInstances.get(key);
      if (existing) return existing;
      const scoped = new BalanceStore(resolveTenantDbPath(principal));
      BalanceStore.scopedInstances.set(key, scoped);
      // 多租户 P5：登记 closer（关连接 + 摘除本类缓存），删租户时统一释放文件句柄。
      // 登记键用**创建者**的 `<tenant>:<user>`（purge 按 `<tenant>:` 前缀关闭）。
      registerScopedResource(principalKeyOf(principal), () => {
        scoped.close();
        BalanceStore.scopedInstances.delete(key);
      });
      return scoped;
    }
    if (!BalanceStore.instance) {
      BalanceStore.instance = new BalanceStore(dbPath);
    }
    return BalanceStore.instance;
  }

  /**
   * 关闭库连接（幂等）。
   *
   * 多租户 P5：删租户前由 `core/identity/scopedResources` 的登记器调用释放文件句柄；
   * **不**清理 `scopedInstances`（由调用方 closer 负责摘除缓存）。
   */
  close(): void {
    try {
      this.db?.close();
    } catch {
      // 已关闭 / 关闭中：忽略（幂等）
    }
    this.db = null;
    this.initialized = false;
    this.initPromise = null;
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
        provider_id TEXT NOT NULL,
        remaining REAL,
        total REAL,
        used REAL,
        unit TEXT DEFAULT 'CNY',
        queried_at INTEGER NOT NULL,
        is_supported INTEGER NOT NULL DEFAULT 1,
        below_threshold INTEGER NOT NULL DEFAULT 0,
        owner_key TEXT NOT NULL DEFAULT 'local:local',
        PRIMARY KEY (provider_id, owner_key)
      )
    `);

    // 旧库（单身份）补列：`ALTER` 不能改主键，但本地全 `local:local` ⇒ 不碰撞
    const columns = await new Promise<Array<{ name: string }>>(
      (resolve, reject) => {
        this.db!.all(
          `PRAGMA table_info(${BALANCES_TABLE})`,
          [],
          (err: Error | null, rows) =>
            err ? reject(err) : resolve((rows || []) as Array<{ name: string }>)
        );
      }
    );
    if (!columns.some((c) => c.name === 'owner_key')) {
      await run(
        `ALTER TABLE ${BALANCES_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`
      );
    }

    logger.debug('BalanceStore: 表已就绪');
  }

  /** 当前写入/查询的归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
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
         WHERE provider_id = ? AND owner_key = ?`,
        [providerId, this.owner()],
        (err: Error | null, row: unknown) => {
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
         WHERE owner_key = ?
         ORDER BY provider_id`,
        [this.owner()],
        (err: Error | null, rows: unknown[]) => {
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
         (provider_id, remaining, total, used, unit, queried_at, is_supported, below_threshold, owner_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          providerId,
          data.remaining,
          data.total,
          data.used,
          data.unit || 'CNY',
          now,
          data.isSupported ? 1 : 0,
          data.belowThreshold ? 1 : 0,
          this.owner(),
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
        `DELETE FROM ${BALANCES_TABLE} WHERE provider_id = ? AND owner_key = ?`,
        [providerId, this.owner()],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
}
