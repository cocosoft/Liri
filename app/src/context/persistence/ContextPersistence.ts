// MIT License
// Copyright (c) 2026 190615273@qq.com
import type { Context } from '../types/Context';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';

const logger = new Logger({
  module: 'context:persistence',
  level: LogLevel.INFO,
});

/** Context 快照 schema 版本 */

/**
 * Schema 版本管理策略（Phase 2.25 冷启动与 Schema）：
 *
 * ── 版本格式 ──
 *   major.minor  (如 "1.0"、"1.1"、"2.0")
 *
 * ── 升级规则 ──
 *   新增可选字段     → minor bump (如 1.0→1.1)，向前兼容，旧代码忽略新字段
 *   删除/重命名字段   → major bump (如 1.x→2.0)，需写 migration 函数
 *   字段语义变更      → major bump
 *
 * ── 反序列化检查 ──
 *   major 不匹配 → validate() 返回 invalid，拒绝加载（提示需 migration）
 *   minor 不匹配 → 兼容加载（忽略未知字段）
 *
 * ── 冷启动 Benchmark ──
 *   当 entries > 1000 条时，应在 CI 中做 I/O benchmark：
 *   目标: 序列化/反序列化 < 200ms
 */
const CURRENT_SCHEMA_VERSION = '1.0';

export interface SerializedContextEntry {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

export interface ContextSnapshot {
  schemaVersion: string;
  createdAt: string;
  entries: SerializedContextEntry[];
  metadata: { totalCount: number; maxSize: number };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 共享的 schema 版本校验逻辑
 * 消除 JSONL 和 SQLite 实现间的代码重复（P3 归一化）
 */
function validateSchemaVersion(snapshot: ContextSnapshot): ValidationResult {
  const errors: string[] = [];

  if (!snapshot.schemaVersion) {
    errors.push('Missing schemaVersion');
  } else {
    const [major] = snapshot.schemaVersion.split('.');
    const [currentMajor] = CURRENT_SCHEMA_VERSION.split('.');
    if (major !== currentMajor) {
      errors.push(
        `Schema major version mismatch: ${snapshot.schemaVersion} (expected ${CURRENT_SCHEMA_VERSION})`
      );
    }
  }

  if (!Array.isArray(snapshot.entries)) {
    errors.push('entries must be an array');
  }

  return { valid: errors.length === 0, errors };
}

export interface ContextPersistence {
  readonly schemaVersion: string;
  save(snapshot: ContextSnapshot): Promise<void>;
  load(): Promise<ContextSnapshot | null>;
  validate(snapshot: ContextSnapshot): ValidationResult;
}

/**
 * JSONL 文件持久化实现
 * 对标 PilotDeck TokenStatsCollector + hermes-agent SessionDB
 */
export class JsonlContextPersistence implements ContextPersistence {
  readonly schemaVersion = CURRENT_SCHEMA_VERSION;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(snapshot: ContextSnapshot): Promise<void> {
    const fs = await import('fs/promises');
    const lines = snapshot.entries.map((e) => JSON.stringify(e));
    await fs.writeFile(this.filePath, lines.join('\n') + '\n', 'utf-8');
    logger.info('persistence:serialize', {
      path: this.filePath,
      count: snapshot.entries.length,
      schemaVersion: snapshot.schemaVersion,
    });
  }

  async load(): Promise<ContextSnapshot | null> {
    const fs = await import('fs/promises');
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      if (!content.trim()) return null;

      const lines = content.trim().split('\n').filter(Boolean);
      const entries: SerializedContextEntry[] = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          logger.warn('persistence:corrupted_line', {
            path: this.filePath,
            line: line.slice(0, 100),
          });
          // 跳过损坏行，继续解析其余数据
        }
      }

      if (entries.length === 0) return null;

      const snapshot: ContextSnapshot = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: entries[0]?.createdAt ?? new Date().toISOString(),
        entries,
        metadata: { totalCount: entries.length, maxSize: 1000 },
      };

      logger.info('persistence:hydrate', {
        path: this.filePath,
        count: entries.length,
        schemaVersion: snapshot.schemaVersion,
      });

      return snapshot;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('persistence:no_file', { path: this.filePath });
        return null;
      }
      await handleError(err, { module: 'context:persist', action: 'load' });
      return null;
    }
  }

  validate(snapshot: ContextSnapshot): ValidationResult {
    return validateSchemaVersion(snapshot);
  }
}

/**
 * 从 StoreEntry Map 序列化为 ContextSnapshot
 */
export function serializeStoreEntries(
  entries: Map<
    string,
    { context: Context; createdAt: Date; updatedAt: Date; ttl?: number }
  >,
  maxSize: number
): ContextSnapshot {
  const serialized: SerializedContextEntry[] = [];

  for (const [id, entry] of entries) {
    serialized.push({
      id,
      type: entry.context.type ?? 'unknown',
      data: entry.context as unknown as Record<string, unknown>,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      ttl: entry.ttl,
    });
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    entries: serialized,
    metadata: { totalCount: entries.size, maxSize },
  };
}

// ============================================================
// SQLite 持久化实现（Phase 2.25 — 升级 JSONL → SQLite + FTS5）
// ============================================================

/** SQLite 持久化扩展能力 */
export interface SqliteContextPersistence extends ContextPersistence {
  /** 增量保存单条 context */
  upsert(entry: SerializedContextEntry): Promise<void>;
  /** 删除单条 context */
  delete(id: string): Promise<void>;
  /** 按类型查询 */
  findByType(type: string, limit?: number): Promise<SerializedContextEntry[]>;
  /** 全文搜索（FTS5） */
  search(query: string, limit?: number): Promise<SerializedContextEntry[]>;
  /** 按会话查询 */
  findBySession(sessionId: string): Promise<SerializedContextEntry[]>;
  /** 获取统计信息 */
  stats(): Promise<{
    totalEntries: number;
    totalSizeBytes: number;
    typeCounts: Record<string, number>;
  }>;
  /** 清理过期条目（基于 TTL），返回清理数量 */
  cleanupStale(): Promise<number>;
}

const CTX_TABLE = 'context_entries';
const CTX_FTS = 'context_entries_fts';

/**
 * SQLite 上下文持久化实现
 * 对标 hermes-agent SessionDB + FTS5 全文搜索
 */
export class SqliteContextPersistenceImpl implements SqliteContextPersistence {
  readonly schemaVersion = CURRENT_SCHEMA_VERSION;
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  private getDb(): Database {
    if (!this.db) {
      this.db = new Database(this.dbPath);
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const db = this.getDb();

    // 主表
    await this.runAsync(
      db,
      `
      CREATE TABLE IF NOT EXISTS ${CTX_TABLE} (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        ttl         INTEGER,
        session_id  TEXT,
        size_bytes  INTEGER DEFAULT 0
      )
    `
    );

    // 索引
    await this.runAsync(
      db,
      `CREATE INDEX IF NOT EXISTS idx_ctx_type ON ${CTX_TABLE}(type)`
    );
    await this.runAsync(
      db,
      `CREATE INDEX IF NOT EXISTS idx_ctx_session ON ${CTX_TABLE}(session_id)`
    );
    await this.runAsync(
      db,
      `CREATE INDEX IF NOT EXISTS idx_ctx_updated ON ${CTX_TABLE}(updated_at)`
    );

    // FTS5 全文搜索虚拟表
    try {
      await this.runAsync(
        db,
        `
        CREATE VIRTUAL TABLE IF NOT EXISTS ${CTX_FTS} USING fts5(
          id UNINDEXED,
          type,
          content
        )
      `
      );
    } catch {
      // FTS5 可能不被某些 SQLite 编译支持，降级运行
      logger.warn('FTS5 不可用，全文搜索将不可用');
    }

    // 触发器：保持 FTS 与主表同步
    try {
      await this.runAsync(
        db,
        `
        CREATE TRIGGER IF NOT EXISTS ctx_fts_ai AFTER INSERT ON ${CTX_TABLE}
        BEGIN
          INSERT INTO ${CTX_FTS}(id, type, content)
          VALUES (new.id, new.type, json_extract(new.data, '$.content'));
        END
      `
      );
      await this.runAsync(
        db,
        `
        CREATE TRIGGER IF NOT EXISTS ctx_fts_ad AFTER DELETE ON ${CTX_TABLE}
        BEGIN
          DELETE FROM ${CTX_FTS} WHERE id = old.id;
        END
      `
      );
      await this.runAsync(
        db,
        `
        CREATE TRIGGER IF NOT EXISTS ctx_fts_au AFTER UPDATE ON ${CTX_TABLE}
        BEGIN
          UPDATE ${CTX_FTS}
          SET type = new.type,
              content = json_extract(new.data, '$.content')
          WHERE id = old.id;
        END
      `
      );
    } catch {
      // @ignore-catch: FTS trigger non-critical
    }

    this.initialized = true;
    logger.info('SqliteContextPersistence 初始化完成', { path: this.dbPath });
  }

  // === ContextPersistence 接口实现 ===

  async save(snapshot: ContextSnapshot): Promise<void> {
    await this.initialize();

    const db = this.getDb();
    await this.runAsync(db, 'BEGIN TRANSACTION');
    try {
      // 增量 upsert：使用 ON CONFLICT DO UPDATE 替代 DELETE+INSERT（P3 优化）
      // 旧条目由 cleanupStale() 按 TTL 清理，无需全量 DELETE
      for (const entry of snapshot.entries) {
        const dataJson = JSON.stringify(entry.data);
        await this.runAsync(
          db,
          `
          INSERT INTO ${CTX_TABLE} (id, type, data, created_at, updated_at, ttl, session_id, size_bytes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            data = excluded.data,
            updated_at = excluded.updated_at,
            ttl = excluded.ttl,
            session_id = excluded.session_id,
            size_bytes = excluded.size_bytes
        `,
          [
            entry.id,
            entry.type,
            dataJson,
            entry.createdAt,
            entry.updatedAt,
            entry.ttl ?? null,
            ((entry.data as Record<string, unknown>).sessionId as
              | string
              | undefined) ?? null,
            Buffer.byteLength(dataJson, 'utf-8'),
          ]
        );
      }

      await this.runAsync(db, 'COMMIT');
      logger.info('persistence:serialize_sqlite', {
        count: snapshot.entries.length,
        schemaVersion: snapshot.schemaVersion,
      });
    } catch (err) {
      await this.runAsync(db, 'ROLLBACK');
      throw err;
    }
  }

  async load(): Promise<ContextSnapshot | null> {
    await this.initialize();

    const db = this.getDb();
    try {
      const rows = await this.allAsync<{
        id: string;
        type: string;
        data: string;
        created_at: string;
        updated_at: string;
        ttl: number | null;
      }>(
        db,
        `SELECT id, type, data, created_at, updated_at, ttl FROM ${CTX_TABLE} ORDER BY created_at`
      );

      if (rows.length === 0) return null;

      const entries: SerializedContextEntry[] = rows.map((row) => ({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ttl: row.ttl ?? undefined,
      }));

      const snapshot: ContextSnapshot = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: entries[0]?.createdAt ?? new Date().toISOString(),
        entries,
        metadata: { totalCount: entries.length, maxSize: 1000 },
      };

      logger.info('persistence:hydrate_sqlite', {
        count: entries.length,
        schemaVersion: snapshot.schemaVersion,
      });

      return snapshot;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await handleError(err, {
        module: 'context:persist',
        action: 'load_sqlite',
      });
      return null;
    }
  }

  validate(snapshot: ContextSnapshot): ValidationResult {
    return validateSchemaVersion(snapshot);
  }

  // === SqliteContextPersistence 扩展方法 ===

  async upsert(entry: SerializedContextEntry): Promise<void> {
    await this.initialize();
    const db = this.getDb();
    const dataJson = JSON.stringify(entry.data);
    const sessionId = (entry.data as Record<string, unknown>).sessionId as
      | string
      | undefined;
    const sizeBytes = Buffer.byteLength(dataJson, 'utf-8');

    await this.runAsync(
      db,
      `
      INSERT INTO ${CTX_TABLE} (id, type, data, created_at, updated_at, ttl, session_id, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        data = excluded.data,
        updated_at = excluded.updated_at,
        ttl = excluded.ttl,
        session_id = excluded.session_id,
        size_bytes = excluded.size_bytes
    `,
      [
        entry.id,
        entry.type,
        dataJson,
        entry.createdAt,
        entry.updatedAt,
        entry.ttl ?? null,
        sessionId ?? null,
        sizeBytes,
      ]
    );
  }

  async delete(id: string): Promise<void> {
    await this.initialize();
    const db = this.getDb();
    await this.runAsync(db, `DELETE FROM ${CTX_TABLE} WHERE id = ?`, [id]);
  }

  async findByType(
    type: string,
    limit = 50
  ): Promise<SerializedContextEntry[]> {
    await this.initialize();
    const db = this.getDb();
    const rows = await this.allAsync<{
      id: string;
      type: string;
      data: string;
      created_at: string;
      updated_at: string;
      ttl: number | null;
    }>(
      db,
      `SELECT id, type, data, created_at, updated_at, ttl FROM ${CTX_TABLE} WHERE type = ? ORDER BY updated_at DESC LIMIT ?`,
      [type, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ttl: row.ttl ?? undefined,
    }));
  }

  async search(query: string, limit = 20): Promise<SerializedContextEntry[]> {
    await this.initialize();
    const db = this.getDb();
    try {
      const rows = await this.allAsync<{ id: string }>(
        db,
        `SELECT id FROM ${CTX_FTS} WHERE ${CTX_FTS} MATCH ? LIMIT ?`,
        [query, limit]
      );
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const entries = await this.allAsync<{
        id: string;
        type: string;
        data: string;
        created_at: string;
        updated_at: string;
        ttl: number | null;
      }>(
        db,
        `SELECT id, type, data, created_at, updated_at, ttl FROM ${CTX_TABLE} WHERE id IN (${placeholders})`,
        ids
      );

      return entries.map((row) => ({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ttl: row.ttl ?? undefined,
      }));
    } catch {
      // FTS5 不可用时降级
      return [];
    }
  }

  async findBySession(sessionId: string): Promise<SerializedContextEntry[]> {
    await this.initialize();
    const db = this.getDb();
    const rows = await this.allAsync<{
      id: string;
      type: string;
      data: string;
      created_at: string;
      updated_at: string;
      ttl: number | null;
    }>(
      db,
      `SELECT id, type, data, created_at, updated_at, ttl FROM ${CTX_TABLE} WHERE session_id = ? ORDER BY created_at`,
      [sessionId]
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ttl: row.ttl ?? undefined,
    }));
  }

  async stats(): Promise<{
    totalEntries: number;
    totalSizeBytes: number;
    typeCounts: Record<string, number>;
  }> {
    await this.initialize();
    const db = this.getDb();

    const countRow = await this.getAsync<{ cnt: number; totalBytes: number }>(
      db,
      `SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as totalBytes FROM ${CTX_TABLE}`
    );

    const typeRows = await this.allAsync<{ type: string; cnt: number }>(
      db,
      `SELECT type, COUNT(*) as cnt FROM ${CTX_TABLE} GROUP BY type`
    );

    const typeCounts: Record<string, number> = {};
    for (const r of typeRows) {
      typeCounts[r.type] = r.cnt;
    }

    return {
      totalEntries: countRow?.cnt ?? 0,
      totalSizeBytes: countRow?.totalBytes ?? 0,
      typeCounts,
    };
  }

  /**
   * 清理过期条目（基于 TTL）
   * TTL 过期条件：created_at + (ttl / 1000) 秒 < 当前时间
   * @returns 实际清理的条目数
   */
  async cleanupStale(): Promise<number> {
    await this.initialize();
    const db = this.getDb();
    try {
      const now = new Date().toISOString();
      await this.runAsync(
        db,
        `DELETE FROM ${CTX_TABLE} WHERE ttl IS NOT NULL AND ttl > 0 AND datetime(created_at, '+' || (ttl / 1000) || ' seconds') < ?`,
        [now]
      );
      const changes = (db as unknown as { changes?: number }).changes ?? 0;
      if (changes > 0) {
        logger.info('persistence:cleanup_stale', { count: changes });
      }
      return changes;
    } catch (err) {
      await handleError(err, {
        module: 'context:persist',
        action: 'cleanup_stale',
      });
      return 0;
    }
  }

  /** Promise 化 db.run */
  private runAsync(
    db: Database,
    sql: string,
    params: unknown[] = []
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Promise 化 db.all */
  private allAsync<T>(
    db: Database,
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      db.all(sql, params, (err: Error | null, rows: T[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /** Promise 化 db.get */
  private getAsync<T>(
    db: Database,
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      db.get(sql, params, (err: Error | null, row: T | undefined) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
}
