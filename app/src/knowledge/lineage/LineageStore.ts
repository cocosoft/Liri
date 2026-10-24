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
 * LineageStore — 知识血缘存储（K5，kg_lineage 表，租户级 DB）
 *
 * 记录 doc（源文档/页面）→ 产物的派生关系，支持按 doc 反查产物、按产物反查 doc。
 * 产物类型 artifact_type：page（编译 wiki 页）/ record（记录行）/ rule（规则行）/ node（图谱节点）。
 * 每次编译绑定递增版本号 version；同 (doc, type, id) 幂等写入（INSERT OR IGNORE）。
 *
 * **归属（2026-10-25，租户级 DB §6.1）**：血缘属**用户级**数据 —— 库按**租户**分
 * （`tenants/<t>/app.db`），租户内按 `owner_key`（`<tenant>:<user>`）行级隔离，
 * 与 RuleStore / RecordStore / KnowledgeGraph 同口径。唯一键是内容派生
 * （doc + artifact_type + artifact_id）⇒ 新库复合唯一
 * `(doc_path, artifact_type, artifact_id, owner_key)`，同租户两用户编译相同产物
 * 互不 IGNORE 覆盖；旧库（ALTER 补列）保持原三列唯一，仅含 `local:local` 行 ⇒
 * 无跨用户碰撞面。直接 `new LineageStore()`（编译写路径）在 init 时按当前请求
 * 身份解析库（`resolveTenantDbPath()`）；请求作用域读路径走 `getLineageStore()`。
 */

import { Database } from '@openliri/kernel/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveTenantDbPath } from '@openliri/kernel/paths';
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { SimpleMutex } from '@openliri/kernel';

const logger = getLogger('knowledge:lineage:store');

/** kg_lineage 表名 */
export const KG_LINEAGE_TABLE = 'kg_lineage';

/** 产物类型 */
export type LineageArtifactType = 'page' | 'record' | 'rule' | 'node';

/** 血缘条目 */
export interface LineageLink {
  /** 源文档（raw 路径或编译页路径） */
  docPath: string;
  /** 产物类型 */
  artifactType: LineageArtifactType;
  /** 产物 ID（页面路径 / record.id / rule.id / nodeId） */
  artifactId: string;
  /** 所属域 */
  domain: string;
  /** 编译版本（K5.3） */
  version: number;
  createdAt: number;
}

/** 血缘过滤 */
export interface LineageQuery {
  docPath?: string;
  artifactType?: LineageArtifactType;
  artifactId?: string;
  domain?: string;
  version?: number;
}

export class LineageStore {
  private db: Database | null = null;
  private dbPath?: string;
  private dbMutex = new SimpleMutex();
  /** 进行中的初始化（并发调用共享，避免重复打开连接） */
  private initPromise: Promise<void> | null = null;

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
          `CREATE TABLE IF NOT EXISTS ${KG_LINEAGE_TABLE} (
            doc_path     TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            artifact_id  TEXT NOT NULL,
            domain       TEXT NOT NULL DEFAULT 'knowledge',
            version      INTEGER NOT NULL,
            created_at   INTEGER NOT NULL,
            owner_key    TEXT NOT NULL DEFAULT 'local:local',
            UNIQUE(doc_path, artifact_type, artifact_id, owner_key)
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_lineage_doc ON ${KG_LINEAGE_TABLE}(doc_path)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_lineage_artifact ON ${KG_LINEAGE_TABLE}(artifact_type, artifact_id)`
            );
            // 补 owner_key 列（2026-10-25，租户级 DB §6.1）：已建表的库没有该列。
            // SQLite 的 `ALTER TABLE` 不能改唯一约束 ⇒ 旧库保持原三列唯一；旧库只可能是
            // 本地库（只含 `local:local` 行）⇒ 不会与租户行碰撞（存量行落默认值即本地身份）。
            // sqlite3 db.run 无回调时静默吞错 ⇒ 必须传回调判成败，`/duplicate column/i` 过滤。
            this!.db!.run(
              `ALTER TABLE ${KG_LINEAGE_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
              (alterErr: Error | null) => {
                if (alterErr && !/duplicate column/i.test(alterErr.message)) {
                  logger.warn('kg_lineage 补 owner_key 失败', {
                    error: alterErr.message,
                  });
                }
                resolve();
              }
            );
          }
        );
      });
    });

    logger.info('血缘存储已初始化');
  }

  /** 当前身份归属键（本地 ⇒ `local:local`；租户 ⇒ `<tenant>:<user>`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /** 幂等写入多条血缘（同 doc/type/id/owner 忽略），返回实际新增数 */
  async addLinks(
    docPath: string,
    artifacts: Array<{ artifactType: LineageArtifactType; artifactId: string }>,
    version: number,
    domain: string = 'knowledge'
  ): Promise<number> {
    await this.init();
    if (artifacts.length === 0) return 0;

    let added = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        const sql = `INSERT OR IGNORE INTO ${KG_LINEAGE_TABLE}
            (doc_path, artifact_type, artifact_id, domain, version, created_at, owner_key)
          VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const now = Date.now();
        const owner = this.owner();
        let remaining = artifacts.length;
        let firstError: Error | null = null;

        const runNext = (): void => {
          if (remaining <= 0) {
            if (firstError) reject(firstError);
            else resolve();
            return;
          }
          remaining--;
          const a = artifacts[artifacts.length - 1 - remaining];
          this.db!.run(
            sql,
            [
              docPath,
              a.artifactType,
              a.artifactId,
              domain,
              version,
              now,
              owner,
            ],
            (err: Error | null) => {
              if (err) {
                if (!firstError) firstError = err;
                runNext();
                return;
              }
              // 调用方（runner）在 addLinks 前已 purgeByDoc，重复行仅剩同批去重
              added++;
              runNext();
            }
          );
        };
        runNext();
      });
    });

    return added;
  }

  /** 删除某 doc 的全部血缘（重编译前清理，防残留；只删当前归属） */
  async purgeByDoc(docPath: string): Promise<number> {
    await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT rowid FROM ${KG_LINEAGE_TABLE} WHERE doc_path = ? AND owner_key = ?`,
          [docPath, this.owner()],
          (err: Error | null, rows: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            affected = (rows as unknown[]).length;
            this.db!.run(
              `DELETE FROM ${KG_LINEAGE_TABLE} WHERE doc_path = ? AND owner_key = ?`,
              [docPath, this.owner()],
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

  /** 按过滤条件查询血缘（归属条件起手：租户内两用户的编译产物互不可见） */
  async query(filters: LineageQuery = {}): Promise<LineageLink[]> {
    await this.init();

    // 归属条件字面写进模板（门禁扫描处）；其余条件动态拼接
    let sql = `SELECT * FROM ${KG_LINEAGE_TABLE}
      WHERE owner_key = ?`;
    const params: unknown[] = [this.owner()];
    if (filters.docPath) {
      sql += ' AND doc_path = ?';
      params.push(filters.docPath);
    }
    if (filters.artifactType) {
      sql += ' AND artifact_type = ?';
      params.push(filters.artifactType);
    }
    if (filters.artifactId) {
      sql += ' AND artifact_id = ?';
      params.push(filters.artifactId);
    }
    if (filters.domain) {
      sql += ' AND domain = ?';
      params.push(filters.domain);
    }
    if (filters.version !== undefined) {
      sql += ' AND version = ?';
      params.push(filters.version);
    }

    sql += ' ORDER BY created_at';

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((rows as unknown[]).map((r) => this.rowToLink(r)));
      });
    });
  }

  /** 反查：产物 → 其源 doc */
  async findDocsByArtifact(
    artifactType: LineageArtifactType,
    artifactId: string
  ): Promise<LineageLink[]> {
    return this.query({ artifactType, artifactId });
  }

  /** 反查：doc → 全部产物 */
  async findArtifactsByDoc(docPath: string): Promise<LineageLink[]> {
    return this.query({ docPath });
  }

  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err: Error | null) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });
  }

  private rowToLink(row: unknown): LineageLink {
    const r = row as {
      doc_path?: string;
      artifact_type?: string;
      artifact_id?: string;
      domain?: string;
      version?: number;
      created_at?: number;
    };
    return {
      docPath: r.doc_path ?? '',
      artifactType: (r.artifact_type ?? 'page') as LineageArtifactType,
      artifactId: r.artifact_id ?? '',
      domain: r.domain ?? 'knowledge',
      version: r.version ?? 0,
      createdAt: r.created_at ?? 0,
    };
  }
}

/** 全局单例（本地身份；库由 `init()` 惰性解析） */
let instance: LineageStore | null = null;
/** 租户级实例缓存（键 = `tenantId`；同租户共用连接，按 `owner_key` 行级隔离） */
const scopedInstances = new Map<string, LineageStore>();
/** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入） */
const explicitInstances = new Map<string, LineageStore>();

/** 获取 LineageStore 单例（方法内部自 `await init()`，调用方无需预热） */
export function getLineageStore(dbPath?: string): LineageStore {
  // 2026-10-25：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例
  if (dbPath !== undefined) {
    const existing = explicitInstances.get(dbPath);
    if (existing) return existing;
    const created = new LineageStore(dbPath);
    explicitInstances.set(dbPath, created);
    return created;
  }
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const key = principal.tenantId;
    const existing = scopedInstances.get(key);
    if (existing) return existing;
    const scoped = new LineageStore(resolveTenantDbPath(principal));
    scopedInstances.set(key, scoped);
    // 删租户 / 退出时释放句柄并摘除缓存（否则 Windows 上 tenants/<t> 删不掉）
    registerScopedResource(principalKeyOf(principal), () => {
      void scoped.close();
      scopedInstances.delete(key);
    });
    return scoped;
  }
  if (!instance) {
    instance = new LineageStore(dbPath);
  }
  return instance;
}

/** 仅测试：关掉并清空租户级实例缓存（**生产不调用**） */
export function resetLineageStoreScopedForTest(): void {
  for (const store of scopedInstances.values()) {
    void store.close();
  }
  scopedInstances.clear();
}
