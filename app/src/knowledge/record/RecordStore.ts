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
 * RecordStore — 业务对象记录存储（K2 字段级记录，租户级 DB）
 *
 * 职责：编译后经 RecordExtractor 抽取的结构化记录落库（租户级 DB），
 * 以 (record_type, record_key) 为主键做 upsert（主键=records.yaml 的 primaryKey 值）。
 * 写操作受 SimpleMutex 保护，防止并发 WAL 锁冲突（与 KnowledgeGraph 同模式）。
 *
 * **归属（2026-10-25，租户级 DB §6.1）**：编译产物属**用户级**数据 —— 库按**租户**分
 * （`tenants/<t>/app.db`），租户内按 `owner_key`（`<tenant>:<user>`）行级隔离，
 * 与 RuleStore / KnowledgeGraph 同口径。record_id 是内容派生（`{type}:{key}`）⇒
 * 新库用复合主键 `(record_id, owner_key)` + 复合唯一 `(record_type, record_key, owner_key)`，
 * 同租户两用户编译相同主键互不覆盖；旧库（ALTER 补列）保持单列结构，仅含 `local:local`
 * 行 ⇒ 无跨用户碰撞面。直接 `new RecordStore()`（编译写路径 / 检索读路径）在 init 时按
 * 当前请求身份解析库（`resolveTenantDbPath()`）；单例取用走 `getRecordStore()`。
 */

import { Database } from '@modules/external';
import { getLogger } from '@modules/monitoring';
import { resolveTenantDbPath } from '@modules/environment';
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { SimpleMutex } from '@openliri/kernel';

const logger = getLogger('knowledge:record:store');

/** 记录表名 */
export const RECORDS_TABLE = 'knowledge_records';

/** 单条业务记录（带元数据） */
export interface StoredRecord {
  /** 记录 ID：{record_type}:{record_key} */
  id: string;
  /** 记录类型（records.yaml 中的 type） */
  type: string;
  /** 主键值（record_key，用于精确检索/去重） */
  key: string;
  /** 结构化字段（schema 校验通过后写入） */
  data: Record<string, unknown>;
  /** 字段级证据：{fieldName: "原文引用"} */
  evidence: Record<string, string>;
  /** 所属域（默认 knowledge） */
  domain: string;
  /** 来源编译页面文件路径 */
  sourceFile: string;
  createdAt: number;
  updatedAt: number;
}

/** 写入入参（不含 id/时间戳） */
export interface UpsertRecordInput {
  type: string;
  key: string;
  data: Record<string, unknown>;
  evidence?: Record<string, string>;
  domain?: string;
  sourceFile?: string;
}

/** 记录查询过滤 */
export interface RecordQuery {
  type?: string;
  domain?: string;
  limit?: number;
}

export class RecordStore {
  private db: Database | null = null;
  private dbPath?: string;
  private dbMutex = new SimpleMutex();
  /** 进行中的初始化（并发调用共享，避免重复打开连接） */
  private initPromise: Promise<void> | null = null;
  /**
   * 唯一约束 `UNIQUE(record_type, record_key)` 是否含 `owner_key`。
   * 新库 ⇒ true（复合唯一 `(record_type, record_key, owner_key)`）；**旧库**（ALTER 补列，
   * 唯一约束仍是双列）⇒ false。决定 upsert 的 ON CONFLICT 目标 —— 目标必须**精确匹配**
   * 表上的某个 UNIQUE/PK，写错会 prepare 报 "ON CONFLICT clause does not match"。
   */
  private uniqueIncludesOwner = false;

  /**
   * @param dbPath 显式库路径（测试/工具注入）；缺省由 `init()` 惰性解析 ——
   *   2026-10-25 租户级 DB §6.1：默认参数会在**构造时**解析路径，模块级单例在无请求
   *   身份下构造会把库钉死共享 `app.db` ⇒ 改惰性解析（按当前请求身份解析租户库）。
   */
  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  /** 初始化数据库连接并建表（幂等 + 并发安全） */
  async init(): Promise<void> {
    if (this.db) {
      return;
    }
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
    const dbPath = this.dbPath ?? resolveTenantDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `CREATE TABLE IF NOT EXISTS ${RECORDS_TABLE} (
            record_id    TEXT NOT NULL,
            owner_key    TEXT NOT NULL DEFAULT 'local:local',
            record_type  TEXT NOT NULL,
            record_key   TEXT NOT NULL,
            data         TEXT NOT NULL,
            evidence     TEXT NOT NULL DEFAULT '{}',
            domain       TEXT NOT NULL DEFAULT 'knowledge',
            source_file  TEXT NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (record_id, owner_key),
            UNIQUE(record_type, record_key, owner_key)
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_records_type ON ${RECORDS_TABLE}(record_type)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_records_domain ON ${RECORDS_TABLE}(domain)`
            );
            // 归属列走索引（2026-10-25）：`search` / `count` 以 owner_key 起手过滤
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_records_owner ON ${RECORDS_TABLE}(owner_key, updated_at DESC)`
            );
            // 补 owner_key 列（2026-10-25，租户级 DB §6.1）：已建表的库没有该列。
            // SQLite 的 `ALTER TABLE` 不能改主键/唯一约束 ⇒ 旧库保持单列结构；旧库只可能是
            // 本地库（只含 `local:local` 行）⇒ 不会与租户行碰撞（存量行落默认值即本地身份）。
            // sqlite3 db.run 无回调时静默吞错 ⇒ 必须传回调判成败，`/duplicate column/i` 过滤。
            this!.db!.run(
              `ALTER TABLE ${RECORDS_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
              (alterErr: Error | null) => {
                if (alterErr && !/duplicate column/i.test(alterErr.message)) {
                  logger.warn('knowledge_records 补 owner_key 失败', {
                    error: alterErr.message,
                  });
                }
                // 探测唯一约束形态（决定 upsert 的 ON CONFLICT 目标）。
                // UNIQUE 约束由 SQLite 建成 `origin='u'` 的索引；查其列是否含 owner_key。
                this!.db!.all(
                  `PRAGMA index_list(${RECORDS_TABLE})`,
                  (
                    iErr: Error | null,
                    indexes:
                      | Array<{ name: string; unique: number; origin: string }>
                      | undefined
                  ) => {
                    if (iErr) {
                      resolve();
                      return;
                    }
                    const uniques = (indexes ?? []).filter(
                      (ix) => ix.unique === 1
                    );
                    if (uniques.length === 0) {
                      resolve();
                      return;
                    }
                    let checked = 0;
                    for (const ix of uniques) {
                      this!.db!.all(
                        `PRAGMA index_info(${JSON.stringify(ix.name)})`,
                        (
                          cErr: Error | null,
                          cols: Array<{ name: string }> | undefined
                        ) => {
                          checked++;
                          if (
                            !cErr &&
                            (cols ?? []).some((c) => c.name === 'owner_key')
                          ) {
                            this!.uniqueIncludesOwner = true;
                          }
                          if (checked === uniques.length) {
                            resolve();
                          }
                        }
                      );
                    }
                  }
                );
              }
            );
          }
        );
      });
    });

    logger.info('记录存储已初始化');
  }

  /** 当前身份归属键（本地 ⇒ `local:local`；租户 ⇒ `<tenant>:<user>`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /**
   * upsert 一条记录：(record_type, record_key) 冲突时整体更新
   */
  async upsert(input: UpsertRecordInput): Promise<StoredRecord> {
    await this.init();

    const now = Date.now();
    const id = `${input.type}:${input.key}`;
    const record: StoredRecord = {
      id,
      type: input.type,
      key: input.key,
      data: input.data,
      evidence: input.evidence ?? {},
      domain: input.domain ?? 'knowledge',
      sourceFile: input.sourceFile ?? '',
      createdAt: now,
      updatedAt: now,
    };

    // 复合唯一（新库）⇒ 冲突目标含 owner_key，两用户的同 (type,key) 是**不同行**；
    // 旧库（双列唯一）⇒ 冲突目标仅 (record_type, record_key)（旧库只有 local:local，
    // 天然不跨用户）。目标不带括号 —— 模板里 `ON CONFLICT(${target})` 负责加括号，
    // 否则叠成 `ON CONFLICT((a, b))` 被 SQLite prepare 拒绝（RuleStore 仓实测踩坑）。
    const conflictTarget = this.uniqueIncludesOwner
      ? 'record_type, record_key, owner_key'
      : 'record_type, record_key';

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${RECORDS_TABLE}
             (record_id, owner_key, record_type, record_key, data, evidence, domain, source_file, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(${conflictTarget}) DO UPDATE SET
             data = excluded.data,
             evidence = excluded.evidence,
             domain = excluded.domain,
             source_file = excluded.source_file,
             updated_at = excluded.updated_at`,
          [
            id,
            this.owner(),
            record.type,
            record.key,
            JSON.stringify(record.data),
            JSON.stringify(record.evidence),
            record.domain,
            record.sourceFile,
            record.createdAt,
            record.updatedAt,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    return record;
  }

  /**
   * 按关键字检索记录（record_key / 字段 JSON 全文模糊匹配）
   * @param q 检索关键字（如合同编号）
   */
  async search(q: string, filters: RecordQuery = {}): Promise<StoredRecord[]> {
    await this.init();

    const like = `%${q}%`;
    // 归属条件起手（2026-10-25）：租户内两用户的编译产物互不可见
    const params: unknown[] = [this.owner(), like, like];

    let sql = `SELECT * FROM ${RECORDS_TABLE}
      WHERE owner_key = ?
      AND (record_key LIKE ? OR data LIKE ?)`;

    if (filters.type) {
      sql += ' AND record_type = ?';
      params.push(filters.type);
    }
    if (filters.domain) {
      sql += ' AND domain = ?';
      params.push(filters.domain);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(filters.limit ?? 20);

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((rows as unknown[]).map((r) => this.rowToRecord(r)));
      });
    });
  }

  /** 按来源页面文件列出该页全部记录（K5 血缘：page → record 反查） */
  async listBySourceFile(sourceFile: string): Promise<StoredRecord[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${RECORDS_TABLE} WHERE source_file = ? AND owner_key = ? ORDER BY created_at`,
        [sourceFile, this.owner()],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve((rows as unknown[]).map((r) => this.rowToRecord(r)));
        }
      );
    });
  }

  /** 删除某来源文件对应的全部记录（重编译/文件删除时清理旧行；只删当前归属） */
  async deleteBySource(sourceFile: string): Promise<number> {
    await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT record_id FROM ${RECORDS_TABLE} WHERE source_file = ? AND owner_key = ?`,
          [sourceFile, this.owner()],
          (err: Error | null, rows: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            const ids = (rows as unknown[]).map(
              (r) => (r as { record_id: string }).record_id
            );
            affected = ids.length;
            if (ids.length === 0) {
              resolve();
              return;
            }
            const placeholders = ids.map(() => '?').join(',');
            this.db!.run(
              `DELETE FROM ${RECORDS_TABLE} WHERE record_id IN (${placeholders}) AND owner_key = ?`,
              [...ids, this.owner()],
              (delErr: Error | null) => {
                if (delErr) reject(delErr);
                else resolve();
              }
            );
          }
        );
      });
    });

    return affected;
  }

  /** 记录总数（按类型可细分；计数面=当前归属） */
  async count(type?: string): Promise<number> {
    await this.init();

    const sql = type
      ? `SELECT COUNT(*) AS n FROM ${RECORDS_TABLE} WHERE record_type = ? AND owner_key = ?`
      : `SELECT COUNT(*) AS n FROM ${RECORDS_TABLE} WHERE owner_key = ?`;
    const params = type ? [type, this.owner()] : [this.owner()];

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(Number((row as { n?: number } | undefined)?.n ?? 0));
      });
    });
  }

  /** 关闭数据库连接 */
  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err: Error | null) => {
        if (err) reject(err);
        else {
          this.db = null;
          this.initPromise = null;
          resolve();
        }
      });
    });
  }

  /** 行 → StoredRecord */
  private rowToRecord(row: unknown): StoredRecord {
    const r = row as {
      record_id?: string;
      record_type?: string;
      record_key?: string;
      data?: string;
      evidence?: string;
      domain?: string;
      source_file?: string;
      created_at?: number;
      updated_at?: number;
    };
    return {
      id: r.record_id ?? '',
      type: r.record_type ?? '',
      key: r.record_key ?? '',
      data: this.parseJsonObject(r.data),
      evidence: this.parseStringMap(r.evidence),
      domain: r.domain ?? 'knowledge',
      sourceFile: r.source_file ?? '',
      createdAt: r.created_at ?? 0,
      updatedAt: r.updated_at ?? 0,
    };
  }

  private parseJsonObject(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseStringMap(raw: string | undefined): Record<string, string> {
    const obj = this.parseJsonObject(raw);
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  }
}

/** 全局单例（本地身份；库由 `init()` 惰性解析） */
let instance: RecordStore | null = null;
/** 租户级实例缓存（键 = `tenantId`；同租户共用连接，按 `owner_key` 行级隔离） */
const scopedInstances = new Map<string, RecordStore>();
/** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入） */
const explicitInstances = new Map<string, RecordStore>();

/** 获取 RecordStore 单例（方法内部自 `await init()`，调用方无需预热） */
export function getRecordStore(dbPath?: string): RecordStore {
  // 2026-10-25：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例
  if (dbPath !== undefined) {
    const existing = explicitInstances.get(dbPath);
    if (existing) return existing;
    const created = new RecordStore(dbPath);
    explicitInstances.set(dbPath, created);
    return created;
  }
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const key = principal.tenantId;
    const existing = scopedInstances.get(key);
    if (existing) return existing;
    const scoped = new RecordStore(resolveTenantDbPath(principal));
    scopedInstances.set(key, scoped);
    // 删租户 / 退出时释放句柄并摘除缓存（否则 Windows 上 tenants/<t> 删不掉）
    registerScopedResource(principalKeyOf(principal), () => {
      void scoped.close();
      scopedInstances.delete(key);
    });
    return scoped;
  }
  if (!instance) {
    instance = new RecordStore(dbPath);
  }
  return instance;
}

/** 仅测试：关掉并清空租户级实例缓存（**生产不调用**） */
export function resetRecordStoreScopedForTest(): void {
  for (const store of scopedInstances.values()) {
    void store.close();
  }
  scopedInstances.clear();
}
