// MIT License
// Copyright (c) 2026 Liri
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
 * AppMigrationStore —— 迁移**版本中枢**（P2-9）
 *
 * 唯一职责：持久化"每条迁移的状态"（`applied | failed | reverted`）—— 使 `runAll()` 的
 * **幂等**有单一判定源（已 `applied` ⇒ 跳过），并让"本安装处于哪个版本、哪些迁移跑过"可被回答。
 *
 * 表 `app_migrations` 落**唯一** `app.db`（`project_rules` §1.5；**仅新增**表，§1.1）。
 * **单向状态机**（对齐仓内 I4 手法）：`applied` 为终态、不可改写；`failed → applied | reverted` 允许。
 *
 * store 模式对齐 `YieldWaitingStore` / `SettlementOutbox`（`initPromise` 失败须清空、回调式 sqlite）。
 */
import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '../paths';

const logger = getLogger('core:migration:store');

export const APP_MIGRATIONS_TABLE = 'app_migrations';

export type AppMigrationStatus = 'applied' | 'failed' | 'reverted';

export interface AppMigrationRow {
  id: string;
  module: string;
  fromVersion?: string;
  toVersion: string;
  status: AppMigrationStatus;
  appliedAt?: number;
  lastError?: string;
  /** 该次执行的快照目录（无快照 ⇒ undefined） */
  snapshotPath?: string;
  updatedAt: number;
}

/** 写入入参（`updatedAt` 由 store 补） */
export interface AppMigrationWrite {
  id: string;
  module: string;
  fromVersion?: string;
  toVersion: string;
  status: AppMigrationStatus;
  appliedAt?: number;
  lastError?: string;
  snapshotPath?: string;
}

/**
 * 单向状态机：`applied` 为**终态**（禁止改写）；`failed` / `reverted` 可再写
 * （分别对应"重试"与"再次恢复"）。
 */
export function canTransitionMigration(
  from: AppMigrationStatus | null,
  to: AppMigrationStatus
): boolean {
  if (from === null) return true;
  if (from === 'applied') return false;
  return true;
}

function toRow(raw: Record<string, unknown>): AppMigrationRow {
  return {
    id: String(raw['id']),
    module: String(raw['module']),
    fromVersion:
      raw['from_version'] === null || raw['from_version'] === undefined
        ? undefined
        : String(raw['from_version']),
    toVersion: String(raw['to_version']),
    status: String(raw['status']) as AppMigrationStatus,
    appliedAt:
      raw['applied_at'] === null || raw['applied_at'] === undefined
        ? undefined
        : Number(raw['applied_at']),
    lastError:
      raw['last_error'] === null || raw['last_error'] === undefined
        ? undefined
        : String(raw['last_error']),
    snapshotPath:
      raw['snapshot_path'] === null || raw['snapshot_path'] === undefined
        ? undefined
        : String(raw['snapshot_path']),
    updatedAt: Number(raw['updated_at'] ?? 0),
  };
}

export class AppMigrationStore {
  private db: Database | null = null;
  private readonly dbPath?: string;
  private initPromise: Promise<void> | null = null;

  /** @param dbPath 显式库路径（测试用）；缺省 `resolveDbPath()` */
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
      // 与 YieldWaitingStore 同法：失败必须清空，否则一次瞬时故障永久失效
      this.initPromise = null;
      throw err;
    }
  }

  private async doInit(): Promise<void> {
    const dbPath = this.dbPath ?? resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${APP_MIGRATIONS_TABLE} (
        id            TEXT PRIMARY KEY,
        module        TEXT NOT NULL,
        from_version  TEXT,
        to_version    TEXT NOT NULL,
        status        TEXT NOT NULL,
        applied_at    INTEGER,
        last_error    TEXT,
        snapshot_path TEXT,
        updated_at    INTEGER NOT NULL
      )`
    );
  }

  /** 全部行（`runAll` 幂等判据 / `status()` 取数） */
  async listAll(): Promise<AppMigrationRow[]> {
    await this.init();
    const rows = await this.all<Record<string, unknown>>(
      `SELECT * FROM ${APP_MIGRATIONS_TABLE} ORDER BY id ASC`
    );
    return rows.map(toRow);
  }

  async get(id: string): Promise<AppMigrationRow | null> {
    await this.init();
    const rows = await this.all<Record<string, unknown>>(
      `SELECT * FROM ${APP_MIGRATIONS_TABLE} WHERE id = ?`,
      [id]
    );
    return rows.length > 0 ? toRow(rows[0]) : null;
  }

  /**
   * 写入一条状态（upsert + **单向状态机守卫**）。
   *
   * @returns `false` ⇒ 该 id 已是 `applied` 终态、**拒绝改写**（幂等语义由此保证）
   */
  async upsert(write: AppMigrationWrite): Promise<boolean> {
    await this.init();
    const existing = await this.get(write.id);
    if (!canTransitionMigration(existing?.status ?? null, write.status)) {
      logger.debug('迁移状态未迁移（已终态）', {
        id: write.id,
        status: write.status,
      });
      return false;
    }
    await this.run(
      `INSERT INTO ${APP_MIGRATIONS_TABLE}
         (id, module, from_version, to_version, status, applied_at, last_error, snapshot_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         applied_at = COALESCE(excluded.applied_at, ${APP_MIGRATIONS_TABLE}.applied_at),
         last_error = excluded.last_error,
         snapshot_path = COALESCE(excluded.snapshot_path, ${APP_MIGRATIONS_TABLE}.snapshot_path),
         updated_at = excluded.updated_at`,
      [
        write.id,
        write.module,
        write.fromVersion ?? null,
        write.toVersion,
        write.status,
        write.appliedAt ?? null,
        write.lastError ?? null,
        write.snapshotPath ?? null,
        Date.now(),
      ]
    );
    return true;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  // ==================== 内部：sqlite 封装（同 YieldWaitingStore） ====================

  private run(sql: string, params: unknown[] = []): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<number>((resolve, reject) => {
      this.db!.run(
        sql,
        params,
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: T[] | undefined) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }
}

let instance: AppMigrationStore | null = null;

/** 全局单例（惰性：首次使用才解析 DB 路径并建表） */
export function getAppMigrationStore(): AppMigrationStore {
  if (!instance) {
    instance = new AppMigrationStore();
  }
  return instance;
}

/** 清空单例（**仅测试用**：避免临时库路径被缓存） */
export function resetAppMigrationStore(): void {
  instance?.close();
  instance = null;
}
