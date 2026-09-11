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
 * LineageStore — 知识血缘存储（K5，kg_lineage 表，统一 app.db）
 *
 * 记录 doc（源文档/页面）→ 产物的派生关系，支持按 doc 反查产物、按产物反查 doc。
 * 产物类型 artifact_type：page（编译 wiki 页）/ record（记录行）/ rule（规则行）/ node（图谱节点）。
 * 每次编译绑定递增版本号 version；同 (doc, type, id) 幂等写入。
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';

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
  private dbPath: string;
  private dbMutex = new SimpleMutex();

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
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
            UNIQUE(doc_path, artifact_type, artifact_id)
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
            resolve();
          }
        );
      });
    });

    logger.info('血缘存储已初始化');
  }

  /** 幂等写入多条血缘（同 doc/type/id 忽略），返回实际新增数 */
  async addLinks(
    docPath: string,
    artifacts: Array<{ artifactType: LineageArtifactType; artifactId: string }>,
    version: number,
    domain: string = 'knowledge'
  ): Promise<number> {
    if (!this.db) await this.init();
    if (artifacts.length === 0) return 0;

    let added = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        const sql = `INSERT OR IGNORE INTO ${KG_LINEAGE_TABLE}
            (doc_path, artifact_type, artifact_id, domain, version, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`;
        const now = Date.now();
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
            [docPath, a.artifactType, a.artifactId, domain, version, now],
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

  /** 删除某 doc 的全部血缘（重编译前清理，防残留） */
  async purgeByDoc(docPath: string): Promise<number> {
    if (!this.db) await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT rowid FROM ${KG_LINEAGE_TABLE} WHERE doc_path = ?`,
          [docPath],
          (err: Error | null, rows: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            affected = (rows as unknown[]).length;
            this.db!.run(
              `DELETE FROM ${KG_LINEAGE_TABLE} WHERE doc_path = ?`,
              [docPath],
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

  /**
   * 在给定 node id 集合中，筛出**仍被引用**的那些（C6/O1 精确清理用）
   *
   * 调用约定：先 `purgeByDoc(被删文档)` 清掉该文档的血缘行，再调用本方法；
   * 仍能查到的 node → 由其它文档支撑 → 其关联边不应清除。
   */
  async findReferencedNodeIds(nodeIds: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    if (nodeIds.length === 0) return referenced;
    if (!this.db) await this.init();

    // 分批 IN（避开 SQLite 变量上限）
    const CHUNK = 500;
    for (let i = 0; i < nodeIds.length; i += CHUNK) {
      const chunk = nodeIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await new Promise<Array<Record<string, unknown>>>(
        (resolve, reject) => {
          this.db!.all(
            `SELECT DISTINCT artifact_id FROM ${KG_LINEAGE_TABLE}
              WHERE artifact_type = 'node' AND artifact_id IN (${placeholders})`,
            chunk,
            (err: Error | null, result: Array<Record<string, unknown>>) => {
              if (err) reject(err);
              else resolve(result ?? []);
            }
          );
        }
      );
      for (const row of rows) referenced.add(String(row.artifact_id));
    }
    return referenced;
  }

  /** 按过滤条件查询血缘 */
  async query(filters: LineageQuery = {}): Promise<LineageLink[]> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.docPath) {
      conditions.push('doc_path = ?');
      params.push(filters.docPath);
    }
    if (filters.artifactType) {
      conditions.push('artifact_type = ?');
      params.push(filters.artifactType);
    }
    if (filters.artifactId) {
      conditions.push('artifact_id = ?');
      params.push(filters.artifactId);
    }
    if (filters.domain) {
      conditions.push('domain = ?');
      params.push(filters.domain);
    }
    if (filters.version !== undefined) {
      conditions.push('version = ?');
      params.push(filters.version);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM ${KG_LINEAGE_TABLE} ${where} ORDER BY created_at`;

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
