/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译历史持久化存储
 *
 * 使用 SQLite translate_history 表，存储于 app.db。
 * 支持关键词搜索、收藏标星、批量删除。
 *
 * 租户级 DB（基础设施专项 §6.1 / §1.5，2026-10-24 补齐）：库按**租户**分
 * （`tenants/<t>/app.db`），租户内按 `owner_key`（`<tenant>:<user>`）行级隔离 ——
 * 翻译历史是用户级业务数据，此前落在共享本地库且无归属列，租户内两用户会互相看见/覆盖。
 */

import { Database } from '@modules/external';
import { randomUUID } from 'crypto';
import { resolveDbPath, resolveTenantDbPath } from '@modules/environment';
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '../../error/handleError';
import type {
  TranslateHistoryRecord,
  TranslateHistoryQuery,
  TranslateHistoryPage,
} from './types';

const TRANSLATE_HISTORY_TABLE_NAME = 'translate_history';
const logger = getLogger('ai:translation:history');

/** sqlite3 `run()` 回调中的 this 上下文 */
interface SqliteRunContext {
  changes: number;
}

export class TranslateHistoryStore {
  private static instance: TranslateHistoryStore;
  /** 租户级实例缓存（键 = `tenantId`；同租户共用连接，按 `owner_key` 行级隔离） */
  private static scopedInstances = new Map<string, TranslateHistoryStore>();
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入，如 `':memory:'`） */
  private static explicitInstances = new Map<string, TranslateHistoryStore>();

  static getInstance(dbPath?: string): TranslateHistoryStore {
    // 2026-10-24：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例 ——
    // 原"首次创建后忽略入参"会让 `:memory:` 在默认单例已存在时拿到真实 `app.db`。
    if (dbPath !== undefined) {
      const existing = TranslateHistoryStore.explicitInstances.get(dbPath);
      if (existing) return existing;
      const created = new TranslateHistoryStore(dbPath);
      TranslateHistoryStore.explicitInstances.set(dbPath, created);
      return created;
    }
    const principal = getRequestPrincipal();
    if (!isLocalPrincipal(principal)) {
      const key = principal.tenantId;
      const existing = TranslateHistoryStore.scopedInstances.get(key);
      if (existing) return existing;
      const scoped = new TranslateHistoryStore(resolveTenantDbPath(principal));
      TranslateHistoryStore.scopedInstances.set(key, scoped);
      // 删租户 / 退出时释放句柄并摘除缓存（否则 Windows 上 tenants/<t> 删不掉）
      registerScopedResource(principalKeyOf(principal), () => {
        scoped.close();
        TranslateHistoryStore.scopedInstances.delete(key);
      });
      return scoped;
    }
    if (!TranslateHistoryStore.instance) {
      TranslateHistoryStore.instance = new TranslateHistoryStore(dbPath);
    }
    return TranslateHistoryStore.instance;
  }

  /** 当前身份归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /** 关闭连接（幂等；租户 closer / 测试使用） */
  close(): void {
    try {
      this.db?.close();
    } catch {
      // 已关闭 / 关闭中：忽略
    }
    this.db = null;
    this.initialized = false;
    this.initPromise = null;
  }

  /** 仅测试：关掉并清空租户级实例缓存（**生产不调用**） */
  static resetScopedForTest(): void {
    for (const store of TranslateHistoryStore.scopedInstances.values()) {
      store.close();
    }
    TranslateHistoryStore.scopedInstances.clear();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err: Error | null) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTable();
      await this.migrateStarredColumn();
      await this.migrateOwnerColumn();
      this.initialized = true;
      this.initPromise = null;
      logger.info('翻译历史存储初始化完成');
    })();

    return this.initPromise;
  }

  private async createTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${TRANSLATE_HISTORY_TABLE_NAME} (
          id              TEXT PRIMARY KEY,
          owner_key       TEXT NOT NULL DEFAULT 'local:local',
          group_id        TEXT NOT NULL,
          source_text     TEXT NOT NULL,
          translated_text TEXT NOT NULL,
          source_lang     TEXT NOT NULL,
          target_lang     TEXT NOT NULL,
          model           TEXT NOT NULL,
          duration_ms     INTEGER NOT NULL DEFAULT 0,
          usage_json      TEXT,
          starred         INTEGER NOT NULL DEFAULT 0,
          created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 创建索引
    await new Promise<void>((resolve) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_translate_history_group ON ${TRANSLATE_HISTORY_TABLE_NAME}(group_id)`,
        () => resolve()
      );
    });

    await new Promise<void>((resolve) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_translate_history_created ON ${TRANSLATE_HISTORY_TABLE_NAME}(created_at DESC)`,
        () => resolve()
      );
    });

    // 归属列走索引：分页查询以 `owner_key` 起手过滤
    await new Promise<void>((resolve) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_translate_history_owner_created ON ${TRANSLATE_HISTORY_TABLE_NAME}(owner_key, created_at DESC)`,
        () => resolve()
      );
    });
  }

  /** 兼容旧表：添加 starred 列 */
  private async migrateStarredColumn(): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        this.db!.run(
          `ALTER TABLE ${TRANSLATE_HISTORY_TABLE_NAME} ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`,
          () => resolve()
        );
      });
    } catch (err) {
      // 列已存在时忽略错误
    }
  }

  /**
   * 兼容旧表：补 `owner_key` 列（存量行落默认 `local:local`，与本地身份一致）。
   *
   * 注意：SQLite 的 `ALTER TABLE` 不能改主键，故旧库仍是 `id` 单列 PK；
   * 本地库只有 `local:local` 一种归属 ⇒ 不会与租户行碰撞。
   */
  private async migrateOwnerColumn(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${TRANSLATE_HISTORY_TABLE_NAME} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => {
          if (err && !/duplicate column/i.test(err.message)) {
            logger.warn('translate_history 补 owner_key 失败', {
              error: err.message,
            });
          }
          resolve();
        }
      );
    });
  }

  /**
   * 插入一条翻译记录
   */
  async insert(
    record: Omit<TranslateHistoryRecord, 'id' | 'createdAt' | 'starred'>
  ): Promise<string> {
    await this.initialize();

    const id = randomUUID();
    const createdAt = Math.floor(Date.now() / 1000);

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `INSERT INTO ${TRANSLATE_HISTORY_TABLE_NAME} (id, owner_key, group_id, source_text, translated_text, source_lang, target_lang, model, duration_ms, usage_json, starred, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          id,
          this.owner(),
          record.groupId,
          record.sourceText,
          record.translatedText,
          record.sourceLang,
          record.targetLang,
          record.model,
          record.durationMs,
          record.usageJson,
          createdAt,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    return id;
  }

  /**
   * 分页查询翻译历史（支持搜索、收藏筛选）
   */
  async query(params: TranslateHistoryQuery): Promise<TranslateHistoryPage> {
    await this.initialize();

    const page = params.page || 1;
    const pageSize = Math.min(params.pageSize || 20, 100);
    const offset = (page - 1) * pageSize;

    // 归属过滤**必须**是第一个条件（漏掉即租户内跨用户越权）
    const conditions: string[] = ['owner_key = ?'];
    const bindParams: unknown[] = [this.owner()];

    if (params.sourceLang) {
      conditions.push('source_lang = ?');
      bindParams.push(params.sourceLang);
    }
    if (params.targetLang) {
      conditions.push('target_lang = ?');
      bindParams.push(params.targetLang);
    }
    if (params.search) {
      conditions.push('(source_text LIKE ? OR translated_text LIKE ?)');
      const pattern = `%${params.search}%`;
      bindParams.push(pattern, pattern);
    }
    if (params.starred) {
      conditions.push('starred = 1');
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRow = await new Promise<{ total: number }>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as total FROM ${TRANSLATE_HISTORY_TABLE_NAME} ${whereClause}`,
        bindParams,
        (err: Error | null, row: { total: number }) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    interface RawRow {
      id: string;
      group_id: string;
      source_text: string;
      translated_text: string;
      source_lang: string;
      target_lang: string;
      model: string;
      duration_ms: number;
      usage_json: string | null;
      starred: number;
      created_at: number;
    }

    const rows = await new Promise<RawRow[]>((resolve, reject) => {
      this.db!.all(
        `SELECT id, group_id, source_text, translated_text, source_lang, target_lang, model, duration_ms, usage_json, starred, created_at
         FROM ${TRANSLATE_HISTORY_TABLE_NAME} ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...bindParams, pageSize, offset],
        (err: Error | null, rows: RawRow[]) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    return {
      records: rows.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        sourceText: r.source_text,
        translatedText: r.translated_text,
        sourceLang: r.source_lang,
        targetLang: r.target_lang,
        model: r.model,
        durationMs: r.duration_ms,
        usageJson: r.usage_json,
        starred: r.starred === 1,
        createdAt: r.created_at,
      })),
      total: countRow.total,
      page,
      pageSize,
    };
  }

  /**
   * 切换收藏状态
   * @returns 新的 starred 值
   */
  async toggleStar(id: string): Promise<boolean> {
    await this.initialize();

    // 先查当前状态（带归属过滤：他人的记录等同于不存在）
    const current = await new Promise<{ starred: number } | undefined>(
      (resolve, reject) => {
        this.db!.get(
          `SELECT starred FROM ${TRANSLATE_HISTORY_TABLE_NAME} WHERE id = ? AND owner_key = ?`,
          [id, this.owner()],
          (err: Error | null, row: { starred: number } | undefined) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      }
    );

    if (!current) {
      throw new AppError(
        `翻译记录不存在或不属于当前用户: ${id}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'TRANSLATE_HISTORY_NOT_FOUND'
      );
    }

    const newVal = current.starred === 1 ? 0 : 1;

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${TRANSLATE_HISTORY_TABLE_NAME} SET starred = ? WHERE id = ? AND owner_key = ?`,
        [newVal, id, this.owner()],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    return newVal === 1;
  }

  /**
   * 删除单条翻译记录
   */
  async deleteById(id: string): Promise<boolean> {
    await this.initialize();

    return new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TRANSLATE_HISTORY_TABLE_NAME} WHERE id = ? AND owner_key = ?`,
        [id, this.owner()],
        function (this: SqliteRunContext, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  /**
   * 批量删除翻译记录
   * @param ids 要删除的 ID 列表
   * @returns 实际删除条数
   */
  async deleteByIds(ids: string[]): Promise<number> {
    await this.initialize();

    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(', ');

    return new Promise<number>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TRANSLATE_HISTORY_TABLE_NAME} WHERE id IN (${placeholders}) AND owner_key = ?`,
        [...ids, this.owner()],
        function (this: SqliteRunContext, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * 清空**当前用户**的翻译历史（不是全表 —— 归属过滤不可省）
   */
  async clearAll(): Promise<void> {
    await this.initialize();

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TRANSLATE_HISTORY_TABLE_NAME} WHERE owner_key = ?`,
        [this.owner()],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info('翻译历史已清空（当前用户）');
  }
}
