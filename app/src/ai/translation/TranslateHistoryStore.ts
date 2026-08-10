/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译历史持久化存储
 *
 * 使用 SQLite translate_history 表，存储于 app.db。
 * 支持关键词搜索、收藏标星、批量删除。
 */

import { Database } from '../../core/external/sqlite3';
import { randomUUID } from 'crypto';
import { resolveDbPath } from '../../core/paths';
import { getLogger } from '../../monitoring/logs/Logger';
import { handleError } from '../../error/handleError';
import type {
  TranslateHistoryRecord,
  TranslateHistoryQuery,
  TranslateHistoryPage,
} from './types';

const TABLE_NAME = 'translate_history';
const logger = getLogger('ai:translation:history');

export class TranslateHistoryStore {
  private static instance: TranslateHistoryStore;
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): TranslateHistoryStore {
    if (!TranslateHistoryStore.instance) {
      TranslateHistoryStore.instance = new TranslateHistoryStore(dbPath);
    }
    return TranslateHistoryStore.instance;
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
      this.initialized = true;
      this.initPromise = null;
      logger.info('翻译历史存储初始化完成');
    })();

    return this.initPromise;
  }

  private async createTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id              TEXT PRIMARY KEY,
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
        `CREATE INDEX IF NOT EXISTS idx_translate_history_group ON ${TABLE_NAME}(group_id)`,
        () => resolve()
      );
    });

    await new Promise<void>((resolve) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_translate_history_created ON ${TABLE_NAME}(created_at DESC)`,
        () => resolve()
      );
    });
  }

  /** 兼容旧表：添加 starred 列 */
  private async migrateStarredColumn(): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        this.db!.run(
          `ALTER TABLE ${TABLE_NAME} ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`,
          () => resolve()
        );
      });
    } catch (err) {
      // 列已存在时忽略错误
    }
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
        `INSERT INTO ${TABLE_NAME} (id, group_id, source_text, translated_text, source_lang, target_lang, model, duration_ms, usage_json, starred, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          id,
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

    const conditions: string[] = [];
    const bindParams: unknown[] = [];

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

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await new Promise<{ total: number }>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as total FROM ${TABLE_NAME} ${whereClause}`,
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
         FROM ${TABLE_NAME} ${whereClause}
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

    // 先查当前状态
    const current = await new Promise<{ starred: number }>(
      (resolve, reject) => {
        this.db!.get(
          `SELECT starred FROM ${TABLE_NAME} WHERE id = ?`,
          [id],
          (err: Error | null, row: { starred: number }) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      }
    );

    const newVal = current.starred === 1 ? 0 : 1;

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${TABLE_NAME} SET starred = ? WHERE id = ?`,
        [newVal, id],
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
        `DELETE FROM ${TABLE_NAME} WHERE id = ?`,
        [id],
        function (this: { changes: number }, err: Error | null) {
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
        `DELETE FROM ${TABLE_NAME} WHERE id IN (${placeholders})`,
        ids,
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * 清空所有翻译历史
   */
  async clearAll(): Promise<void> {
    await this.initialize();

    await new Promise<void>((resolve, reject) => {
      this.db!.run(`DELETE FROM ${TABLE_NAME}`, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info('翻译历史已清空');
  }
}
