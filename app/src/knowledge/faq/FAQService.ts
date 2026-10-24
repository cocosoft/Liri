// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FAQService — FAQ 条目管理服务
 *
 * 提供 FAQ 的 CRUD、去重、搜索能力。
 * 数据存储在 faq_entries 表中（租户级 DB）。
 *
 * **归属（2026-10-25，租户级 DB §6.1）**：与 RuleStore / RecordStore / LineageStore /
 * SourceChunkStore 同口径 —— 库按**租户**分（`tenants/<t>/app.db`），租户内按
 * `owner_key`（`<tenant>:<user>`）行级隔离。FAQ id 是随机 UUID（`faq_${randomUUID()}`）
 * **非内容派生** ⇒ 保持单列 PK（跨用户 PK 碰撞不可能）；去重语义 = 同 `content_hash` +
 * `knowledge_base` + **同 owner** 才判重复（跨用户同内容互不误伤）。旧库（ALTER 补列）
 * 存量行落 `local:local` 归属。请求作用域读写走 `getFAQService()`（每次按当前身份解析单例）。
 */

import { createHash, randomUUID } from 'crypto';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';
import { handleError } from '@modules/error';
import { Database } from '@openliri/kernel/external/sqlite3';
import { SimpleMutex } from '@openliri/kernel';
import { resolveTenantDbPath } from '@openliri/kernel/paths';
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import type { FAQEntry, FAQSearchParams, FAQImportReport } from './types';

const logger = new OTelAwareLogger({
  module: 'knowledge:faq',
  level: LogLevel.INFO,
});

/** FAQ 条目表名 */
export const FAQ_TABLE = 'faq_entries';

/** Promise 封装的 db.get */
function dbGet<T = Record<string, unknown>>(
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

/** Promise 封装的 db.all */
function dbAll<T = Record<string, unknown>>(
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

export class FAQService {
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

  /** 初始化数据库连接和表（幂等 + 并发安全） */
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
          `CREATE TABLE IF NOT EXISTS ${FAQ_TABLE} (
            id               TEXT PRIMARY KEY,
            owner_key        TEXT NOT NULL DEFAULT 'local:local',
            knowledge_base   TEXT NOT NULL,
            question         TEXT NOT NULL,
            similar_questions TEXT DEFAULT '[]',
            answer           TEXT NOT NULL,
            tags             TEXT DEFAULT '[]',
            category         TEXT DEFAULT '',
            enabled          INTEGER DEFAULT 1,
            recommended      INTEGER DEFAULT 0,
            content_hash     TEXT NOT NULL,
            embedding_status TEXT DEFAULT 'pending',
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_faq_base ON ${FAQ_TABLE}(knowledge_base)`
            );
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_faq_hash ON ${FAQ_TABLE}(content_hash)`
            );
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_faq_category ON ${FAQ_TABLE}(knowledge_base, category)`
            );
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_faq_enabled ON ${FAQ_TABLE}(knowledge_base, enabled)`
            );
            // 归属列走索引（2026-10-25）：list / search / count 以 owner_key 起手过滤
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_faq_owner ON ${FAQ_TABLE}(owner_key, knowledge_base)`
            );
            // 补 owner_key 列（2026-10-25，租户级 DB §6.1）：已建表的库没有该列。
            // SQLite 的 `ALTER TABLE` 不能改主键 ⇒ 旧库保持单列 PK（id 随机 UUID，
            // 跨用户碰撞不可能）；旧库只可能是本地库（只含 `local:local` 行）⇒ 无跨用户
            // 碰撞面（存量行落默认值即本地身份）。
            // sqlite3 db.run 无回调时静默吞错 ⇒ 必须传回调判成败，`/duplicate column/i` 过滤。
            this.db!.run(
              `ALTER TABLE ${FAQ_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
              (alterErr: Error | null) => {
                if (alterErr && !/duplicate column/i.test(alterErr.message)) {
                  logger.warn('faq_entries 补 owner_key 失败', {
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

    logger.info('FAQ 表初始化完成');
  }

  /** 当前身份归属键（本地 ⇒ `local:local`；租户 ⇒ `<tenant>:<user>`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  private computeHash(question: string, answer: string): string {
    return createHash('sha256')
      .update(`${question}\n${answer}`)
      .digest('hex')
      .substring(0, 32);
  }

  /** 创建 FAQ 条目 */
  async create(params: {
    knowledgeBaseName: string;
    question: string;
    answer: string;
    similarQuestions?: string[];
    tags?: string[];
    category?: string;
    recommended?: boolean;
  }): Promise<FAQEntry> {
    await this.init();
    const otel = getOTelTracing();
    const span = otel.startSpan('knowledge.faq.create');

    try {
      const now = Date.now();
      const hash = this.computeHash(params.question, params.answer);
      const owner = this.owner();

      const existing = await dbGet<{ id: string }>(
        this.db!,
        `SELECT id FROM ${FAQ_TABLE} WHERE content_hash = ? AND knowledge_base = ? AND owner_key = ?`,
        hash,
        params.knowledgeBaseName,
        owner
      );

      if (existing) {
        throw Object.assign(new Error('FAQ 条目重复'), {
          code: 'KNOWLEDGE_FAQ_DUPLICATE',
        });
      }

      const id = `faq_${randomUUID().slice(0, 8)}`;
      const entry: FAQEntry = {
        id,
        knowledgeBaseName: params.knowledgeBaseName,
        question: params.question,
        answer: params.answer,
        similarQuestions: params.similarQuestions ?? [],
        tags: params.tags ?? [],
        category: params.category ?? '',
        enabled: true,
        recommended: params.recommended ?? false,
        contentHash: hash,
        embeddingStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      await this.dbMutex.run<void>(() => {
        return new Promise((resolve, reject) => {
          this.db!.run(
            `INSERT INTO ${FAQ_TABLE} (id, owner_key, knowledge_base, question, similar_questions, answer, tags, category, enabled, recommended, content_hash, embedding_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              owner,
              entry.knowledgeBaseName,
              entry.question,
              JSON.stringify(entry.similarQuestions),
              entry.answer,
              JSON.stringify(entry.tags),
              entry.category,
              entry.enabled ? 1 : 0,
              entry.recommended ? 1 : 0,
              entry.contentHash,
              entry.embeddingStatus,
              entry.createdAt,
              entry.updatedAt,
            ],
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      logger.info('FAQ 条目创建成功', { id });
      return entry;
    } catch (err) {
      void handleError(err, { module: 'knowledge:faq', action: 'create' });
      throw err;
    } finally {
      otel.endSpan(span);
    }
  }

  /** 更新 FAQ 条目（他人条目等同不存在，不改动） */
  async update(
    id: string,
    params: Partial<
      Pick<
        FAQEntry,
        | 'question'
        | 'answer'
        | 'similarQuestions'
        | 'tags'
        | 'category'
        | 'enabled'
        | 'recommended'
      >
    >
  ): Promise<FAQEntry | null> {
    await this.init();
    const owner = this.owner();
    const existing = await dbGet<Record<string, unknown>>(
      this.db!,
      `SELECT * FROM ${FAQ_TABLE} WHERE id = ? AND owner_key = ?`,
      id,
      owner
    );
    if (!existing) return null;

    const question =
      (params.question as string) ?? (existing.question as string);
    const answer = (params.answer as string) ?? (existing.answer as string);
    const hash = this.computeHash(question, answer);
    const now = Date.now();

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `UPDATE ${FAQ_TABLE} SET question=?, answer=?, similar_questions=?, tags=?, category=?, enabled=?, recommended=?, content_hash=?, updated_at=? WHERE id=? AND owner_key=?`,
          [
            question,
            answer,
            JSON.stringify(
              params.similarQuestions ??
                JSON.parse(existing.similar_questions as string)
            ),
            JSON.stringify(params.tags ?? JSON.parse(existing.tags as string)),
            params.category ?? existing.category,
            params.enabled !== undefined
              ? params.enabled
                ? 1
                : 0
              : existing.enabled,
            params.recommended !== undefined
              ? params.recommended
                ? 1
                : 0
              : existing.recommended,
            hash,
            now,
            id,
            owner,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    return this.getById(id);
  }

  /** 获取单个条目（他人条目等同不存在） */
  async getById(id: string): Promise<FAQEntry | null> {
    await this.init();
    const row = await dbGet<Record<string, unknown>>(
      this.db!,
      `SELECT * FROM ${FAQ_TABLE} WHERE id = ? AND owner_key = ?`,
      id,
      this.owner()
    );
    return row ? this.rowToEntry(row) : null;
  }

  /** 列出条目（分页；只列当前归属者） */
  async list(params: {
    knowledgeBaseName: string;
    category?: string;
    enabledOnly?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<FAQEntry[]> {
    await this.init();
    let sql = `SELECT * FROM ${FAQ_TABLE} WHERE knowledge_base = ? AND owner_key = ?`;
    const args: unknown[] = [params.knowledgeBaseName, this.owner()];
    if (params.category) {
      sql += ' AND category = ?';
      args.push(params.category);
    }
    if (params.enabledOnly) {
      sql += ' AND enabled = 1';
    }
    sql += ' ORDER BY recommended DESC, updated_at DESC';
    const limit = params.limit ?? 50;
    sql += ` LIMIT ${limit} OFFSET ${params.offset ?? 0}`;
    const rows = await dbAll<Record<string, unknown>>(this.db!, sql, ...args);
    return rows.map((r) => this.rowToEntry(r));
  }

  /** 统计数量（只统计当前归属者） */
  async count(knowledgeBaseName: string, enabledOnly = false): Promise<number> {
    await this.init();
    let sql = `SELECT COUNT(*) as cnt FROM ${FAQ_TABLE} WHERE knowledge_base = ? AND owner_key = ?`;
    const args: unknown[] = [knowledgeBaseName, this.owner()];
    if (enabledOnly) sql += ' AND enabled = 1';
    const row = await dbGet<{ cnt: number }>(this.db!, sql, ...args);
    return row?.cnt ?? 0;
  }

  /** 删除条目（只删当前归属者；他人的等同不存在） */
  async delete(id: string): Promise<boolean> {
    await this.init();
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${FAQ_TABLE} WHERE id = ? AND owner_key = ?`,
          [id, this.owner()],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
    return true;
  }

  /** 批量删除（只删当前归属者） */
  async deleteBatch(ids: string[]): Promise<number> {
    await this.init();
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${FAQ_TABLE} WHERE id IN (${placeholders}) AND owner_key = ?`,
          [...ids, this.owner()],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
    return ids.length;
  }

  /** 关键词搜索（只搜当前归属者） */
  async search(params: FAQSearchParams): Promise<FAQEntry[]> {
    await this.init();
    const tokens = params.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    let sql = `SELECT * FROM ${FAQ_TABLE} WHERE enabled = 1 AND owner_key = ?`;
    const args: unknown[] = [this.owner()];
    const conds = tokens.map(
      () => '(LOWER(question) LIKE ? OR LOWER(answer) LIKE ?)'
    );
    for (const t of tokens) {
      args.push(`%${t}%`, `%${t}%`);
    }
    sql += ` AND (${conds.join(' AND ')})`;

    if (params.knowledgeBaseName) {
      sql += ' AND knowledge_base = ?';
      args.push(params.knowledgeBaseName);
    }
    if (params.category) {
      sql += ' AND category = ?';
      args.push(params.category);
    }

    sql += ` ORDER BY recommended DESC LIMIT ${params.topK ?? 10}`;
    const rows = await dbAll<Record<string, unknown>>(this.db!, sql, ...args);
    return rows.map((r) => this.rowToEntry(r));
  }

  /** 批量导入 */
  async importBatch(
    knowledgeBaseName: string,
    rows: Array<{
      question: string;
      similar_questions?: string;
      answer: string;
      tags?: string;
      category?: string;
    }>
  ): Promise<FAQImportReport> {
    await this.init();
    const report: FAQImportReport = {
      total: rows.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      try {
        await this.create({
          knowledgeBaseName,
          question: r.question,
          answer: r.answer,
          similarQuestions: r.similar_questions
            ? r.similar_questions
                .split('|')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          tags: r.tags
            ? r.tags
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          category: r.category ?? '',
        });
        report.imported++;
      } catch (err) {
        if ((err as { code?: string })?.code === 'KNOWLEDGE_FAQ_DUPLICATE')
          report.skipped++;
        else {
          report.failed++;
          report.errors.push({ row: i + 1, error: (err as Error).message });
        }
      }
    }
    logger.info('FAQ 批量导入完成', report);
    return report;
  }

  /** 获取分类列表（只列当前归属者） */
  async getCategories(knowledgeBaseName: string): Promise<string[]> {
    await this.init();
    const rows = await dbAll<{ category: string }>(
      this.db!,
      `SELECT DISTINCT category FROM ${FAQ_TABLE} WHERE knowledge_base = ? AND owner_key = ? AND category != '' ORDER BY category`,
      knowledgeBaseName,
      this.owner()
    );
    return rows.map((r) => r.category);
  }

  private rowToEntry(row: Record<string, unknown>): FAQEntry {
    return {
      id: row.id as string,
      knowledgeBaseName: row.knowledge_base as string,
      question: row.question as string,
      similarQuestions: JSON.parse(row.similar_questions as string),
      answer: row.answer as string,
      tags: JSON.parse(row.tags as string),
      category: row.category as string,
      enabled: row.enabled === 1,
      recommended: row.recommended === 1,
      contentHash: row.content_hash as string,
      embeddingStatus:
        (row.embedding_status as FAQEntry['embeddingStatus']) ?? 'pending',
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  /** 关闭连接 */
  async close(): Promise<void> {
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      this.db!.close(() => resolve());
    });
    this.db = null;
    this.initPromise = null;
  }
}

/**
 * 请求作用域 FAQService 单例（2026-10-25，租户级 DB §6.1）
 *
 * 显式 dbPath 按路径分桶（测试隔离），不与默认/租户单例混用。
 * 本地身份 ⇒ 模块级单例（惰性不锁库）；已认证身份 ⇒ 按 `principalKeyOf(principal)`
 * 分桶（同租户同用户共享连接），`registerScopedResource` 删租户/退出时释放。
 */
const localInstance = new FAQService();
const scopedInstances = new Map<string, FAQService>();
const explicitInstances = new Map<string, FAQService>();

export function getFAQService(dbPath?: string): FAQService {
  if (dbPath) {
    let inst = explicitInstances.get(dbPath);
    if (!inst) {
      inst = new FAQService(dbPath);
      explicitInstances.set(dbPath, inst);
    }
    return inst;
  }
  const principal = getRequestPrincipal();
  if (isLocalPrincipal(principal)) {
    return localInstance;
  }
  const key = principalKeyOf(principal);
  let scoped = scopedInstances.get(key);
  if (!scoped) {
    scoped = new FAQService();
    scopedInstances.set(key, scoped);
    registerScopedResource(principalKeyOf(principal), () => scoped?.close());
  }
  return scoped;
}

/** 仅测试：重置租户/显式路径单例桶 */
export function resetFAQServiceScopedForTest(): void {
  scopedInstances.clear();
  explicitInstances.clear();
}
