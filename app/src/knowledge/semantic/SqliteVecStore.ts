// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SqliteVecStore — 基于 sqlite-vec 扩展的 IVectorStore 实现
 *
 * 依赖：sqlite-vec (https://github.com/asg017/sqlite-vec)
 * 安装：bun add sqlite-vec
 *
 * sqlite-vec 提供 vec0 虚拟表，支持高效的余弦距离搜索。
 * 相比 JSONL 线性扫描，在大规模数据（>10K 分块）下有数量级性能提升。
 *
 * 启动时自动检测依赖是否可用，不可用时通过 VectorStoreFactory 回退到 JsonlVectorStore。
 *
 * 使用方式：
 *   VECTOR_STORE=sqlite_vec bun run dev
 */

import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { resolveDbPath } from '@modules/core';
import { Database } from '@modules/core/external/sqlite3';
import type { IVectorStore, VectorEntry, SearchHit } from './IVectorStore';
import type { IndexIdentity, IndexMeta } from './store';
import { readIndexMeta, cosineSimilarity } from './store';

const logger = new OTelAwareLogger({
  module: 'knowledge:vector',
  level: LogLevel.INFO,
});

/** 向量表名 */
const VEC_TABLE = 'kb_vectors';
/** 元数据表名 */
const META_TABLE = 'kb_vector_meta';

/** Promise 封装的 db.run */
function dbRun(db: Database, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (params.length > 0) {
      db.run(sql, params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      db.run(sql, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    }
  });
}

/** Promise 封装的 db.all */
function dbAll<T>(
  db: Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/** Promise 封装的 db.get */
function dbGet<T>(
  db: Database,
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T | undefined) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * 将 Float32Array 编码为 sqlite-vec 兼容的 BLOB
 * sqlite-vec 使用 IEEE 754 小端序 float32 数组
 */
function encodeVector(vec: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i]!, i * 4);
  }
  return buf;
}

/** 从 BLOB 解码为 Float32Array */
function decodeVector(buf: Buffer): Float32Array {
  const vec = new Float32Array(buf.length / 4);
  for (let i = 0; i < vec.length; i++) {
    vec[i] = buf.readFloatLE(i * 4);
  }
  return vec;
}

export class SqliteVecStore implements IVectorStore {
  private db: Database | null = null;
  private dbPath: string;
  private indexDir: string;
  private identity: IndexIdentity;
  private dim: number = 0;

  constructor(indexDir: string, identity: IndexIdentity, dbPath?: string) {
    this.indexDir = indexDir;
    this.identity = identity;
    this.dbPath = dbPath ?? resolveDbPath();
  }

  /** 初始化数据库和表（幂等） */
  private async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    // 创建向量表
    // 注意：sqlite-vec 的 vec0 虚拟表需要先加载扩展
    // 如果 sqlite-vec 不可用，此方法会抛出，调用方应 catch 并回退到 JsonlVectorStore
    await dbRun(
      this.db,
      `
      CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(
        id TEXT PRIMARY KEY,
        path TEXT,
        start_line INTEGER,
        end_line INTEGER,
        text TEXT,
        mtime_ms INTEGER,
        embedding FLOAT[768]
      )
    `
    );

    // 创建元数据表
    await dbRun(
      this.db,
      `
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `
    );

    // 创建普通索引加速按路径查询
    await dbRun(
      this.db,
      `CREATE INDEX IF NOT EXISTS idx_vec_path ON ${VEC_TABLE}(path)`
    );
    await dbRun(
      this.db,
      `CREATE INDEX IF NOT EXISTS idx_vec_mtime ON ${VEC_TABLE}(mtime_ms)`
    );

    // 加载元数据
    const dimRow = await dbGet<{ value: string }>(
      this.db,
      `SELECT value FROM ${META_TABLE} WHERE key = 'dim'`
    );
    if (dimRow) {
      this.dim = parseInt(dimRow.value, 10);
    }

    logger.info('SqliteVecStore 初始化完成', { dim: this.dim });
  }

  // ---- IVectorStore 实现 ----

  async upsert(entries: VectorEntry[]): Promise<void> {
    await this.init();
    if (entries.length === 0) return;

    if (this.dim === 0 && entries[0]!.embedding.length > 0) {
      this.dim = entries[0]!.embedding.length;
      await dbRun(
        this.db!,
        `INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES ('dim', ?)`,
        String(this.dim)
      );
    }

    for (const entry of entries) {
      await dbRun(
        this.db!,
        `INSERT OR REPLACE INTO ${VEC_TABLE} (id, path, start_line, end_line, text, mtime_ms, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
        entry.path,
        entry.startLine,
        entry.endLine,
        entry.text,
        entry.mtimeMs,
        encodeVector(entry.embedding)
      );
    }
  }

  async search(
    queryEmbedding: Float32Array,
    topK: number = 10,
    minScore: number = 0.3
  ): Promise<SearchHit[]> {
    await this.init();
    if (this.dim === 0) return [];

    const queryBlob = encodeVector(queryEmbedding);

    // 使用 sqlite-vec 的 vec_distance_cosine + KNN 搜索
    // vec0 表支持 MATCH 操作符进行 KNN 近似搜索
    const rows = await dbAll<Record<string, unknown>>(
      this.db!,
      `SELECT id, path, start_line, end_line, text, mtime_ms,
              1.0 - vec_distance_cosine(embedding, ?) AS score
       FROM ${VEC_TABLE}
       WHERE 1.0 - vec_distance_cosine(embedding, ?) >= ?
       ORDER BY score DESC
       LIMIT ?`,
      queryBlob,
      queryBlob,
      minScore,
      topK
    );

    return rows.map((row) => ({
      entry: {
        id: row.id as string,
        path: row.path as string,
        startLine: row.start_line as number,
        endLine: row.end_line as number,
        text: row.text as string,
        embedding: decodeVector(row.embedding as Buffer),
        mtimeMs: row.mtime_ms as number,
      },
      score: row.score as number,
    }));
  }

  async deleteByPath(path: string): Promise<void> {
    await this.init();
    await dbRun(this.db!, `DELETE FROM ${VEC_TABLE} WHERE path = ?`, path);
  }

  async clear(): Promise<void> {
    await this.init();
    await dbRun(this.db!, `DELETE FROM ${VEC_TABLE}`);
    await dbRun(this.db!, `DELETE FROM ${META_TABLE}`);
    this.dim = 0;
  }

  async count(): Promise<number> {
    await this.init();
    const row = await dbGet<{ cnt: number }>(
      this.db!,
      `SELECT COUNT(*) as cnt FROM ${VEC_TABLE}`
    );
    return row?.cnt ?? 0;
  }

  async getMeta(): Promise<IndexMeta | null> {
    await this.init();
    const dimRow = await dbGet<{ value: string }>(
      this.db!,
      `SELECT value FROM ${META_TABLE} WHERE key = 'dim'`
    );
    const modelRow = await dbGet<{ value: string }>(
      this.db!,
      `SELECT value FROM ${META_TABLE} WHERE key = 'model'`
    );
    const providerRow = await dbGet<{ value: string }>(
      this.db!,
      `SELECT value FROM ${META_TABLE} WHERE key = 'provider'`
    );
    const versionRow = await dbGet<{ value: string }>(
      this.db!,
      `SELECT value FROM ${META_TABLE} WHERE key = 'version'`
    );
    const updatedRow = await dbGet<{ value: string }>(
      this.db!,
      `SELECT value FROM ${META_TABLE} WHERE key = 'updated_at'`
    );

    if (!dimRow) return null;

    return {
      dim: parseInt(dimRow.value, 10),
      model: modelRow?.value ?? this.identity.model,
      provider: providerRow?.value ?? this.identity.provider,
      version: versionRow ? parseInt(versionRow.value, 10) : 1,
      updatedAt: updatedRow?.value ?? new Date().toISOString(),
    };
  }

  async setMeta(meta: IndexMeta): Promise<void> {
    await this.init();
    const kv = [
      ['dim', String(meta.dim)],
      ['model', meta.model],
      ['provider', meta.provider],
      ['version', String(meta.version)],
      ['updated_at', meta.updatedAt],
    ];
    for (const [k, v] of kv) {
      await dbRun(
        this.db!,
        `INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
        k,
        v
      );
    }
    this.dim = meta.dim;
  }

  async getById(id: string): Promise<VectorEntry | null> {
    await this.init();
    const row = await dbGet<Record<string, unknown>>(
      this.db!,
      `SELECT * FROM ${VEC_TABLE} WHERE id = ?`,
      id
    );
    if (!row) return null;

    return {
      id: row.id as string,
      path: row.path as string,
      startLine: row.start_line as number,
      endLine: row.end_line as number,
      text: row.text as string,
      embedding: decodeVector(row.embedding as Buffer),
      mtimeMs: row.mtime_ms as number,
    };
  }
}
