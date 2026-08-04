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
 * S2: ProjectItemStore — 项目内容统一 SQLite 存储
 *
 * 每个项目一个 items.db，存储在 ~/.pyapp/data/projects/<projectId>/items.db
 * 替换 rules.md + artifacts.json 的散落文件存储
 * 包含 FTS5 全文搜索
 *
 * 参照 TaskStore 模式：延迟初始化 + CREATE TABLE IF NOT EXISTS
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDataDir } from '@modules/core/paths';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({
  module: 'workspace:ProjectItemStore',
  level: LogLevel.INFO,
});

// ─── 类型定义 ───

/** 项目内容种类 */
export type ItemKind = 'context' | 'artifact';

/** PDCA 阶段 */
export type PdcaPhase = 'plan' | 'do' | 'check' | 'act';

/** 项目条目统一模型 */
export interface ProjectItem {
  id: string;
  projectId: string;
  kind: ItemKind;
  type?: string;
  title: string;
  content: string;
  summary?: string;
  sessionId?: string;
  messageId?: string;
  refIds?: string[];
  phase?: PdcaPhase;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** 数据库行（snake_case） */
interface ItemRow {
  id: string;
  project_id: string;
  kind: string;
  type: string | null;
  title: string;
  content: string;
  summary: string | null;
  session_id: string | null;
  message_id: string | null;
  ref_ids: string | null;
  phase: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

// ─── 序列化辅助 ───

/**
 * P2-1: 二元分词 — 将中文文本拆为二字词组，空格分隔
 * "家庭记账" → "家庭 庭记 记账"；非中文部分原样保留
 */
function bigramTokenize(text: string): string {
  if (!text) return '';
  const parts: string[] = [];
  let cjkBuffer = '';

  const flushCjk = () => {
    if (cjkBuffer.length >= 2) {
      for (let i = 0; i < cjkBuffer.length - 1; i++) {
        parts.push(cjkBuffer.slice(i, i + 2));
      }
    } else if (cjkBuffer.length === 1) {
      parts.push(cjkBuffer);
    }
    cjkBuffer = '';
  };

  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      cjkBuffer += ch;
    } else {
      flushCjk();
      if (ch.trim()) parts.push(ch);
    }
  }
  flushCjk();

  return parts.join(' ');
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toJsonStr(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return JSON.stringify(arr);
}

function rowToItem(row: ItemRow): ProjectItem {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as ItemKind,
    type: row.type ?? undefined,
    title: row.title,
    content: row.content,
    summary: row.summary ?? undefined,
    sessionId: row.session_id ?? undefined,
    messageId: row.message_id ?? undefined,
    refIds: parseJsonArray(row.ref_ids),
    phase: (row.phase as PdcaPhase) ?? undefined,
    tags: parseJsonArray(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── 建表 DDL ───

const TABLE_NAME = 'project_items';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
  id          TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('context', 'artifact')),
  type        TEXT,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  summary     TEXT,
  session_id  TEXT,
  message_id  TEXT,
  ref_ids     TEXT,
  phase       TEXT,
  tags        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const UPSERT_SQL = `INSERT INTO ${TABLE_NAME}
  (id, project_id, kind, type, title, content, summary,
   session_id, message_id, ref_ids, phase, tags, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  type = excluded.type,
  title = excluded.title,
  content = excluded.content,
  summary = excluded.summary,
  session_id = excluded.session_id,
  message_id = excluded.message_id,
  ref_ids = excluded.ref_ids,
  phase = excluded.phase,
  tags = excluded.tags,
  updated_at = excluded.updated_at`;

// ─── Store 实现 ───

export class ProjectItemStore {
  private db: Database | null = null;
  private dbPath: string;
  private projectId: string;

  constructor(projectId: string, dataDir?: string) {
    this.projectId = projectId;
    const dir = dataDir ?? resolveDataDir();
    this.dbPath = join(dir, 'projects', projectId, 'items.db');
  }

  get path(): string {
    return this.dbPath;
  }

  /** 延迟初始化：打开/创建数据库 + 建表 */
  async initialize(): Promise<void> {
    if (this.db) return;

    const dir = join(resolveDataDir(), 'projects', this.projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    // P0-7: 开启 WAL 模式（支持并发读、单写者队列，避免同项目多会话写锁冲突）
    await new Promise<void>((resolve) => {
      this.db!.run('PRAGMA journal_mode=WAL', () => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      this.db!.run(CREATE_TABLE_SQL, (err: Error | null) => {
        if (err) {
          reject(
            new AppError(
              'ProjectItemStore 建表失败',
              ErrorCategory.DATABASE,
              ErrorSeverity.HIGH,
              undefined,
              { error: String(err) }
            )
          );
        } else {
          // 建索引（不阻塞）
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_items_project ON ${TABLE_NAME}(project_id)`,
            () => {}
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_items_kind ON ${TABLE_NAME}(kind)`,
            () => {}
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_items_type ON ${TABLE_NAME}(type)`,
            () => resolve()
          );
        }
      });
    });

    // FTS5 失败不阻塞
    try {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `CREATE VIRTUAL TABLE IF NOT EXISTS project_items_fts
           USING fts5(title, content, summary, tokenize='unicode61')`,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch (e) {
      logger.warn('FTS5 创建失败，搜索降级为 LIKE', {
        projectId: this.projectId,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new AppError(
        'ProjectItemStore 未初始化',
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH
      );
    }
    return this.db;
  }

  // ─── FTS 同步 ───

  /** P2-1: 同步一条记录到 FTS5（使用 rowid 关联主表） */
  private _syncFts(
    rowid: number,
    title: string,
    content: string,
    summary?: string
  ): void {
    try {
      const tokenizedTitle = bigramTokenize(title);
      const tokenizedContent = bigramTokenize(content);
      const tokenizedSummary = summary ? bigramTokenize(summary) : null;
      this.db!.run(
        `INSERT OR REPLACE INTO project_items_fts(rowid, title, content, summary)
         VALUES (?, ?, ?, ?)`,
        rowid,
        tokenizedTitle,
        tokenizedContent,
        tokenizedSummary,
        () => {
          /* fire-and-forget */
        }
      );
    } catch {
      /* FTS 同步失败不影响主流程 */
    }
  }

  /** P2-1: 从 FTS5 删除一条记录 */
  private _deleteFts(rowid: number): void {
    try {
      this.db!.run(
        'DELETE FROM project_items_fts WHERE rowid = ?',
        rowid,
        () => {
          /* fire-and-forget */
        }
      );
    } catch {
      /* ignore */
    }
  }

  /** P2-1: 获取主表记录的 rowid */
  private async _getRowid(id: string): Promise<number | null> {
    return new Promise<number | null>((resolve, reject) => {
      this.db!.get(
        'SELECT rowid FROM project_items WHERE id = ?',
        id,
        (err: Error | null, row: { rowid: number } | undefined) => {
          if (err) reject(err);
          else resolve(row ? row.rowid : null);
        }
      );
    });
  }

  // ─── CRUD ───

  async upsert(item: ProjectItem): Promise<void> {
    this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        UPSERT_SQL,
        [
          item.id,
          item.projectId,
          item.kind,
          item.type ?? null,
          item.title,
          item.content,
          item.summary ?? null,
          item.sessionId ?? null,
          item.messageId ?? null,
          toJsonStr(item.refIds),
          item.phase ?? null,
          toJsonStr(item.tags),
          item.createdAt,
          item.updatedAt,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    // P2-1: 同步 FTS5（异步 fire-and-forget，不在主 Promise 内阻塞）
    const rowid = await this._getRowid(item.id);
    if (rowid !== null) {
      this._syncFts(rowid, item.title, item.content, item.summary);
    }
  }

  async upsertBatch(items: ProjectItem[]): Promise<void> {
    this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      this.db!.run('BEGIN TRANSACTION', (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    try {
      for (const item of items) {
        await this.upsert(item);
      }
      await new Promise<void>((resolve, reject) => {
        this.db!.run('COMMIT', (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (e) {
      await new Promise<void>((resolve) => {
        this.db!.run('ROLLBACK', () => resolve());
      });
      throw e;
    }
  }

  async getById(id: string): Promise<ProjectItem | null> {
    this.ensureDb();
    return new Promise<ProjectItem | null>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${TABLE_NAME} WHERE id = ?`,
        id,
        (err: Error | null, row: ItemRow | undefined) => {
          if (err) reject(err);
          else resolve(row ? rowToItem(row) : null);
        }
      );
    });
  }

  async list(kind?: ItemKind): Promise<ProjectItem[]> {
    this.ensureDb();
    const sql = kind
      ? `SELECT * FROM ${TABLE_NAME} WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC`
      : `SELECT * FROM ${TABLE_NAME} WHERE project_id = ? ORDER BY kind, updated_at DESC`;
    const params = kind ? [this.projectId, kind] : [this.projectId];
    return new Promise<ProjectItem[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: ItemRow[]) => {
        if (err) reject(err);
        else resolve(rows.map(rowToItem));
      });
    });
  }

  async listByType(type: string): Promise<ProjectItem[]> {
    this.ensureDb();
    return new Promise<ProjectItem[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${TABLE_NAME} WHERE project_id = ? AND type = ? ORDER BY updated_at DESC`,
        this.projectId,
        type,
        (err: Error | null, rows: ItemRow[]) => {
          if (err) reject(err);
          else resolve(rows.map(rowToItem));
        }
      );
    });
  }

  async search(query: string, limit = 20): Promise<ProjectItem[]> {
    this.ensureDb();
    // P2-1 / P3-3: FTS5 JOIN 查询，保留 rank 排序
    const tokenizedQuery = bigramTokenize(query);
    if (tokenizedQuery) {
      try {
        const ftsRows = await new Promise<ItemRow[]>((resolve, reject) => {
          this.db!.all(
            `SELECT pi.* FROM ${TABLE_NAME} pi
             JOIN project_items_fts fts ON pi.rowid = fts.rowid
             WHERE project_items_fts MATCH ?
             ORDER BY rank
             LIMIT ?`,
            tokenizedQuery,
            limit,
            (err: Error | null, rows: ItemRow[]) => {
              if (err) reject(err);
              else resolve(rows ?? []);
            }
          );
        });
        if (ftsRows.length > 0) {
          return ftsRows.map(rowToItem);
        }
      } catch {
        /* FTS 不可用，降级 */
      }
    }

    // LIKE 降级
    const likePattern = `%${query}%`;
    return new Promise<ProjectItem[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${TABLE_NAME}
         WHERE project_id = ?
           AND (title LIKE ? OR content LIKE ? OR summary LIKE ?)
         ORDER BY updated_at DESC
         LIMIT ?`,
        this.projectId,
        likePattern,
        likePattern,
        likePattern,
        limit,
        (err: Error | null, rows: ItemRow[]) => {
          if (err) reject(err);
          else resolve(rows.map(rowToItem));
        }
      );
    });
  }

  async delete(id: string): Promise<void> {
    this.ensureDb();
    // P2-1: 先查 rowid 用于 FTS 同步删除
    const rowid = await this._getRowid(id);
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TABLE_NAME} WHERE id = ?`,
        id,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    if (rowid !== null) {
      this._deleteFts(rowid);
    }
  }

  async deleteAll(): Promise<void> {
    this.ensureDb();
    return new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TABLE_NAME} WHERE project_id = ?`,
        this.projectId,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // ─── S2 迁移 ───

  needsMigration(): boolean {
    const projDir = join(resolveDataDir(), 'projects', this.projectId);
    return (
      existsSync(join(projDir, 'rules.md')) ||
      existsSync(join(projDir, 'artifacts.json'))
    );
  }

  async migrateFromLegacy(): Promise<{ migrated: number }> {
    this.ensureDb();
    const projDir = join(resolveDataDir(), 'projects', this.projectId);
    let migrated = 0;

    // 迁移 rules.md（### [type] header 格式）
    const rulesPath = join(projDir, 'rules.md');
    if (existsSync(rulesPath)) {
      try {
        const content = readFileSync(rulesPath, 'utf-8');
        const sections = content.split(/^### /gm).filter(Boolean);
        for (const section of sections) {
          const lines = section.split('\n');
          const header = lines[0].trim();
          const body = lines.slice(1).join('\n').trim();
          if (!body) continue;

          const headerMatch = header.match(/^\[(\w+)\]\s*(.+)/);
          const itemType = headerMatch?.[1] ?? 'unknown';
          const itemTitle = headerMatch?.[2] ?? header;
          const itemId = `mig_ctx_${itemType}_${migrated}`;

          await this.upsert({
            id: itemId,
            projectId: this.projectId,
            kind: 'context',
            type: itemType,
            title: itemTitle,
            content: body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          migrated++;
        }
        try {
          renameSync(rulesPath, rulesPath + '.bak');
        } catch {
          /* ok */
        }
      } catch (e) {
        logger.warn('迁移 rules.md 失败', {
          projectId: this.projectId,
          error: (e as Error)?.message ?? String(e),
        });
      }
    }

    // 迁移 artifacts.json
    const artifactsPath = join(projDir, 'artifacts.json');
    if (existsSync(artifactsPath)) {
      try {
        const raw = readFileSync(artifactsPath, 'utf-8');
        const artifacts: Array<{
          id?: string;
          title?: string;
          description?: string;
          createdAt?: string;
        }> = JSON.parse(raw);

        for (let i = 0; i < artifacts.length; i++) {
          const a = artifacts[i];
          await this.upsert({
            id: a.id ?? `mig_art_${i}`,
            projectId: this.projectId,
            kind: 'artifact',
            type: 'artifact',
            title: a.title ?? '未命名成果',
            content: a.description ?? '',
            createdAt: a.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          migrated++;
        }
        try {
          renameSync(artifactsPath, artifactsPath + '.bak');
        } catch {
          /* ok */
        }
      } catch (e) {
        logger.warn('迁移 artifacts.json 失败', {
          projectId: this.projectId,
          error: (e as Error)?.message ?? String(e),
        });
      }
    }

    // P2-3: 迁移 summaries.json
    const summariesPath = join(projDir, 'summaries.json');
    if (existsSync(summariesPath)) {
      try {
        const raw = readFileSync(summariesPath, 'utf-8');
        const summaries: Array<{
          id?: string;
          type?: string;
          title?: string;
          content?: string;
          sessionId?: string;
          createdAt?: string;
        }> = JSON.parse(raw);

        for (let i = 0; i < summaries.length; i++) {
          const s = summaries[i];
          await this.upsert({
            id: s.id ?? `mig_sum_${i}`,
            projectId: this.projectId,
            kind: 'context',
            type: s.type ?? 'summary',
            title: s.title ?? '阶段性小结',
            content: s.content ?? '',
            sessionId: s.sessionId,
            createdAt: s.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          migrated++;
        }
        try {
          renameSync(summariesPath, summariesPath + '.bak');
        } catch {
          /* ok */
        }
      } catch (e) {
        logger.warn('迁移 summaries.json 失败', {
          projectId: this.projectId,
          error: (e as Error)?.message ?? String(e),
        });
      }
    }

    // P2-1: 迁移完成后重建 FTS 索引（兜底，单条 upsert 已同步）
    try {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO project_items_fts(project_items_fts)
           VALUES ('rebuild')`,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch {
      /* FTS rebuild 失败不影响迁移结果 */
    }

    logger.info('S2 迁移完成', { projectId: this.projectId, migrated });
    return { migrated };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
