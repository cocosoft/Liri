/**
 * InboxManager — 统一交互队列
 *
 * 将所有需要用户决策的操作（审批、提问、授权）统一路由到 Inbox——
 * 一个跨会话、支持持久化和离线处理的消息队列。
 *
 * 对标 OpenWorker Inbox 抽象设计。
 */

import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core/paths';
import { randomUUID } from 'crypto';

const logger = new Logger({ module: 'runtime:inbox' });

// ─── 类型定义 ──────────────────────────────────────────

export type InboxItemType = 'approval' | 'question' | 'authorization';
export type InboxItemStatus = 'pending' | 'replied' | 'expired' | 'dismissed';

export interface InboxItem {
  id: string;
  sessionId: string;
  type: InboxItemType;
  title: string;
  message: string;
  status: InboxItemStatus;
  reply?: string;
  options?: string[];
  offlineCapable: boolean;
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  repliedAt?: number;
}

// ─── InboxManager ──────────────────────────────────────

export class InboxManager {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? resolveDbPath();
  }

  private async getDb(): Promise<Database> {
    if (this.db) return this.db;
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
    await this._createTable();
    return this.db;
  }

  private _createTable(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `
        CREATE TABLE IF NOT EXISTS inbox_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'approval',
          title TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          reply TEXT,
          options TEXT,
          offline_capable INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT '',
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          replied_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_session ON inbox_items(session_id);
        CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_items(status);
        CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_items(created_at);
      `,
        (err: Error | null) => {
          if (err) reject(err);
          else {
            logger.info('InboxManager initialized');
            resolve();
          }
        }
      );
    });
  }

  /** 提交 Inbox 项 */
  async submit(
    item: Omit<InboxItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<InboxItem> {
    const db = await this.getDb();
    const otel = getOTelTracing();
    const span = otel.startSpan('inbox.submit', {
      'inbox.type': item.type,
      'inbox.source': item.source,
      'inbox.sessionId': item.sessionId,
    });

    try {
      const now = Date.now();
      const id = randomUUID();
      const full: InboxItem = {
        ...item,
        id,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      await new Promise<void>((resolve, reject) => {
        db.run(
          `INSERT INTO inbox_items (id, session_id, type, title, message, status, options, offline_capable, source, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            full.id,
            full.sessionId,
            full.type,
            full.title,
            full.message,
            full.status,
            full.options ? JSON.stringify(full.options) : null,
            full.offlineCapable ? 1 : 0,
            full.source,
            full.metadata ? JSON.stringify(full.metadata) : null,
            full.createdAt,
            full.updatedAt,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      logger.info('Inbox item submitted', {
        id,
        type: item.type,
        title: item.title,
      });
      span.setAttribute('inbox.id', id);
      otel.endSpan(span, SpanStatusCode.OK);
      return full;
    } catch (e) {
      void handleError(e, {
        module: 'runtime:inbox',
        action: 'submit',
        context: { type: item.type },
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      throw e;
    }
  }

  /** 回复 Inbox 项 */
  async reply(
    id: string,
    reply: string,
    _selectedOption?: string
  ): Promise<InboxItem | null> {
    const db = await this.getDb();
    const otel = getOTelTracing();
    const span = otel.startSpan('inbox.reply', { 'inbox.id': id });

    try {
      const item = await this.get(id);
      if (!item || item.status !== 'pending') {
        otel.endSpan(
          span,
          SpanStatusCode.ERROR,
          item ? 'already_replied' : 'not_found'
        );
        return null;
      }

      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        db.run(
          `UPDATE inbox_items SET status = 'replied', reply = ?, updated_at = ?, replied_at = ? WHERE id = ?`,
          [reply, now, now, id],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      item.status = 'replied';
      item.reply = reply;
      item.updatedAt = now;
      item.repliedAt = now;

      otel.endSpan(span, SpanStatusCode.OK);
      return item;
    } catch (e) {
      void handleError(e, {
        module: 'runtime:inbox',
        action: 'reply',
        context: { id },
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      throw e;
    }
  }

  /** 获取单个 Inbox 项 */
  async get(id: string): Promise<InboxItem | null> {
    const db = await this.getDb();
    const row = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        db.get(
          'SELECT * FROM inbox_items WHERE id = ?',
          [id],
          (err: Error | null, row: Record<string, unknown> | undefined) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      }
    );
    return row ? this._mapRow(row) : null;
  }

  /** 列出 Inbox 项 */
  async list(params?: {
    sessionId?: string;
    status?: InboxItemStatus;
    type?: InboxItemType;
    limit?: number;
    offset?: number;
  }): Promise<{ items: InboxItem[]; total: number }> {
    const db = await this.getDb();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params?.sessionId) {
      conditions.push('session_id = ?');
      values.push(params.sessionId);
    }
    if (params?.status) {
      conditions.push('status = ?');
      values.push(params.status);
    }
    if (params?.type) {
      conditions.push('type = ?');
      values.push(params.type);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const countRow = await new Promise<{ cnt: number }>((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as cnt FROM inbox_items ${where}`,
        values,
        (err: Error | null, row: { cnt: number }) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const rows = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        db.all(
          `SELECT * FROM inbox_items ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...values, limit, offset],
          (err: Error | null, rows: Record<string, unknown>[]) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      }
    );

    return { items: rows.map((r) => this._mapRow(r)), total: countRow.cnt };
  }

  /** 获取待处理数量 */
  async getPendingCount(sessionId?: string): Promise<number> {
    const db = await this.getDb();
    const sql = sessionId
      ? 'SELECT COUNT(*) as cnt FROM inbox_items WHERE status = ? AND session_id = ?'
      : 'SELECT COUNT(*) as cnt FROM inbox_items WHERE status = ?';
    const params = sessionId ? ['pending', sessionId] : ['pending'];

    const row = await new Promise<{ cnt: number }>((resolve, reject) => {
      db.get(sql, params, (err: Error | null, row: { cnt: number }) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    return row.cnt;
  }

  /** 清除过期项 */
  async expireOlderThan(maxAgeMs: number): Promise<number> {
    const db = await this.getDb();
    const cutoff = Date.now() - maxAgeMs;
    return new Promise<number>((resolve, reject) => {
      db.run(
        `UPDATE inbox_items SET status = 'expired', updated_at = ? WHERE status = 'pending' AND created_at < ?`,
        [Date.now(), cutoff],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0)
              logger.info('Expired inbox items', { count: this.changes });
            resolve(this.changes);
          }
        }
      );
    });
  }

  private _mapRow(row: Record<string, unknown>): InboxItem {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      type: row.type as InboxItemType,
      title: row.title as string,
      message: row.message as string,
      status: row.status as InboxItemStatus,
      reply: row.reply as string | undefined,
      options: row.options ? JSON.parse(row.options as string) : undefined,
      offlineCapable: Boolean(row.offline_capable),
      source: row.source as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      repliedAt: row.replied_at as number | undefined,
    };
  }
}

export const inboxManager = new InboxManager();

// Re-export unattended mode for convenience
export { unattendedMode } from './UnattendedModeManager.js';
