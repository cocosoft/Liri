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
 * SourceChunkStore — R4 原文分块页码索引存储
 *
 * 编译文档类 raw（PDF/XLSX 等）成功后，把抽取原文按 locators 切成的原文块
 * （携带 page/section/tableId）落库（统一 app.db）。检索期按块文本 LIKE 命中，
 * 命中块直接可得 doc.pdf#p.N 引用（不依赖 LLM 页摘要与原文的逐字一致性）。
 *
 * 与 RecordStore/RuleStore 同模式：SimpleMutex 防并发 WAL 锁冲突。
 */

import { readFile } from 'fs/promises';
import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';
import type { EvidenceSidecar } from '../evidence/EvidenceLocator';
import { loadSidecar } from '../evidence/EvidenceLocator';
import type { ExtractedDocument } from '../ingestion/extractors/types';
import { extractDocument } from '../ingestion/extractors/TextExtractor';
import { buildSourceChunks, type SourceChunk } from './sourceChunker';

const logger = getLogger('knowledge:source:store');

/** 原文块表名 */
export const SOURCE_CHUNKS_TABLE = 'knowledge_source_chunks';

/** 存储行（含 raw_path 定位） */
export interface StoredSourceChunk {
  rawPath: string;
  seq: number;
  page?: number;
  section?: string;
  tableId?: string;
  text: string;
  updatedAt: number;
}

/** 原文块查询过滤 */
export interface SourceChunkQuery {
  limit?: number;
}

/** sqlite 行 → StoredSourceChunk */
function rowToChunk(row: Record<string, unknown>): StoredSourceChunk {
  const chunk: StoredSourceChunk = {
    rawPath: String(row.raw_path),
    seq: Number(row.seq),
    text: String(row.text),
    updatedAt: Number(row.updated_at),
  };
  if (row.page !== null && row.page !== undefined) {
    chunk.page = Number(row.page);
  }
  if (row.section) chunk.section = String(row.section);
  if (row.table_id) chunk.tableId = String(row.table_id);
  return chunk;
}

export class SourceChunkStore {
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
          `CREATE TABLE IF NOT EXISTS ${SOURCE_CHUNKS_TABLE} (
            id           TEXT PRIMARY KEY,
            raw_path     TEXT NOT NULL,
            seq          INTEGER NOT NULL,
            page         INTEGER,
            section      TEXT,
            table_id     TEXT,
            text         TEXT NOT NULL,
            updated_at   INTEGER NOT NULL
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_source_chunks_raw
                 ON ${SOURCE_CHUNKS_TABLE}(raw_path)`
            );
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_source_chunks_page
                 ON ${SOURCE_CHUNKS_TABLE}(raw_path, page)`
            );
            resolve();
          }
        );
      });
    });

    logger.info('原文块存储已初始化');
  }

  /** 替换某 raw 的原文块（先清后插；重编译防残留） */
  async replaceForRaw(rawPath: string, chunks: SourceChunk[]): Promise<number> {
    if (!this.db) await this.init();
    if (chunks.length === 0) return 0;

    const now = Date.now();
    await this.dbMutex.run<void>(() => {
      return new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${SOURCE_CHUNKS_TABLE} WHERE raw_path = ?`,
          [rawPath],
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            let idx = 0;
            const insert = (): void => {
              if (idx >= chunks.length) {
                resolve();
                return;
              }
              const c = chunks[idx++];
              this.db!.run(
                `INSERT INTO ${SOURCE_CHUNKS_TABLE}
                   (id, raw_path, seq, page, section, table_id, text, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  `${rawPath}:${c.seq}`,
                  rawPath,
                  c.seq,
                  c.page ?? null,
                  c.section ?? null,
                  c.tableId ?? null,
                  c.text,
                  now,
                ],
                (e2: Error | null) => {
                  if (e2) {
                    reject(e2);
                    return;
                  }
                  insert();
                }
              );
            };
            insert();
          }
        );
      });
    });
    return chunks.length;
  }

  /** 删除某 raw 的全部原文块（返回删除数） */
  async deleteByRaw(rawPath: string): Promise<number> {
    if (!this.db) await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT COUNT(*) AS n FROM ${SOURCE_CHUNKS_TABLE} WHERE raw_path = ?`,
          [rawPath],
          (err: Error | null, rows: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            affected =
              Number((rows[0] as { n?: unknown } | undefined)?.n ?? 0) ?? 0;
            this.db!.run(
              `DELETE FROM ${SOURCE_CHUNKS_TABLE} WHERE raw_path = ?`,
              [rawPath],
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

  /** 按关键字检索原文块（text LIKE；短块优先，命中更聚焦） */
  async search(
    q: string,
    filters: SourceChunkQuery = {}
  ): Promise<StoredSourceChunk[]> {
    if (!this.db) await this.init();
    const limit = filters.limit ?? 10;
    const like = `%${q}%`;

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${SOURCE_CHUNKS_TABLE}
         WHERE text LIKE ?
         ORDER BY LENGTH(text) ASC, seq ASC
         LIMIT ?`,
        [like, limit],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(
            (rows as Array<Record<string, unknown>>).map((r) => rowToChunk(r))
          );
        }
      );
    });
  }

  /** 关闭连接 */
  async close(): Promise<void> {
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      this.db!.close(() => resolve());
    });
    this.db = null;
  }
}

/**
 * R4 编译钩子：为单个文档 raw 刷新原文块索引。
 * 优先复用 sidecar（PDF pagesText + locators，避免二次解析）；
 * 无 pagesText 的（XLSX/DOCX）回退完整抽取。locators 为空（DOCX/文本类）→ 清空该 raw 旧块。
 * @param rawFile raw 文件绝对路径
 * @param dbPath 测试注入用（默认统一 app.db）
 * @returns 生成的原文块数（无定位/空文本返回 0）
 */
export async function refreshSourceChunksForRaw(
  rawFile: string,
  dbPath?: string
): Promise<number> {
  const store = new SourceChunkStore(dbPath);
  try {
    const sidecar: EvidenceSidecar | null = await loadSidecar(rawFile);
    let chunks: SourceChunk[] = [];

    if (sidecar && sidecar.locators.length > 0 && sidecar.pagesText?.length) {
      const text = sidecar.pagesText.join('\n\n');
      const ir: ExtractedDocument = {
        path: rawFile,
        ext: sidecar.ext ?? '',
        text,
        pagesText: sidecar.pagesText,
        locators: sidecar.locators,
        meta: { charCount: text.length, pageCount: sidecar.pageCount },
      };
      chunks = buildSourceChunks(ir);
    } else {
      const extracted = await extractDocument(rawFile);
      if (extracted) chunks = buildSourceChunks(extracted);
    }

    if (chunks.length === 0) {
      await store.deleteByRaw(rawFile);
      return 0;
    }
    await store.replaceForRaw(rawFile, chunks);
    return chunks.length;
  } finally {
    await store.close();
  }
}

/** 读取 raw 的 companion .meta.json pages（无则空数组；损坏容忍） */
export async function readRawMetaPages(rawFile: string): Promise<string[]> {
  try {
    const meta = JSON.parse(
      await readFile(`${rawFile}.meta.json`, 'utf-8')
    ) as { pages?: string[] };
    return Array.isArray(meta.pages) ? meta.pages : [];
  } catch {
    return [];
  }
}
