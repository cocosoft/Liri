// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FAQService — FAQ 条目管理服务
 *
 * 提供 FAQ 的 CRUD、去重、搜索能力。
 * 数据存储在 app.db 的 faq_entries 表中。
 */

import { createHash, randomUUID } from 'crypto';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';
import { handleError } from '@modules/error';
import { resolveDbPath } from '@modules/core';
import { Database } from '@modules/core/external/sqlite3';
import type { FAQEntry, FAQSearchParams, FAQImportReport } from './types';

const logger = new OTelAwareLogger({
  module: 'knowledge:faq',
  level: LogLevel.INFO,
});

/** Promise 封装的 db.run */
function dbRun(db: Database, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (params.length > 0) {
      db.run(sql, params, (err: Error | null) => reject(err ?? resolve()));
    } else {
      db.run(sql, (err: Error | null) => reject(err ?? resolve()));
    }
  });
}

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
  private dbPath: string;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 初始化数据库连接和表 */
  async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await dbRun(
      this.db,
      `
      CREATE TABLE IF NOT EXISTS faq_entries (
        id               TEXT PRIMARY KEY,
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
      )
    `
    );

    await dbRun(
      this.db,
      'CREATE INDEX IF NOT EXISTS idx_faq_base ON faq_entries(knowledge_base)'
    );
    await dbRun(
      this.db,
      'CREATE INDEX IF NOT EXISTS idx_faq_hash ON faq_entries(content_hash)'
    );
    await dbRun(
      this.db,
      'CREATE INDEX IF NOT EXISTS idx_faq_category ON faq_entries(knowledge_base, category)'
    );
    await dbRun(
      this.db,
      'CREATE INDEX IF NOT EXISTS idx_faq_enabled ON faq_entries(knowledge_base, enabled)'
    );

    logger.info('FAQ 表初始化完成');
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

      const existing = await dbGet<{ id: string }>(
        this.db!,
        'SELECT id FROM faq_entries WHERE content_hash = ? AND knowledge_base = ?',
        hash,
        params.knowledgeBaseName
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

      await dbRun(
        this.db!,
        `INSERT INTO faq_entries (id, knowledge_base, question, similar_questions, answer, tags, category, enabled, recommended, content_hash, embedding_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
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
        entry.updatedAt
      );

      logger.info('FAQ 条目创建成功', { id });
      return entry;
    } catch (err) {
      void handleError(err, { module: 'knowledge:faq', action: 'create' });
      throw err;
    } finally {
      otel.endSpan(span);
    }
  }

  /** 更新 FAQ 条目 */
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
    const existing = await dbGet<Record<string, unknown>>(
      this.db!,
      'SELECT * FROM faq_entries WHERE id = ?',
      id
    );
    if (!existing) return null;

    const question =
      (params.question as string) ?? (existing.question as string);
    const answer = (params.answer as string) ?? (existing.answer as string);
    const hash = this.computeHash(question, answer);
    const now = Date.now();

    await dbRun(
      this.db!,
      `UPDATE faq_entries SET question=?, answer=?, similar_questions=?, tags=?, category=?, enabled=?, recommended=?, content_hash=?, updated_at=? WHERE id=?`,
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
      id
    );

    return this.getById(id);
  }

  /** 获取单个条目 */
  async getById(id: string): Promise<FAQEntry | null> {
    await this.init();
    const row = await dbGet<Record<string, unknown>>(
      this.db!,
      'SELECT * FROM faq_entries WHERE id = ?',
      id
    );
    return row ? this.rowToEntry(row) : null;
  }

  /** 列出条目（分页） */
  async list(params: {
    knowledgeBaseName: string;
    category?: string;
    enabledOnly?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<FAQEntry[]> {
    await this.init();
    let sql = 'SELECT * FROM faq_entries WHERE knowledge_base = ?';
    const args: unknown[] = [params.knowledgeBaseName];
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

  /** 统计数量 */
  async count(knowledgeBaseName: string, enabledOnly = false): Promise<number> {
    await this.init();
    let sql =
      'SELECT COUNT(*) as cnt FROM faq_entries WHERE knowledge_base = ?';
    if (enabledOnly) sql += ' AND enabled = 1';
    const row = await dbGet<{ cnt: number }>(this.db!, sql, knowledgeBaseName);
    return row?.cnt ?? 0;
  }

  /** 删除条目 */
  async delete(id: string): Promise<boolean> {
    await this.init();
    await dbRun(this.db!, 'DELETE FROM faq_entries WHERE id = ?', id);
    return true;
  }

  /** 批量删除 */
  async deleteBatch(ids: string[]): Promise<number> {
    await this.init();
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    await dbRun(
      this.db!,
      `DELETE FROM faq_entries WHERE id IN (${placeholders})`,
      ...ids
    );
    return ids.length;
  }

  /** 关键词搜索 */
  async search(params: FAQSearchParams): Promise<FAQEntry[]> {
    await this.init();
    const tokens = params.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    let sql = 'SELECT * FROM faq_entries WHERE enabled = 1';
    const args: unknown[] = [];
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
        if ((err as any)?.code === 'KNOWLEDGE_FAQ_DUPLICATE') report.skipped++;
        else {
          report.failed++;
          report.errors.push({ row: i + 1, error: (err as Error).message });
        }
      }
    }
    logger.info('FAQ 批量导入完成', report);
    return report;
  }

  /** 获取分类列表 */
  async getCategories(knowledgeBaseName: string): Promise<string[]> {
    await this.init();
    const rows = await dbAll<{ category: string }>(
      this.db!,
      "SELECT DISTINCT category FROM faq_entries WHERE knowledge_base = ? AND category != '' ORDER BY category",
      knowledgeBaseName
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
}

let _faqService: FAQService | null = null;
export function getFAQService(): FAQService {
  if (!_faqService) _faqService = new FAQService();
  return _faqService;
}
