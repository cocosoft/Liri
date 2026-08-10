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

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */
/**
 * 通用图引擎 — KnowledgeGraph
 *
 * 职责：实体间关联关系的存储、查询、遍历。
 * 基于 SQLite（统一 app.db），表名前缀 kg_。
 * 写操作受 SimpleMutex 保护，防止并发 WAL 锁冲突。
 *
 * Domain-First 支持：
 *   - kg_edges 表包含 domain 列，用于按域隔离
 *   - generateEntityId() 生成 {domain}:{kind}:{slug} 格式 ID
 *   - cleanupOrphans() 清理悬挂边
 */

import { Database } from '@modules/core/external/sqlite3';
import { randomUUID } from 'crypto';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';
import type { EdgeSchema } from '@modules/knowledge/schema/SchemaLoader';

const logger = getLogger('knowledge:graph:knowledgeGraph');

/** kg_edges 表名 */
export const KG_EDGES_TABLE = 'kg_edges';

/**
 * 边记录接口
 */
export interface Edge {
  /** 边唯一标识 */
  id: string;
  /** 源实体 ID */
  from: string;
  /** 目标实体 ID */
  to: string;
  /** 关系类型 */
  type: string;
  /** 方向：directed（有向）| symmetric（对称） */
  direction: 'directed' | 'symmetric';
  /** 所属域（Domain-First 隔离用，可选） */
  domain?: string;
  /** 自定义属性 */
  attributes: Record<string, unknown>;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

/**
 * 边查询过滤器
 */
export interface EdgeQuery {
  /** 按实体 ID 过滤 */
  entityId?: string;
  /** 方向（仅当 entityId 指定时有效） */
  direction?: 'outgoing' | 'incoming' | 'both';
  /** 按关系类型过滤 */
  type?: string;
  /** 源实体 */
  from?: string;
  /** 目标实体 */
  to?: string;
  /** 按域过滤（Domain-First） */
  domain?: string;
  /** 最大返回数 */
  limit?: number;
}

/**
 * 图统计信息
 */
export interface GraphStats {
  /** 总边数 */
  totalEdges: number;
  /** 每种关系类型的边数 */
  byType: Record<string, number>;
  /** 总实体数（from + to 去重） */
  totalEntities: number;
}

/**
 * 知识图谱引擎
 * 提供边的 CRUD、查询遍历和导出能力
 */
export class KnowledgeGraph {
  private db: Database | null = null;
  private dbPath: string;
  private dbMutex = new SimpleMutex();
  /** 可选的关系类型 schema 映射，用于 addEdge 校验 */
  private edgeSchemas?: Map<string, EdgeSchema>;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 设置关系类型 schema 映射
   * 设置后，addEdge 会自动校验 edge.type 和端点类型是否合法
   *
   * @param schemas 从 SchemaLoader.loadEdges() 获取的 edge schema 映射
   */
  setEdgeSchemas(schemas: Map<string, EdgeSchema>): void {
    this.edgeSchemas = schemas;
  }

  /**
   * 初始化数据库连接并创建表
   */
  async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTables();
    logger.info('知识图谱数据库已初始化');
  }

  /**
   * 创建 kg_edges 表及其索引
   * Domain-First: 新增 domain 列，通过 ALTER TABLE 迁移已有数据
   */
  private async createTables(): Promise<void> {
    if (!this.db)
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH
      );

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `CREATE TABLE IF NOT EXISTS ${KG_EDGES_TABLE} (
            edge_id     TEXT PRIMARY KEY,
            from_id     TEXT NOT NULL,
            to_id       TEXT NOT NULL,
            edge_type   TEXT NOT NULL,
            direction   TEXT NOT NULL DEFAULT 'directed',
            domain      TEXT DEFAULT '',
            attributes  TEXT DEFAULT '{}',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }

            // 并行创建索引
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_from ON ${KG_EDGES_TABLE}(from_id)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_to ON ${KG_EDGES_TABLE}(to_id)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_type ON ${KG_EDGES_TABLE}(edge_type)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_domain ON ${KG_EDGES_TABLE}(domain)`
            );

            // 迁移：为旧表添加 domain 列（若不存在）
            this!.db!.run(
              `ALTER TABLE ${KG_EDGES_TABLE} ADD COLUMN domain TEXT DEFAULT ''`,
              (alterErr) => {
                if (
                  alterErr &&
                  !alterErr.message.includes('duplicate column')
                ) {
                  logger.warning('添加 domain 列失败（非致命，可能已存在）', {
                    error: alterErr.message,
                  });
                }
              }
            );

            resolve();
          }
        );
      });
    });
  }

  /**
   * 添加一条边
   * @param edge 边数据（不含 id/createdAt/updatedAt）
   * @returns 完整 Edge 对象
   */
  async addEdge(edge: {
    from: string;
    to: string;
    type: string;
    direction?: 'directed' | 'symmetric';
    domain?: string;
    attributes?: Record<string, unknown>;
  }): Promise<Edge> {
    if (!this.db) await this.init();

    const now = Date.now();
    const fullEdge: Edge = {
      id: `edge_${randomUUID().slice(0, 8)}_${now}`,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      direction: edge.direction || 'directed',
      domain: edge.domain || '',
      attributes: edge.attributes || {},
      createdAt: now,
      updatedAt: now,
    };

    // Schema 校验：检查 edge.type 是否在已注册的 edge schema 中
    if (this.edgeSchemas) {
      const schema = this.edgeSchemas.get(edge.type);
      if (!schema) {
        const knownTypes = Array.from(this.edgeSchemas.keys()).join(', ');
        throw new AppError(
          `未知的关系类型 "${edge.type}"，已知类型: ${knownTypes}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'KG_INVALID_EDGE_TYPE',
          { module: 'KnowledgeGraph' }
        );
      }

      // 校验端点类型：解析实体 ID 提取 kind，与 schema.endpoints 比对
      const fromParsed = KnowledgeGraph.parseEntityId(edge.from);
      const toParsed = KnowledgeGraph.parseEntityId(edge.to);

      if (fromParsed && fromParsed.kind !== schema.endpoints.from) {
        logger.warning('边源端点类型不匹配 schema', {
          expected: schema.endpoints.from,
          actual: fromParsed.kind,
          edgeType: edge.type,
        });
      }
      if (toParsed && toParsed.kind !== schema.endpoints.to) {
        logger.warning('边目标端点类型不匹配 schema', {
          expected: schema.endpoints.to,
          actual: toParsed.kind,
          edgeType: edge.type,
        });
      }
    }

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${KG_EDGES_TABLE} (edge_id, from_id, to_id, edge_type, direction, domain, attributes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fullEdge.id,
            fullEdge.from,
            fullEdge.to,
            fullEdge.type,
            fullEdge.direction,
            fullEdge.domain,
            JSON.stringify(fullEdge.attributes),
            fullEdge.createdAt,
            fullEdge.updatedAt,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    return fullEdge;
  }

  /**
   * 根据 ID 获取单条边
   */
  async getEdge(id: string): Promise<Edge | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${KG_EDGES_TABLE} WHERE edge_id = ?`,
        [id],
        (err, row: any) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row ? this.rowToEdge(row) : null);
        }
      );
    });
  }

  /**
   * 删除一条边
   */
  async deleteEdge(id: string): Promise<void> {
    if (!this.db) await this.init();

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${KG_EDGES_TABLE} WHERE edge_id = ?`,
          [id],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /**
   * 查询边，支持按实体、方向、类型过滤
   */
  async queryEdges(filters: EdgeQuery): Promise<Edge[]> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: any[] = [];

    // 按实体 ID + 方向过滤
    if (filters.entityId) {
      if (
        filters.direction === 'outgoing' ||
        !filters.direction ||
        filters.direction === 'both'
      ) {
        conditions.push('from_id = ?');
        params.push(filters.entityId);
      }
      if (filters.direction === 'incoming' || filters.direction === 'both') {
        conditions.push('to_id = ?');
        params.push(filters.entityId);
      }
    }

    // 按源实体过滤
    if (filters.from) {
      conditions.push('from_id = ?');
      params.push(filters.from);
    }

    // 按目标实体过滤
    if (filters.to) {
      conditions.push('to_id = ?');
      params.push(filters.to);
    }

    // 按关系类型过滤
    if (filters.type) {
      conditions.push('edge_type = ?');
      params.push(filters.type);
    }

    // 按域过滤
    if (filters.domain) {
      conditions.push('domain = ?');
      params.push(filters.domain);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limitClause = filters.limit ? `LIMIT ${filters.limit}` : '';

    const sql = `SELECT * FROM ${KG_EDGES_TABLE} ${whereClause} ORDER BY created_at DESC ${limitClause}`;

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows.map((r) => this.rowToEdge(r)));
      });
    });
  }

  /**
   * 获取图统计信息
   */
  async getStats(): Promise<GraphStats> {
    if (!this.db) await this.init();

    const totalEdges = await new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) AS count FROM ${KG_EDGES_TABLE}`,
        (err, row: any) => {
          if (err) reject(err);
          else resolve(row?.count ?? 0);
        }
      );
    });

    const byTypeRows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT edge_type, COUNT(*) AS count FROM ${KG_EDGES_TABLE} GROUP BY edge_type ORDER BY count DESC`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows ?? []);
        }
      );
    });

    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.edge_type] = row.count;
    }

    const entityCount = await new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(DISTINCT eid) AS count FROM (
          SELECT from_id AS eid FROM ${KG_EDGES_TABLE}
          UNION
          SELECT to_id AS eid FROM ${KG_EDGES_TABLE}
        )`,
        (err, row: any) => {
          if (err) reject(err);
          else resolve(row?.count ?? 0);
        }
      );
    });

    return { totalEdges, byType, totalEntities: entityCount };
  }

  /**
   * 导出所有边为 JSONL 格式
   * @returns JSONL 字符串，每行一条边
   */
  async exportJsonl(): Promise<string> {
    const edges = await this.queryEdges({});
    return edges.map((e) => JSON.stringify(e)).join('\n');
  }

  /**
   * 关闭数据库连接
   */
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

  /**
   * 将数据库行转换为 Edge 对象
   */
  private rowToEdge(row: any): Edge {
    return {
      id: row.edge_id,
      from: row.from_id,
      to: row.to_id,
      type: row.edge_type,
      direction: row.direction as 'directed' | 'symmetric',
      domain: row.domain || undefined,
      attributes:
        typeof row.attributes === 'string'
          ? JSON.parse(row.attributes)
          : (row.attributes ?? {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // =======================================================================
  // Domain-First 工具方法
  // =======================================================================

  /**
   * 生成统一格式的实体 ID：{domain}:{kind}:{slug}
   * @example generateEntityId('botany', 'species', 'venus_flytrap')
   *   → 'botany:species:venus_flytrap'
   */
  static generateEntityId(domain: string, kind: string, slug: string): string {
    return `${domain}:${kind}:${slug}`;
  }

  /**
   * 从实体 ID 解析出 domain、kind、slug
   * @example parseEntityId('botany:species:venus_flytrap')
   *   → { domain: 'botany', kind: 'species', slug: 'venus_flytrap' }
   */
  static parseEntityId(
    entityId: string
  ): { domain: string; kind: string; slug: string } | null {
    const parts = entityId.split(':');
    if (parts.length < 3) return null;
    return {
      domain: parts[0],
      kind: parts.slice(1, -1).join(':') || parts[1],
      slug: parts[parts.length - 1],
    };
  }

  /**
   * 清理指定域中的悬挂边（from/to 实体不在该域中的边）
   * 当实体被删除后，其关联的边变为悬挂状态，此方法可批量清理。
   *
   * @param validEntityIds 当前有效的实体 ID 集合
   * @param domain 可选，限缩到特定域
   * @returns 删除的悬挂边数量
   */
  async cleanupOrphans(
    validEntityIds: Set<string>,
    domain?: string
  ): Promise<number> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: any[] = [];

    // domain 过滤
    if (domain) {
      conditions.push('domain = ?');
      params.push(domain);
    }

    const wherePrefix =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')} AND` : 'WHERE';

    const sql = `SELECT edge_id, from_id, to_id FROM ${KG_EDGES_TABLE} ${wherePrefix} (from_id NOT IN (${Array.from(
      validEntityIds
    )
      .map(() => '?')
      .join(',')}) OR to_id NOT IN (${Array.from(validEntityIds)
      .map(() => '?')
      .join(',')}))`;

    const allParams = [
      ...params,
      ...Array.from(validEntityIds),
      ...Array.from(validEntityIds),
    ];

    const orphans = await new Promise<
      Array<{ edge_id: string; from_id: string; to_id: string }>
    >((resolve, reject) => {
      this.db!.all(sql, allParams, (err, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows ?? []);
      });
    });

    if (orphans.length === 0) return 0;

    const orphanIds = orphans.map((o) => o.edge_id);

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${KG_EDGES_TABLE} WHERE edge_id IN (${orphanIds.map(() => '?').join(',')})`,
          orphanIds,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    logger.info('清理悬挂边', {
      count: orphanIds.length,
      domain: domain || 'all',
    });
    return orphanIds.length;
  }
}
