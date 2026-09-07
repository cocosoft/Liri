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
 * RecordStore — 业务对象记录存储（K2 字段级记录）
 *
 * 职责：编译后经 RecordExtractor 抽取的结构化记录落库（统一 app.db），
 * 以 (record_type, record_key) 为主键做 upsert（主键=records.yaml 的 primaryKey 值）。
 * 写操作受 SimpleMutex 保护，防止并发 WAL 锁冲突（与 KnowledgeGraph 同模式）。
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';

const logger = getLogger('knowledge:record:store');

/** 记录表名 */
export const RECORDS_TABLE = 'knowledge_records';

/** 单条业务记录（带元数据） */
export interface StoredRecord {
  /** 记录 ID：{record_type}:{record_key} */
  id: string;
  /** 记录类型（records.yaml 中的 type） */
  type: string;
  /** 主键值（record_key，用于精确检索/去重） */
  key: string;
  /** 结构化字段（schema 校验通过后写入） */
  data: Record<string, unknown>;
  /** 字段级证据：{fieldName: "原文引用"} */
  evidence: Record<string, string>;
  /** 所属域（默认 knowledge） */
  domain: string;
  /** 来源编译页面文件路径 */
  sourceFile: string;
  createdAt: number;
  updatedAt: number;
}

/** 写入入参（不含 id/时间戳） */
export interface UpsertRecordInput {
  type: string;
  key: string;
  data: Record<string, unknown>;
  evidence?: Record<string, string>;
  domain?: string;
  sourceFile?: string;
}

/** 记录查询过滤 */
export interface RecordQuery {
  type?: string;
  domain?: string;
  limit?: number;
}

export class RecordStore {
  private db: Database | null = null;
  private dbPath: string;
  private dbMutex = new SimpleMutex();

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 初始化数据库连接并建表 */
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
          `CREATE TABLE IF NOT EXISTS ${RECORDS_TABLE} (
            record_id    TEXT PRIMARY KEY,
            record_type  TEXT NOT NULL,
            record_key   TEXT NOT NULL,
            data         TEXT NOT NULL,
            evidence     TEXT NOT NULL DEFAULT '{}',
            domain       TEXT NOT NULL DEFAULT 'knowledge',
            source_file  TEXT NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL,
            UNIQUE(record_type, record_key)
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_records_type ON ${RECORDS_TABLE}(record_type)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_records_domain ON ${RECORDS_TABLE}(domain)`
            );
            resolve();
          }
        );
      });
    });

    logger.info('记录存储已初始化');
  }

  /**
   * upsert 一条记录：(record_type, record_key) 冲突时整体更新
   */
  async upsert(input: UpsertRecordInput): Promise<StoredRecord> {
    if (!this.db) await this.init();

    const now = Date.now();
    const id = `${input.type}:${input.key}`;
    const record: StoredRecord = {
      id,
      type: input.type,
      key: input.key,
      data: input.data,
      evidence: input.evidence ?? {},
      domain: input.domain ?? 'knowledge',
      sourceFile: input.sourceFile ?? '',
      createdAt: now,
      updatedAt: now,
    };

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${RECORDS_TABLE}
             (record_id, record_type, record_key, data, evidence, domain, source_file, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(record_type, record_key) DO UPDATE SET
             data = excluded.data,
             evidence = excluded.evidence,
             domain = excluded.domain,
             source_file = excluded.source_file,
             updated_at = excluded.updated_at`,
          [
            id,
            record.type,
            record.key,
            JSON.stringify(record.data),
            JSON.stringify(record.evidence),
            record.domain,
            record.sourceFile,
            record.createdAt,
            record.updatedAt,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    return record;
  }

  /**
   * 按关键字检索记录（record_key / 字段 JSON 全文模糊匹配）
   * @param q 检索关键字（如合同编号）
   */
  async search(q: string, filters: RecordQuery = {}): Promise<StoredRecord[]> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push('(record_key LIKE ? OR data LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like);

    if (filters.type) {
      conditions.push('record_type = ?');
      params.push(filters.type);
    }
    if (filters.domain) {
      conditions.push('domain = ?');
      params.push(filters.domain);
    }

    const limit = filters.limit ?? 20;

    const sql = `SELECT * FROM ${RECORDS_TABLE}
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC LIMIT ?`;

    return new Promise((resolve, reject) => {
      this.db!.all(
        sql,
        [...params, limit],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve((rows as unknown[]).map((r) => this.rowToRecord(r)));
        }
      );
    });
  }

  /** 按来源页面文件列出该页全部记录（K5 血缘：page → record 反查） */
  async listBySourceFile(sourceFile: string): Promise<StoredRecord[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${RECORDS_TABLE} WHERE source_file = ? ORDER BY created_at`,
        [sourceFile],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve((rows as unknown[]).map((r) => this.rowToRecord(r)));
        }
      );
    });
  }

  /** 删除某来源文件对应的全部记录（重编译/文件删除时清理旧行） */
  async deleteBySource(sourceFile: string): Promise<number> {
    if (!this.db) await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT record_id FROM ${RECORDS_TABLE} WHERE source_file = ?`,
          [sourceFile],
          (err: Error | null, rows: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            const ids = (rows as unknown[]).map(
              (r) => (r as { record_id: string }).record_id
            );
            affected = ids.length;
            if (ids.length === 0) {
              resolve();
              return;
            }
            const placeholders = ids.map(() => '?').join(',');
            this.db!.run(
              `DELETE FROM ${RECORDS_TABLE} WHERE record_id IN (${placeholders})`,
              ids,
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

  /** 记录总数（按类型可细分） */
  async count(type?: string): Promise<number> {
    if (!this.db) await this.init();

    const sql = type
      ? `SELECT COUNT(*) AS n FROM ${RECORDS_TABLE} WHERE record_type = ?`
      : `SELECT COUNT(*) AS n FROM ${RECORDS_TABLE}`;
    const params = type ? [type] : [];

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(Number((row as { n?: number } | undefined)?.n ?? 0));
      });
    });
  }

  /** 关闭数据库连接 */
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

  /** 行 → StoredRecord */
  private rowToRecord(row: unknown): StoredRecord {
    const r = row as {
      record_id?: string;
      record_type?: string;
      record_key?: string;
      data?: string;
      evidence?: string;
      domain?: string;
      source_file?: string;
      created_at?: number;
      updated_at?: number;
    };
    return {
      id: r.record_id ?? '',
      type: r.record_type ?? '',
      key: r.record_key ?? '',
      data: this.parseJsonObject(r.data),
      evidence: this.parseStringMap(r.evidence),
      domain: r.domain ?? 'knowledge',
      sourceFile: r.source_file ?? '',
      createdAt: r.created_at ?? 0,
      updatedAt: r.updated_at ?? 0,
    };
  }

  private parseJsonObject(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseStringMap(raw: string | undefined): Record<string, string> {
    const obj = this.parseJsonObject(raw);
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  }
}
