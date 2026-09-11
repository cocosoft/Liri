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
 *   - **O15-B（2026-09-11）**：实体 ID 统一为**裸 slug**（不承载 domain/kind）；
 *     `kind` 是实体**档案属性**（存 `kg_nodes.kind`），端点校验的 kind 由调用方注入
 *   - cleanupOrphans() 清理悬挂边
 */

import { Database } from '@modules/core/external/sqlite3';
import { randomUUID } from 'crypto';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';
import type {
  EdgeSchema,
  EntitySchema,
} from '@modules/knowledge/schema/SchemaLoader';
import {
  evaluateEndpointMatch,
  type EndpointKindLookup,
} from './endpointMatch';

const logger = getLogger('knowledge:graph:knowledgeGraph');

/** kg_edges 表名 */
export const KG_EDGES_TABLE = 'kg_edges';

/**
 * 人工删除墓碑表（D3 / M1 标记保护）
 *
 * 记录"被人为删除过"的边键（from,to,type,domain）。自动流程（抽取 / 查询反馈 / 梦境）
 * 写入前命中墓碑即**跳过**，从而实现「人工删除的边不会被重编译加回」；
 * 人工显式重加同一条边时清除对应墓碑（尊重最新的人工意图）。
 */
export const KG_EDGE_TOMBSTONES_TABLE = 'kg_edge_tombstones';

/**
 * 边操作审计表（D5：append-only）
 *
 * 记录每一次人工/自动写入（create / update / delete / restore）的 before/after 快照，
 * 支撑「这条边是谁什么时候改的」与「撤销上一次人工操作」。
 */
export const KG_EDGE_AUDIT_TABLE = 'kg_edge_audit';

/** D2：节点表（实体档案；边仍是关系的唯一来源，节点可由边自动补建） */
export const KG_NODES_TABLE = 'kg_nodes';

/** 审计动作 */
export type EdgeAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'undo'
  | 'cleanup'
  | 'import';

/** 审计条目（对外结构） */
export interface EdgeAuditEntry {
  auditId: string;
  edgeId?: string;
  action: EdgeAuditAction;
  origin: 'manual' | 'auto';
  before?: unknown;
  after?: unknown;
  actor: string;
  note?: string;
  createdAt: number;
}

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
  /** 总实体数（**D2 起 = 节点表总数，含孤立实体**；旧口径见 `derivedEntities`） */
  totalEntities: number;
  /** 由边派生的端点数（旧口径，保留供界面标注与回归对比） */
  derivedEntities: number;
}

/**
 * 同库共享写锁（D7-4 / P1-8）
 *
 * `dbMutex` 原为**实例字段**，而 HTTP 路径每个请求都 `new KnowledgeGraph()`
 * ⇒ 实例之间完全不互斥、写路径实际无串行化。改为按 dbPath 键控的模块级共享锁。
 */
const sharedDbMutexes = new Map<string, SimpleMutex>();

function getSharedDbMutex(dbPath: string): SimpleMutex {
  let mutex = sharedDbMutexes.get(dbPath);
  if (!mutex) {
    mutex = new SimpleMutex();
    sharedDbMutexes.set(dbPath, mutex);
  }
  return mutex;
}

/**
 * 知识图谱引擎
 * 提供边的 CRUD、查询遍历和导出能力
 */
export class KnowledgeGraph {
  private db: Database | null = null;
  private dbPath: string;
  /** D7-4：同 dbPath 的所有实例共享同一把写锁 */
  private dbMutex: SimpleMutex;
  /** 所属域（D7：按域解析 schema；未指定 → 全局 .schema） */
  private domainName?: string;
  /** 生效的关系类型白名单（显式注入 或 D7 自动按域加载） */
  private edgeSchemas?: Map<string, EdgeSchema>;
  /** 生效的实体类型白名单（D7-6：供编译管线取"单一事实来源"） */
  private entitySchemas?: Map<string, EntitySchema>;
  /** D7：schema 是否已解析（懒加载 memo，避免每次写入读盘） */
  private schemaResolved = false;
  /** 是否由调用方显式注入 schema（显式优先，自动加载不再覆盖） */
  private explicitSchemas = false;
  /** D7：端点 kind 不符的累计次数（D7=B：只计数不拒绝） */
  private endpointMismatchCount = 0;
  /** D8：唯一索引是否就绪（存量重复会导致建索引失败 → 未就绪时回退"先查后插"） */
  private uniqueIndexReady = false;

  /**
   * @param dbPath 数据库路径（默认统一 app.db）
   * @param domainName 所属域（可选；D7 用于按域解析 schema，域缺失时逐文件回退全局）
   */
  constructor(dbPath: string = resolveDbPath(), domainName?: string) {
    this.dbPath = dbPath;
    this.domainName = domainName;
    this.dbMutex = getSharedDbMutex(dbPath);
  }

  /**
   * 设置关系类型 schema 映射（**显式优先**：注入后不再按域自动加载）
   *
   * @deprecated D7 起默认按 `domain` 自动加载（`SchemaLoader.loadGraphSchemas`，只读）；
   *   仅在需要覆盖自动解析结果的特殊场景使用。
   */
  setEdgeSchemas(schemas: Map<string, EdgeSchema>): void {
    this.edgeSchemas = schemas;
    this.explicitSchemas = true;
    this.schemaResolved = true;
  }

  /**
   * D7-3：按域懒加载 schema（只读 + memo）
   *
   * 关键语义（对应复核"陷阱 1"，B0-③ 在写入侧的翻版）：
   * - **空 Map ≠ 全部拒绝**：约束只在本实例 `edges.size > 0` 时生效；
   * - `edges.yaml` 缺失 → 无声明（info）；文件存在但有效项为 0 → **降级 freeform + WARNING**；
   * - 加载失败一律降级 freeform（schema 是增强项，不是依赖，绝不因此让写入抛错）。
   */
  private async ensureSchemaLoaded(): Promise<void> {
    if (this.schemaResolved) return;
    this.schemaResolved = true;

    try {
      const { SchemaLoader } =
        await import('@modules/knowledge/schema/SchemaLoader');
      const { entities, edges, source } = await new SchemaLoader(
        undefined,
        this.domainName
      ).loadGraphSchemas();

      this.entitySchemas = entities;
      this.edgeSchemas = edges;

      if (!source.edges) {
        logger.info('关系类型不受约束（无 edges.yaml，freeform 语义）', {
          domain: this.domainName ?? 'global',
        });
      } else if (edges.size === 0) {
        logger.warning(
          'edges.yaml 存在但有效关系类型为 0 → 降级 freeform（不拒绝写入）',
          { path: source.edges, domain: this.domainName ?? 'global' }
        );
      } else {
        logger.info('关系类型白名单已加载', {
          path: source.edges,
          edgeTypes: edges.size,
          entityTypes: entities.size,
          domain: this.domainName ?? 'global',
        });
      }
    } catch (err) {
      logger.warning('schema 加载失败 → 本次按 freeform 处理', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.edgeSchemas = undefined;
      this.entitySchemas = undefined;
    }
  }

  /**
   * D7-3：当前写入约束模式（可推导，供徽标 / 编译管线取单一事实来源，解 C5）
   */
  getSchemaMode(): 'constrained' | 'freeform' {
    return this.edgeSchemas && this.edgeSchemas.size > 0
      ? 'constrained'
      : 'freeform';
  }

  /** D7：显式触发一次 schema 解析（供编译管线在构造 GraphExtractor 前调用） */
  async initSchema(): Promise<void> {
    await this.ensureSchemaLoaded();
  }

  /** D7-3：当前生效的关系类型白名单（空 Map / undefined = 无约束） */
  getEdgeSchemas(): Map<string, EdgeSchema> | undefined {
    return this.edgeSchemas;
  }

  /** D7-3：端点 kind 不符的累计次数（"告警 + 计数"中的计数） */
  getEndpointMismatchCount(): number {
    return this.endpointMismatchCount;
  }

  /**
   * D7-6：供编译管线取用的图 schema（`{entities, edges}`；两侧皆空 → undefined）
   */
  getGraphSchema():
    | { entities: Map<string, EntitySchema>; edges: Map<string, EdgeSchema> }
    | undefined {
    if (!this.entitySchemas?.size && !this.edgeSchemas?.size) return undefined;
    return {
      entities: this.entitySchemas ?? new Map<string, EntitySchema>(),
      edges: this.edgeSchemas ?? new Map<string, EdgeSchema>(),
    };
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

    // D2：存量回填（幂等且**只在必要时**跑）—— 节点表为空而边表非空时，
    // 从边端点补建节点（首次升级 / 手工清表后的自愈）；否则不做全表扫描
    await this.backfillNodesIfEmpty();

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
            // D3/M1：人工删除墓碑表（PK 即 (from,to,type,domain)，天然去重）
            this!.db!.run(
              `CREATE TABLE IF NOT EXISTS ${KG_EDGE_TOMBSTONES_TABLE} (
                from_id    TEXT NOT NULL,
                to_id      TEXT NOT NULL,
                edge_type  TEXT NOT NULL,
                domain     TEXT NOT NULL DEFAULT '',
                deleted_at INTEGER NOT NULL,
                PRIMARY KEY (from_id, to_id, edge_type, domain)
              )`
            );
            // D5：append-only 审计表（谁/何时/改了什么；支持单条操作撤销）
            this!.db!.run(
              `CREATE TABLE IF NOT EXISTS ${KG_EDGE_AUDIT_TABLE} (
                audit_id    TEXT PRIMARY KEY,
                edge_id     TEXT,
                action      TEXT NOT NULL,
                origin      TEXT NOT NULL,
                before_json TEXT,
                after_json  TEXT,
                actor       TEXT NOT NULL DEFAULT 'local',
                note        TEXT,
                created_at  INTEGER NOT NULL
              )`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_audit_edge ON ${KG_EDGE_AUDIT_TABLE}(edge_id)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_audit_created ON ${KG_EDGE_AUDIT_TABLE}(created_at)`
            );
            // D2：节点表（实体档案 / 支持孤立实体）；**不动 kg_edges 结构**
            this!.db!.run(
              `CREATE TABLE IF NOT EXISTS ${KG_NODES_TABLE} (
                node_id     TEXT PRIMARY KEY,
                domain      TEXT NOT NULL DEFAULT '',
                kind        TEXT NOT NULL DEFAULT '',
                slug        TEXT NOT NULL,
                name        TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                aliases     TEXT NOT NULL DEFAULT '[]',
                tags        TEXT NOT NULL DEFAULT '[]',
                attributes  TEXT NOT NULL DEFAULT '{}',
                source      TEXT NOT NULL DEFAULT 'auto',
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
              )`
            );
            this!.db!.run(
              `CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_node_identity ON ${KG_NODES_TABLE}(domain, kind, slug)`
            );
            // O15-B：ID 即 slug —— 补 (domain, slug) 索引（旧索引保留，不删结构；非 UNIQUE 以兼容存量）
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_node_slug ON ${KG_NODES_TABLE}(domain, slug)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_kg_node_domain ON ${KG_NODES_TABLE}(domain)`
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

            // D8：(from,to,type,domain) 唯一索引 —— 存量重复会让建索引失败，
            // 此处不阻断启动（仅告警），由 dedupeEdges() 收敛后重建
            void this!.ensureUniqueIndex().finally(() => resolve());
          }
        );
      });
    });
  }

  /**
   * 新增一条边（D8 幂等）
   *
   * D3/M1 冲突治理：
   * - `origin='auto'`（默认，抽取/反馈/梦境等自动流程）：若该边键**存在人工删除墓碑** → 跳过并返回 null；
   * - `origin='manual'`（人工经 HTTP/UI 写入）：清除该键墓碑后写入（人工意图最新）。
   *
   * @returns 写入或既有的边；被墓碑拦截时返回 null
   */
  async addEdge(
    edge: {
      from: string;
      to: string;
      type: string;
      direction?: 'directed' | 'symmetric';
      domain?: string;
      attributes?: Record<string, unknown>;
    },
    options: { origin?: 'auto' | 'manual' } = {}
  ): Promise<Edge | null> {
    if (!this.db) await this.init();

    const now = Date.now();
    const fullEdge: Edge = {
      // P2-13：用完整 UUID（原 slice(0,8) 仅 32bit，主键碰撞会被 INSERT OR IGNORE 静默吞掉）
      id: `edge_${randomUUID()}_${now}`,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      direction: edge.direction || 'directed',
      domain: edge.domain || '',
      attributes: edge.attributes || {},
      createdAt: now,
      updatedAt: now,
    };

    // D7-3：按域自动加载 schema（懒加载 + memo；空 Map 一律降级 freeform，不拒绝）
    await this.ensureSchemaLoaded();

    // 关系白名单校验：仅在本实例**有效白名单非空**时生效（空 Map ≠ 全部拒绝）
    if (this.edgeSchemas && this.edgeSchemas.size > 0) {
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

      // D7-1 / D7=B：端点 kind 不符 → **告警 + 计数，不拒绝**
      // （严格拒绝会打断 QueryFeedbackPipeline / DreamGraphPhase 的现存写入）
      // O15-B：kind 不再从 ID 解析 —— 从**实体档案**注入；未标注 kind 的端点不判定（防误报）
      const endpointKindOf = await this.buildEndpointKindLookup([
        edge.from,
        edge.to,
      ]);
      const match = evaluateEndpointMatch(
        edge,
        this.edgeSchemas,
        endpointKindOf
      );
      if (!match.matched) {
        this.endpointMismatchCount++;
        logger.warning('边端点类型不匹配 schema（已放行，仅告警计数）', {
          edgeType: edge.type,
          from: edge.from,
          to: edge.to,
          expectedFrom: match.expectedFrom,
          expectedTo: match.expectedTo,
          actualFrom: match.actualFrom,
          actualTo: match.actualTo,
          reason: match.reason,
          mismatchCount: this.endpointMismatchCount,
        });
      }
    }

    // D3/M1：人工删除过的边不再被自动流程加回；人工显式重加则清除墓碑
    const origin = options.origin ?? 'auto';
    const key = {
      from: edge.from,
      to: edge.to,
      type: edge.type,
      domain: edge.domain,
    };
    if (await this.isEdgeTombstoned(key)) {
      if (origin === 'auto') {
        logger.info('边已被人工删除（墓碑命中）→ 跳过自动写入', {
          from: edge.from,
          to: edge.to,
          type: edge.type,
          domain: edge.domain,
        });
        return null;
      }
      await this.clearTombstone(key);
    }

    // D2：边写入时确保两个端点节点存在（节点表由边自动补建；**不覆盖人工档案**）
    await this.ensureEdgeEndpointNodes(fullEdge);

    // D8：幂等写入 —— 唯一索引就绪时靠 INSERT OR IGNORE；未就绪（存量重复）时先查后插
    if (!this.uniqueIndexReady) {
      const preExisting = await this.findEdgeByKey(fullEdge);
      if (preExisting) return preExisting;
    }

    const inserted = await this.dbMutex.run<number>(() => {
      return new Promise<number>((resolve, reject) => {
        this.db!.run(
          `INSERT OR IGNORE INTO ${KG_EDGES_TABLE} (edge_id, from_id, to_id, edge_type, direction, domain, attributes, created_at, updated_at)
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
          function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve(this.changes ?? 0);
          }
        );
      });
    });

    if (inserted === 0) {
      // 命中唯一约束 → 返回既有边（幂等语义，不新增重复行）
      const existing = await this.findEdgeByKey(fullEdge);
      if (existing) {
        logger.info('边已存在，返回既有记录（幂等）', {
          existingId: existing.id,
          requestedId: fullEdge.id,
          type: fullEdge.type,
        });
        return existing;
      }
      // P0-2：INSERT OR IGNORE 被吞但不是自然键冲突（如主键碰撞）→ 绝不返回未落库的"幻影边"
      throw new AppError(
        `边写入冲突：${fullEdge.type}（${fullEdge.from} → ${fullEdge.to}）未落库且无既有同键记录`,
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH,
        'KG_EDGE_INSERT_CONFLICT',
        { module: 'KnowledgeGraph' }
      );
    }

    // D5：记录审计（仅"真正新增"这一次；幂等命中不记，避免噪声）
    await this.recordAudit({
      edgeId: fullEdge.id,
      action: 'create',
      origin,
      after: fullEdge,
    });

    return fullEdge;
  }

  // ========== D2：节点（实体档案） ==========

  // O15-B：`splitNodeId` 已删除 —— ID 即 slug，不再有"从 ID 解析 domain/kind"这一步

  /**
   * 新建或更新一个节点（D2）
   *
   * - `origin='auto'`（边写入时自动补建）：**只保证节点存在**，不覆盖既有档案字段
   * - `origin='manual'`（用户编辑档案 / 创建孤立实体）：写入档案字段并置 `source='manual'`
   *
   * 用「INSERT OR IGNORE + UPDATE」两步实现，避免依赖特定 SQLite 版本的 upsert 语法。
   */
  async upsertNode(
    input: {
      id: string;
      domain?: string;
      /**
       * O15-B：实体**分类标签**（不再是 ID 的一部分）
       * 仅 `origin='manual'` 或显式给出时写入；空串表示"未标注"
       */
      kind?: string;
      /** O15-B：slug（缺省等于 `id`，因为 ID 就是 slug） */
      slug?: string;
      name?: string;
      description?: string;
      aliases?: string[];
      tags?: string[];
      attributes?: Record<string, unknown>;
    },
    options: { origin?: 'auto' | 'manual' } = {}
  ): Promise<void> {
    if (!this.db) await this.init();

    const origin = options.origin ?? 'manual';
    // O15-B：**ID 就是 slug**（不再解析形态）；kind 是档案属性，由调用方显式给出
    const nodeDomain = input.domain?.trim() ?? '';
    const nodeKind = input.kind?.trim() ?? '';
    const nodeSlug = input.slug?.trim() || input.id;
    const now = Date.now();

    await this.dbMutex.run<void>(() => {
      return new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT OR IGNORE INTO ${KG_NODES_TABLE}
             (node_id, domain, kind, slug, name, description, aliases, tags, attributes, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '', '[]', '[]', '{}', 'auto', ?, ?)`,
          [
            input.id,
            nodeDomain,
            nodeKind,
            nodeSlug,
            input.name ?? nodeSlug,
            now,
            now,
          ],
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            if (origin === 'auto') {
              resolve();
              return;
            }
            this.db!.run(
              `UPDATE ${KG_NODES_TABLE}
                  SET kind = ?, slug = ?, name = ?, description = ?, aliases = ?, tags = ?, attributes = ?,
                      source = 'manual', updated_at = ?
                WHERE node_id = ?`,
              [
                nodeKind,
                nodeSlug,
                input.name ?? nodeSlug,
                input.description ?? '',
                JSON.stringify(input.aliases ?? []),
                JSON.stringify(input.tags ?? []),
                JSON.stringify(input.attributes ?? {}),
                now,
                input.id,
              ],
              (updateErr: Error | null) =>
                updateErr ? reject(updateErr) : resolve()
            );
          }
        );
      });
    });
  }

  /** 边写入时补建两端节点（auto 语义，幂等；不覆盖人工档案） */
  private async ensureEdgeEndpointNodes(edge: {
    from: string;
    to: string;
    domain?: string;
  }): Promise<void> {
    for (const nodeId of [edge.from, edge.to]) {
      if (!nodeId) continue;
      await this.upsertNode(
        { id: nodeId, domain: edge.domain || '' },
        { origin: 'auto' }
      );
    }
  }

  /**
   * O15-B：为端点校验构建 kind 查询器
   *
   * 实体 ID 不再承载 kind，端点分类需从实体档案（`kg_nodes.kind`）读取。
   * 先一次性查好涉及的节点，再返回**同步**查询函数，使 `evaluateEndpointMatch`
   * 保持纯函数（无 DB 依赖）。未标注 kind（空串/无记录）→ 返回 `undefined`（不判定）。
   */
  private async buildEndpointKindLookup(
    nodeIds: string[]
  ): Promise<EndpointKindLookup> {
    if (!this.db) return () => undefined;
    const ids = Array.from(new Set(nodeIds.filter((id) => !!id)));
    if (ids.length === 0) return () => undefined;

    const placeholders = ids.map(() => '?').join(', ');
    const rows = await new Promise<Array<{ node_id: string; kind: string }>>(
      (resolve, reject) => {
        this.db!.all(
          `SELECT node_id, kind FROM ${KG_NODES_TABLE} WHERE node_id IN (${placeholders})`,
          ids,
          (err: Error | null, rows: any[]) =>
            err ? reject(err) : resolve(rows ?? [])
        );
      }
    );

    const kindMap = new Map<string, string>();
    for (const row of rows) {
      const kind = (row.kind ?? '').trim();
      if (kind) kindMap.set(row.node_id, kind);
    }
    return (nodeId: string) => kindMap.get(nodeId);
  }

  /** 节点总数（D2） */
  private async countNodes(): Promise<number> {
    if (!this.db) await this.init();
    return new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) AS count FROM ${KG_NODES_TABLE}`,
        (err, row: any) => (err ? reject(err) : resolve(row?.count ?? 0))
      );
    });
  }

  /** 条件回填：仅当节点表为空而边表非空时执行（init 时调用，避免每次启动全表扫描） */
  private async backfillNodesIfEmpty(): Promise<number> {
    if (!this.db) return 0;
    if ((await this.countNodes()) > 0) return 0;
    return this.backfillNodes();
  }

  /**
   * 存量回填（幂等）：把图中所有端点补进节点表
   *
   * @returns 处理的端点数（已存在的由 `INSERT OR IGNORE` 跳过）
   */
  async backfillNodes(): Promise<number> {
    if (!this.db) await this.init();

    const endpoints = await new Promise<Array<{ id: string; domain: string }>>(
      (resolve, reject) => {
        this.db!.all(
          `SELECT from_id AS id, domain FROM ${KG_EDGES_TABLE}
           UNION
           SELECT to_id AS id, domain FROM ${KG_EDGES_TABLE}`,
          [],
          (err: Error | null, rows: any[]) =>
            err ? reject(err) : resolve(rows ?? [])
        );
      }
    );

    for (const row of endpoints) {
      await this.upsertNode(
        { id: row.id, domain: row.domain || '' },
        { origin: 'auto' }
      );
    }

    logger.info('节点表回填完成', { endpoints: endpoints.length });
    return endpoints.length;
  }

  /** 读取单个节点（不存在 → null） */
  async getNode(nodeId: string): Promise<Record<string, unknown> | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${KG_NODES_TABLE} WHERE node_id = ?`,
        [nodeId],
        (err, row: any) => (err ? reject(err) : resolve(row ?? null))
      );
    });
  }

  /**
   * 列出节点（可按域过滤 + 关键词搜索，limit 钳制 1..1000）
   *
   * `search` 在**服务端**匹配 `node_id / name / description / kind`（LIKE 子串）——
   * 避免前端只能搜索"已加载窗口"内的一小部分（D2-3）。
   * 每行附带 `degree`（关联边数，孤立实体为 0）。
   */
  async listNodes(
    filters: { domain?: string; limit?: number; search?: string } = {}
  ): Promise<Array<Record<string, unknown>>> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: any[] = [];
    if (filters.domain) {
      conditions.push('n.domain = ?');
      params.push(filters.domain);
    }
    const search = filters.search?.trim();
    if (search) {
      conditions.push(
        '(n.node_id LIKE ? OR n.name LIKE ? OR n.description LIKE ? OR n.kind LIKE ?)'
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';
    const limitClause = filters.limit ? 'LIMIT ?' : '';
    if (filters.limit) {
      params.push(Math.min(Math.max(1, Math.floor(filters.limit)), 1000));
    }

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT n.*,
                (SELECT COUNT(*) FROM ${KG_EDGES_TABLE} e
                  WHERE e.from_id = n.node_id OR e.to_id = n.node_id) AS degree
           FROM ${KG_NODES_TABLE} n ${whereClause}
          ORDER BY n.updated_at DESC ${limitClause}`,
        params,
        (err: Error | null, rows: any[]) =>
          err ? reject(err) : resolve(rows ?? [])
      );
    });
  }

  /**
   * 更新节点档案（D2-2）
   *
   * 只允许改**档案字段**（kind / name / description / aliases / tags / attributes）；
   * `node_id`（身份）不可改 —— 改身份 = 删旧建新（避免边端点悬挂）。
   *
   * O15-B：`kind` 不再是身份的一部分（ID 即裸 slug），因此可在此修改。
   *
   * @returns 受影响行数（0 = 节点不存在，由 HTTP 层转 404）
   */
  async updateNodeArchive(
    nodeId: string,
    patch: {
      kind?: string;
      name?: string;
      description?: string;
      aliases?: string[];
      tags?: string[];
      attributes?: Record<string, unknown>;
    }
  ): Promise<number> {
    if (!this.db) await this.init();

    const sets: string[] = [];
    const params: any[] = [];
    if (patch.kind !== undefined) {
      sets.push('kind = ?');
      params.push(patch.kind.trim());
    }
    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description);
    }
    if (patch.aliases !== undefined) {
      sets.push('aliases = ?');
      params.push(JSON.stringify(patch.aliases));
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(patch.tags));
    }
    if (patch.attributes !== undefined) {
      sets.push('attributes = ?');
      params.push(JSON.stringify(patch.attributes));
    }
    if (sets.length === 0) return 0;

    sets.push("source = 'manual'", 'updated_at = ?');
    params.push(Date.now(), nodeId);

    return this.dbMutex.run<number>(() => {
      return new Promise<number>((resolve, reject) => {
        this.db!.run(
          `UPDATE ${KG_NODES_TABLE} SET ${sets.join(', ')} WHERE node_id = ?`,
          params,
          function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve(this.changes ?? 0);
          }
        );
      });
    });
  }

  /** 删除节点（仅节点表；有边时请用 deleteEntity 以同时级联删边） */
  async deleteNode(nodeId: string): Promise<void> {
    if (!this.db) await this.init();
    await this.dbMutex.run<void>(() => {
      return new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${KG_NODES_TABLE} WHERE node_id = ?`,
          [nodeId],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    });
  }

  /**
   * 按自然键 (from, to, type, domain) 查既有边（D8 幂等判定的单点实现）
   */
  private async findEdgeByKey(edge: {
    from: string;
    to: string;
    type: string;
    domain?: string;
  }): Promise<Edge | null> {
    if (!this.db) await this.init();

    return new Promise<Edge | null>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${KG_EDGES_TABLE}
          WHERE from_id = ? AND to_id = ? AND edge_type = ?
            AND COALESCE(domain, '') = COALESCE(?, '')
          ORDER BY created_at ASC
          LIMIT 1`,
        [edge.from, edge.to, edge.type, edge.domain ?? ''],
        (err: Error | null, row: Record<string, unknown> | undefined) =>
          err ? reject(err) : resolve(row ? this.rowToEdge(row) : null)
      );
    });
  }

  /**
   * 确保 (from_id, to_id, edge_type, domain) 唯一索引存在（D8）
   *
   * 存量重复会让建索引失败 —— 不阻断启动，仅告警；由 `dedupeEdges()` 收敛后重建。
   * 用 COALESCE(domain,'') 表达式索引以覆盖 domain 为 NULL 的历史行。
   */
  private async ensureUniqueIndex(): Promise<void> {
    if (!this.db) return;

    this.uniqueIndexReady = await new Promise<boolean>((resolve) => {
      this.db!.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_edge_unique
           ON ${KG_EDGES_TABLE}(from_id, to_id, edge_type, COALESCE(domain, ''))`,
        (err: Error | null) => {
          if (err) {
            logger.warning('kg_edges 唯一索引未建立（存量存在重复边）', {
              error: err.message,
              hint: '可在去重后重建：pyapp knowledge dedupe-edges',
            });
            resolve(false);
            return;
          }
          resolve(true);
        }
      );
    });
  }

  /** 统计重复分组数（按 (from,to,type,domain)） */
  private async countDuplicateGroups(): Promise<number> {
    if (!this.db) await this.init();

    return new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) AS groups FROM (
           SELECT 1 FROM ${KG_EDGES_TABLE}
           GROUP BY from_id, to_id, edge_type, COALESCE(domain, '')
           HAVING COUNT(*) > 1
         )`,
        (err: Error | null, row: Record<string, unknown> | undefined) =>
          err ? reject(err) : resolve(Number(row?.groups ?? 0))
      );
    });
  }

  /**
   * 去重：同一 (from,to,type,domain) 仅保留**最早插入**的一条（D8）
   *
   * ⚠️ 属数据删除操作 —— 调用前请先备份（`exportJsonl` / CLI `knowledge export-graph`）。
   * 完成后自动重建唯一索引，此后 `addEdge` 走 INSERT OR IGNORE 的幂等快路径。
   */
  async dedupeEdges(): Promise<{
    groups: number;
    removed: number;
    indexReady: boolean;
  }> {
    if (!this.db) await this.init();

    const groups = await this.countDuplicateGroups();
    if (groups === 0) {
      await this.ensureUniqueIndex();
      return { groups: 0, removed: 0, indexReady: this.uniqueIndexReady };
    }

    const removed = await this.dbMutex.run<number>(() => {
      return new Promise<number>((resolve, reject) => {
        // P0-4：用 (created_at, edge_id) 表达"最早"，不能用 rowid ——
        // SQLite 的 rowid 在删除最大 rowid 后会被复用，不能代表插入先后
        this.db!.run(
          `DELETE FROM ${KG_EDGES_TABLE}
            WHERE rowid NOT IN (
              SELECT rowid FROM (
                SELECT rowid,
                       ROW_NUMBER() OVER (
                         PARTITION BY from_id, to_id, edge_type, COALESCE(domain, '')
                         ORDER BY created_at ASC, edge_id ASC
                       ) AS rn
                FROM ${KG_EDGES_TABLE}
              )
              WHERE rn = 1
            )`,
          function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve(this.changes ?? 0);
          }
        );
      });
    });

    await this.ensureUniqueIndex();
    logger.info('kg_edges 去重完成', {
      duplicateGroups: groups,
      removed,
      indexReady: this.uniqueIndexReady,
    });
    return { groups, removed, indexReady: this.uniqueIndexReady };
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
   *
   * D3/M1：删除前**自动记录墓碑**，从而保证"人工删除的边不被自动流程加回"这一约束
   * 落在数据层（任何调用方都不会漏写墓碑）。自动清理请改用 `deleteEdgesByEndpoints`
   * （它刻意不写墓碑）。
   */
  async deleteEdge(id: string): Promise<void> {
    if (!this.db) await this.init();

    const existing = await this.getEdge(id);
    if (existing) {
      await this.tombstoneEdges([
        {
          from: existing.from,
          to: existing.to,
          type: existing.type,
          domain: existing.domain,
        },
      ]);
    }

    await this.hardDeleteEdge(id);

    if (existing) {
      // D5：删除审计保留完整快照 → 支撑"撤销删除"逐字段恢复
      await this.recordAudit({
        edgeId: id,
        action: 'delete',
        origin: 'manual',
        before: existing,
      });
    }
  }

  /**
   * 按关系类型批量删除（D4 存量边处置：逐类型处置的落地）
   *
   * 逐条走 `deleteEdge` → 每条边都会写入**墓碑 + 审计**，与单条删除语义完全一致：
   * 可逐条撤销（D5），且不会被后续自动抽取加回（D3 墓碑）。
   *
   * 安全约束：
   * - `type` 必须非空（**不提供"删除全部"入口**，避免误操作放大到整库）
   * - 条数上限 `MAX_DELETE_BY_TYPE`，超限直接拒绝并提示分批
   *
   * @returns 实际删除条数
   */
  async deleteEdgesByType(type: string, domain?: string): Promise<number> {
    if (!this.db) await this.init();

    const MAX_DELETE_BY_TYPE = 2000;
    const targetType = type.trim();
    if (!targetType) {
      throw new AppError(
        '删除类型不能为空',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_EMPTY_EDGE_TYPE',
        { module: 'knowledge:graph' }
      );
    }

    const edges = await this.queryEdges({ type: targetType, domain });
    if (edges.length > MAX_DELETE_BY_TYPE) {
      throw new AppError(
        `该类型共 ${edges.length} 条边，超过单次上限 ${MAX_DELETE_BY_TYPE}，请分批处理`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_BULK_DELETE_TOO_LARGE',
        { module: 'knowledge:graph' }
      );
    }

    for (const edge of edges) {
      await this.deleteEdge(edge.id);
    }

    logger.info('按类型批量删除完成', {
      type: targetType,
      domain: domain ?? null,
      deleted: edges.length,
    });
    return edges.length;
  }

  /**
   * 合并实体（O15）：把 `fromId` 的全部关系改指到 `intoId`，并删除 `fromId` 节点
   *
   * 背景：历史端点 ID 存在多种形态（裸 slug / `prefix:slug` / 三段式 `{domain}:{kind}:{slug}`），
   * 同一实体可能被写成两个 ID（实测真实库有 4 组这样的分裂，如 `plan` 与 `pdca:plan`）。
   * 本方法提供**用户可控**的修复手段（不依赖重扫）。
   *
   * 语义与安全：
   * - 改指后若与既有边**同自然键**（D8：`from+to+type+domain`）→ 判为重复，**删除被并入的那条**
   *   （合并的正确语义是"重复关系只留一条"），避免违反唯一索引；删除同样写墓碑 + 审计
   * - 每条改指 / 去重都写 `kg_edge_audit`（含 `note` 标明合并方向），可**逐条撤销**
   * - `intoId` 必须已存在（不隐性创建）；`fromId === intoId` 拒绝
   * - 分批取边（单次上限 1000，带轮次上限防死循环）
   *
   * @returns `{ repointed, deduped }` 改指条数 / 因重复被删除条数
   */
  async mergeNodes(
    fromId: string,
    intoId: string
  ): Promise<{ repointed: number; deduped: number }> {
    if (!this.db) await this.init();

    const from = fromId?.trim();
    const into = intoId?.trim();
    if (!from || !into) {
      throw new AppError(
        '合并需要 from 与 into 两个实体 ID',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_MERGE_INVALID',
        { module: 'knowledge:graph' }
      );
    }
    if (from === into) {
      throw new AppError(
        '不能把实体合并到自身',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_MERGE_SELF',
        { module: 'knowledge:graph' }
      );
    }
    if (!(await this.getNode(into))) {
      throw new AppError(
        `目标实体不存在：${into}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_MERGE_TARGET_MISSING',
        { module: 'knowledge:graph' }
      );
    }
    if (!(await this.getNode(from))) {
      throw new AppError(
        `源实体不存在：${from}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_MERGE_SOURCE_MISSING',
        { module: 'knowledge:graph' }
      );
    }

    const MAX_ROUNDS = 100;
    const BATCH = 1000;
    let repointed = 0;
    let deduped = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const batch = await this.queryEdges({
        entityId: from,
        direction: 'both',
        limit: BATCH,
      });
      if (batch.length === 0) break;

      for (const edge of batch) {
        const newFrom = edge.from === from ? into : edge.from;
        const newTo = edge.to === from ? into : edge.to;
        const existing = await this.findEdgeByKey({
          from: newFrom,
          to: newTo,
          type: edge.type,
          domain: edge.domain,
        });

        if (existing && existing.id !== edge.id) {
          // 改指后与既有边同自然键 → 重复关系：删除被并入的那条（墓碑 + 审计一并写入）
          await this.deleteEdge(edge.id);
          deduped += 1;
          continue;
        }

        await this.repointEdge(edge.id, newFrom, newTo);
        await this.recordAudit({
          edgeId: edge.id,
          action: 'update',
          origin: 'manual',
          before: { from: edge.from, to: edge.to },
          after: { from: newFrom, to: newTo },
          note: `合并实体：${from} → ${into}`,
        });
        repointed += 1;
      }
    }

    await this.deleteNode(from);
    logger.info('实体合并完成', { from, into, repointed, deduped });
    return { repointed, deduped };
  }

  /** 改指一条边的端点（O15；仅供 `mergeNodes` 使用，务必配合 `recordAudit`） */
  private async repointEdge(
    edgeId: string,
    from: string,
    to: string
  ): Promise<void> {
    await this.dbMutex.run<void>(() => {
      return new Promise<void>((resolve, reject) => {
        this.db!.run(
          `UPDATE ${KG_EDGES_TABLE}
              SET from_id = ?, to_id = ?, updated_at = ?
            WHERE edge_id = ?`,
          [from, to, Date.now(), edgeId],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    });
  }

  /**
   * 更新一条边（B3）
   *
   * - 仅允许改 `type` / `direction` / `attributes`；`from`/`to`/`domain` 属**身份字段**（改身份 = 删旧建新）
   * - `attributes` 为**合并**语义（保留未提及的键）
   * - schema 约束与 `addEdge` 同源：type 不在白名单 → 抛 `KG_INVALID_EDGE_TYPE`
   *
   * @returns 更新后的边；id 不存在 → null
   */
  async updateEdge(
    id: string,
    patch: {
      type?: string;
      direction?: 'directed' | 'symmetric';
      attributes?: Record<string, unknown>;
    }
  ): Promise<Edge | null> {
    if (!this.db) await this.init();

    const existing = await this.getEdge(id);
    if (!existing) return null;

    await this.ensureSchemaLoaded();

    if (patch.type && this.edgeSchemas && this.edgeSchemas.size > 0) {
      if (!this.edgeSchemas.has(patch.type)) {
        const knownTypes = Array.from(this.edgeSchemas.keys()).join(', ');
        throw new AppError(
          `未知的关系类型 "${patch.type}"，已知类型: ${knownTypes}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'KG_INVALID_EDGE_TYPE',
          { module: 'KnowledgeGraph' }
        );
      }
    }

    const nextType = patch.type ?? existing.type;
    // D3/M1：人工改过的边标记为 manual（合并语义不变，但人工意图优先于既有 source）
    const nextAttributes = {
      ...existing.attributes,
      ...(patch.attributes ?? {}),
      source: 'manual',
    };

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `UPDATE ${KG_EDGES_TABLE}
              SET edge_type = ?, direction = ?, attributes = ?, updated_at = ?
            WHERE edge_id = ?`,
          [
            nextType,
            patch.direction ?? existing.direction,
            JSON.stringify(nextAttributes),
            Date.now(),
            id,
          ],
          (err: Error | null) => {
            if (!err) {
              resolve();
              return;
            }
            // 唯一索引冲突（改成与既有边相同的 (from,to,type,domain)）→ 归为调用方错误（400）
            reject(
              new AppError(
                `更新失败：已存在同 (from,to,type,domain) 的边（${err.message}）`,
                ErrorCategory.VALIDATION,
                ErrorSeverity.HIGH,
                'KG_EDGE_UPDATE_CONFLICT',
                { module: 'KnowledgeGraph' }
              )
            );
          }
        );
      });
    });

    const updated = await this.getEdge(id);

    // D5：记录 before/after 快照 → 支撑"撤销修改"
    await this.recordAudit({
      edgeId: id,
      action: 'update',
      origin: 'manual',
      before: existing,
      after: updated,
    });

    return updated;
  }

  // ─── D5：审计与撤销 ───────────────────────────────────────────────

  /** 追加一条审计（append-only；审计失败只告警，不阻断业务写入） */
  private async recordAudit(entry: {
    edgeId?: string;
    action: EdgeAuditAction;
    origin: 'manual' | 'auto';
    before?: unknown;
    after?: unknown;
    note?: string;
  }): Promise<void> {
    if (!this.db) return;
    try {
      await this.dbMutex.run<void>(() => {
        return new Promise((resolve, reject) => {
          this.db!.run(
            `INSERT INTO ${KG_EDGE_AUDIT_TABLE}
              (audit_id, edge_id, action, origin, before_json, after_json, actor, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `audit_${randomUUID()}`,
              entry.edgeId ?? null,
              entry.action,
              entry.origin,
              entry.before === undefined ? null : JSON.stringify(entry.before),
              entry.after === undefined ? null : JSON.stringify(entry.after),
              'local',
              entry.note ?? null,
              Date.now(),
            ],
            (err: Error | null) => (err ? reject(err) : resolve())
          );
        });
      });
    } catch (err) {
      logger.warning('审计写入失败（不影响业务写入）', {
        error: err instanceof Error ? err.message : String(err),
        action: entry.action,
      });
    }
  }

  /** 审计查询（按边 ID 或全局；最新在前） */
  async listAudit(
    filters: { edgeId?: string; limit?: number } = {}
  ): Promise<EdgeAuditEntry[]> {
    if (!this.db) await this.init();

    const limit = Math.min(Math.max(1, filters.limit ?? 100), 500);
    const where = filters.edgeId ? 'WHERE edge_id = ?' : '';
    const params: unknown[] = filters.edgeId
      ? [filters.edgeId, limit]
      : [limit];

    const rows = await new Promise<Array<Record<string, unknown>>>(
      (resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${KG_EDGE_AUDIT_TABLE} ${where}
            ORDER BY created_at DESC, audit_id DESC LIMIT ?`,
          params,
          (err: Error | null, result: Array<Record<string, unknown>>) =>
            err ? reject(err) : resolve(result ?? [])
        );
      }
    );

    return rows.map((r) => ({
      auditId: String(r.audit_id),
      edgeId: r.edge_id ? String(r.edge_id) : undefined,
      action: String(r.action) as EdgeAuditAction,
      origin: String(r.origin) === 'auto' ? 'auto' : 'manual',
      before: r.before_json ? JSON.parse(String(r.before_json)) : undefined,
      after: r.after_json ? JSON.parse(String(r.after_json)) : undefined,
      actor: String(r.actor ?? 'local'),
      note: r.note ? String(r.note) : undefined,
      createdAt: Number(r.created_at),
    }));
  }

  /** 删除一条边（内部：不写墓碑/审计；供撤销、回滚等场景复用） */
  private async hardDeleteEdge(id: string): Promise<void> {
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${KG_EDGES_TABLE} WHERE edge_id = ?`,
          [id],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    });
  }

  /** 以原快照回写边（撤销删除用；逐字段保真） */
  private async restoreEdgeSnapshot(edge: Edge): Promise<void> {
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `INSERT OR REPLACE INTO ${KG_EDGES_TABLE}
             (edge_id, from_id, to_id, edge_type, direction, domain, attributes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            edge.id,
            edge.from,
            edge.to,
            edge.type,
            edge.direction,
            edge.domain ?? '',
            JSON.stringify(edge.attributes ?? {}),
            edge.createdAt,
            Date.now(),
          ],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    });
  }

  /**
   * 撤销一条审计记录（D5）
   *
   * - `create` → 删除该边（**不写墓碑**：撤销是"改主意"，不等于"永久拒绝自动回填"）
   * - `update` → 回滚到 `before` 快照
   * - `delete` → 从 `before` 快照恢复，并**清除墓碑**（这是"墓碑可恢复"的入口）
   * - `cleanup` / `import` / `undo` → 不支持撤销（抛 VALIDATION）
   *
   * @returns 结果描述（供前端提示）
   */
  async undoAudit(auditId: string): Promise<{
    action: EdgeAuditAction;
    edgeId?: string;
    message: string;
  }> {
    if (!this.db) await this.init();

    const entries = await this.listAudit({ limit: 500 });
    const entry = entries.find((e) => e.auditId === auditId);
    if (!entry) {
      throw new AppError(
        `审计记录不存在：${auditId}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'KG_AUDIT_NOT_FOUND',
        { module: 'KnowledgeGraph' }
      );
    }

    if (entry.action === 'create' && entry.edgeId) {
      const current = await this.getEdge(entry.edgeId);
      if (current) await this.hardDeleteEdge(entry.edgeId);
      await this.recordAudit({
        edgeId: entry.edgeId,
        action: 'undo',
        origin: 'manual',
        note: `撤销新增 ${auditId}`,
      });
      return {
        action: 'create',
        edgeId: entry.edgeId,
        message: '已撤销新增：该关系已删除（未锁定墓碑，后续编译仍可重建）',
      };
    }

    if (entry.action === 'update' && entry.edgeId && entry.before) {
      const before = entry.before as Edge;
      await this.dbMutex.run<void>(() => {
        return new Promise((resolve, reject) => {
          this.db!.run(
            `UPDATE ${KG_EDGES_TABLE}
                SET edge_type = ?, direction = ?, attributes = ?, updated_at = ?
              WHERE edge_id = ?`,
            [
              before.type,
              before.direction,
              JSON.stringify(before.attributes ?? {}),
              Date.now(),
              entry.edgeId,
            ],
            (err: Error | null) => (err ? reject(err) : resolve())
          );
        });
      });
      await this.recordAudit({
        edgeId: entry.edgeId,
        action: 'undo',
        origin: 'manual',
        note: `撤销修改 ${auditId}`,
      });
      return {
        action: 'update',
        edgeId: entry.edgeId,
        message: '已回滚到修改前的内容',
      };
    }

    if (entry.action === 'delete' && entry.before) {
      const snapshot = entry.before as Edge;
      await this.restoreEdgeSnapshot(snapshot);
      await this.clearTombstone({
        from: snapshot.from,
        to: snapshot.to,
        type: snapshot.type,
        domain: snapshot.domain,
      });
      await this.recordAudit({
        edgeId: snapshot.id,
        action: 'undo',
        origin: 'manual',
        note: `撤销删除 ${auditId}`,
      });
      return {
        action: 'delete',
        edgeId: snapshot.id,
        message: '已恢复该关系，并解除墓碑锁定',
      };
    }

    throw new AppError(
      `该操作不支持撤销：${entry.action}`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'KG_AUDIT_NOT_UNDOABLE',
      { module: 'KnowledgeGraph' }
    );
  }

  /** 该边键是否有人工删除墓碑（D3/M1） */
  async isEdgeTombstoned(k: {
    from: string;
    to: string;
    type: string;
    domain?: string;
  }): Promise<boolean> {
    if (!this.db) await this.init();
    const row = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        this.db!.get(
          `SELECT 1 AS hit FROM ${KG_EDGE_TOMBSTONES_TABLE}
            WHERE from_id = ? AND to_id = ? AND edge_type = ? AND domain = ?
            LIMIT 1`,
          [k.from, k.to, k.type, k.domain ?? ''],
          (err: Error | null, result: Record<string, unknown> | undefined) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
      }
    );
    return !!row;
  }

  /**
   * 批量写入墓碑（人工删除后调用；单条 SQL = 原子）
   * @returns 写入条数
   */
  async tombstoneEdges(
    keys: Array<{ from: string; to: string; type: string; domain?: string }>
  ): Promise<number> {
    if (!this.db) await this.init();
    if (keys.length === 0) return 0;

    const now = Date.now();
    const CHUNK = 150; // 5 参数/行，避开 SQLite 变量上限
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(',');
      const params = chunk.flatMap((k) => [
        k.from,
        k.to,
        k.type,
        k.domain ?? '',
        now,
      ]);
      await this.dbMutex.run<void>(() => {
        return new Promise((resolve, reject) => {
          this.db!.run(
            `INSERT OR REPLACE INTO ${KG_EDGE_TOMBSTONES_TABLE}
             (from_id, to_id, edge_type, domain, deleted_at)
             VALUES ${placeholders}`,
            params,
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });
    }

    logger.info('已记录人工删除墓碑（自动流程将不再加回）', {
      count: keys.length,
    });
    return keys.length;
  }

  /** 清除墓碑（人工显式重加同一条边时调用） */
  async clearTombstone(k: {
    from: string;
    to: string;
    type: string;
    domain?: string;
  }): Promise<void> {
    if (!this.db) await this.init();
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${KG_EDGE_TOMBSTONES_TABLE}
            WHERE from_id = ? AND to_id = ? AND edge_type = ? AND domain = ?`,
          [k.from, k.to, k.type, k.domain ?? ''],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  /**
   * C6 / O1 根因修复：按**端点集合**精确删除失效边
   *
   * 与已废弃的 `cleanupOrphans(validEntityIds)` 的关键区别：
   * - 旧：`from_id NOT IN (白名单) OR to_id NOT IN (白名单)` → 白名单一旦与真实 ID 形态不符，
   *   会把**绝大多数边**判为孤儿（O1 事故根因）；
   * - 新：只删 `from_id`/`to_id` **命中传入集合**的边，传入集合由 lineage 精确推出。
   *
   * @param nodeIds 已失效（无任何文档支撑）的节点 ID
   * @param options.protectManual 默认 true：跳过 `attributes.source='manual'` 的人工边
   * @returns 实际删除条数
   */
  async deleteEdgesByEndpoints(
    nodeIds: string[],
    options: { protectManual?: boolean } = {}
  ): Promise<number> {
    if (!this.db) await this.init();
    if (nodeIds.length === 0) return 0;

    const protectManual = options.protectManual !== false;
    const manualGuard = protectManual
      ? `AND COALESCE(json_extract(attributes, '$.source'), '') <> 'manual'`
      : '';
    let removed = 0;

    const CHUNK = 400;
    for (let i = 0; i < nodeIds.length; i += CHUNK) {
      const chunk = nodeIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      removed += await this.dbMutex.run<number>(() => {
        return new Promise<number>((resolve, reject) => {
          this.db!.run(
            `DELETE FROM ${KG_EDGES_TABLE}
              WHERE (from_id IN (${placeholders}) OR to_id IN (${placeholders}))
              ${manualGuard}`,
            [...chunk, ...chunk],
            function (this: { changes: number }, err: Error | null) {
              if (err) reject(err);
              else resolve(this.changes ?? 0);
            }
          );
        });
      });
    }

    if (removed > 0) {
      logger.info('已按端点精确清理失效边', {
        candidateNodes: nodeIds.length,
        removed,
        protectManual,
      });
      // D5：自动清理留痕（不支持撤销；用于回答"这条边为什么没了"）
      await this.recordAudit({
        action: 'cleanup',
        origin: 'auto',
        note: `lineage 精确清理：候选节点 ${nodeIds.length} 个，删除 ${removed} 条`,
        after: { candidateNodes: nodeIds.length, removed, protectManual },
      });
    }
    return removed;
  }

  /**
   * 列出实体（B3：由边派生 —— distinct 端点 + 度数，节点无独立存储）
   */
  async listEntities(filters: {
    domain?: string;
    limit?: number;
  }): Promise<Array<{ id: string; degree: number }>> {
    if (!this.db) await this.init();

    const where = filters.domain ? 'WHERE domain = ?' : '';
    const whereParams = filters.domain ? [filters.domain] : [];
    const limit = Math.min(Math.max(1, filters.limit ?? 200), 1000);

    const sql = `SELECT id, COUNT(*) AS degree FROM (
        SELECT from_id AS id FROM ${KG_EDGES_TABLE} ${where}
        UNION ALL
        SELECT to_id AS id FROM ${KG_EDGES_TABLE} ${where}
      ) GROUP BY id ORDER BY degree DESC, id ASC LIMIT ?`;

    return new Promise((resolve, reject) => {
      this.db!.all(
        sql,
        [...whereParams, ...whereParams, limit],
        (err: Error | null, rows: Array<Record<string, unknown>>) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(
            (rows ?? []).map((r) => ({
              id: String(r.id),
              degree: Number(r.degree ?? 0),
            }))
          );
        }
      );
    });
  }

  /**
   * 删除实体（B3：= 删除其所有关联边；仅边模型下"实体"没有独立存储）
   *
   * D3/M1：先为全部关联边记墓碑（受 `queryEdges` 上限 1000 约束），再删除。
   * @returns 被删除的边数
   */
  async deleteEntity(id: string): Promise<number> {
    if (!this.db) await this.init();

    // O16：必须用 `both` —— 否则只取到出边，入边会被"静默删除"却没有墓碑与审计
    const related = await this.queryEdges({
      entityId: id,
      direction: 'both',
      limit: 1000,
    });

    await this.tombstoneEdges(
      related.map((e) => ({
        from: e.from,
        to: e.to,
        type: e.type,
        domain: e.domain,
      }))
    );
    // D5：为每条被删边留审计快照（与墓碑同源，可逐条撤销恢复）
    for (const edge of related) {
      await this.recordAudit({
        edgeId: edge.id,
        action: 'delete',
        origin: 'manual',
        before: edge,
        note: `随实体删除：${id}`,
      });
    }

    const removed = await this.dbMutex.run<number>(() => {
      return new Promise<number>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${KG_EDGES_TABLE} WHERE from_id = ? OR to_id = ?`,
          [id, id],
          function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve(this.changes ?? 0);
          }
        );
      });
    });

    // D2：节点表同步删除（否则会留下"幽灵实体"）
    await this.deleteNode(id);

    return removed;
  }

  /**
   * 查询边，支持按实体、方向、类型过滤
   */
  async queryEdges(filters: EdgeQuery): Promise<Edge[]> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: any[] = [];

    // 按实体 ID + 方向过滤
    // O16（2026-09-11 修复）：`both` 必须拼成**带括号的 OR**。原实现把 from_id / to_id
    // 两条条件分别 push，最终被 join(' AND ') 拼成 `from_id = ? AND to_id = ?`
    // → 除自环外**恒空**（"查某节点的全部关系"实际拿不到任何边）。
    if (filters.entityId) {
      if (filters.direction === 'incoming') {
        conditions.push('to_id = ?');
        params.push(filters.entityId);
      } else if (filters.direction === 'both') {
        conditions.push('(from_id = ? OR to_id = ?)');
        params.push(filters.entityId, filters.entityId);
      } else {
        // 缺省语义 = 出边（保持既有行为，避免破坏调用方）
        conditions.push('from_id = ?');
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

    // P1-10：参数化 + 钳制 1..1000（原实现字符串拼接，且 `?limit=-1` 在 SQLite 表示"无限制"）
    const rawLimit = filters.limit;
    const limitClause = rawLimit ? 'LIMIT ?' : '';
    if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
      params.push(Math.min(Math.max(1, Math.floor(rawLimit)), 1000));
    }

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

    // D2：实体口径分两套 ——
    // · totalEntities    = 节点表总数（**含孤立实体**，节点表引入后的新口径）
    // · derivedEntities  = 由边派生的端点数（旧口径，保留供界面标注与回归对比）
    const derivedEntities = await new Promise<number>((resolve, reject) => {
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

    const totalEntities = await this.countNodes();

    return { totalEdges, byType, totalEntities, derivedEntities };
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
   * 从 JSONL 导入边 —— exportJsonl 的对称操作，用于备份回滚
   *
   * 以 edge_id 为主键做 INSERT OR IGNORE：已存在的边不覆盖、不重复插入，
   * 因此对同一份备份重复导入是幂等的。
   *
   * @param jsonl exportJsonl 产出的 JSONL 字符串（每行一条边）
   * @returns imported 实际新增条数；skipped 已存在或无法解析的条数
   */
  async importJsonl(
    jsonl: string
  ): Promise<{ imported: number; skipped: number }> {
    if (!this.db) await this.init();

    const rows: Edge[] = [];
    let skipped = 0;

    for (const line of jsonl.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<Edge>;
        if (!parsed.id || !parsed.from || !parsed.to || !parsed.type) {
          skipped++;
          continue;
        }
        rows.push({
          id: parsed.id,
          from: parsed.from,
          to: parsed.to,
          type: parsed.type,
          direction:
            parsed.direction === 'symmetric' ? 'symmetric' : 'directed',
          domain: parsed.domain ?? '',
          attributes: parsed.attributes ?? {},
          createdAt: parsed.createdAt ?? Date.now(),
          updatedAt: parsed.updatedAt ?? Date.now(),
        });
      } catch {
        // @ignore-catch 单行解析失败计入 skipped，末尾统一告警 ——
        // 不让一行坏数据中断整份备份的恢复
        skipped++;
      }
    }

    if (rows.length === 0) {
      if (skipped > 0) {
        logger.warning('JSONL 导入：无有效边记录', { skipped });
      }
      return { imported: 0, skipped };
    }

    let imported = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        const db = this.db!;
        // P0-3：整体事务（BEGIN IMMEDIATE … COMMIT / ROLLBACK）——
        // 原实现每条一次独立提交，慢且失败时会留下"半份恢复数据"
        const fail = (err: Error): void => {
          db.run('ROLLBACK', () => reject(err));
        };

        db.run('BEGIN IMMEDIATE', (beginErr: Error | null) => {
          if (beginErr) {
            reject(beginErr);
            return;
          }

          let index = 0;
          const insertNext = (): void => {
            if (index >= rows.length) {
              db.run('COMMIT', (commitErr: Error | null) =>
                commitErr ? fail(commitErr) : resolve()
              );
              return;
            }
            const edge = rows[index++];
            db.run(
              `INSERT OR IGNORE INTO ${KG_EDGES_TABLE} (edge_id, from_id, to_id, edge_type, direction, domain, attributes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                edge.id,
                edge.from,
                edge.to,
                edge.type,
                edge.direction,
                edge.domain,
                JSON.stringify(edge.attributes),
                edge.createdAt,
                edge.updatedAt,
              ],
              function (this: { changes: number }, err: Error | null) {
                if (err) {
                  fail(err);
                  return;
                }
                imported += this.changes || 0;
                insertNext();
              }
            );
          };
          insertNext();
        });
      });
    });

    skipped += rows.length - imported;
    logger.info('JSONL 导入完成', { imported, skipped });

    // D2：导入的边同样补建节点（否则"导入"路径会与节点表漂移）
    for (const edge of rows) {
      await this.ensureEdgeEndpointNodes(edge);
    }

    // D5：导入留痕（不支持逐条撤销；批量回滚走 export → import 链路）
    await this.recordAudit({
      action: 'import',
      origin: 'manual',
      note: `JSONL 导入：提交 ${rows.length} 条，新增 ${imported} 条`,
      after: { total: rows.length, imported, skipped },
    });

    return { imported, skipped };
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

  // O15-B（2026-09-11）：**已删除 `generateEntityId()` / `parseEntityId()`**
  // —— 实体 ID 统一为裸 slug，不再承载 domain/kind（kind 归 kg_nodes.kind）；
  //    原先依赖这两者的调用方改为"直接使用 slug + 把 kind 写入实体档案"。

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
