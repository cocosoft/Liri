/**
 * NotificationPersistence — 统一消息中心持久化
 *
 * 管理 notifications 表的 CRUD、过期清理、幂等操作等。
 * 与 InboxManager 协作：Inbox 创建/回复时同步写入通知。
 */

import { Logger } from '@modules/monitoring';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core/paths';
import { randomUUID } from 'crypto';
import { broadcastEvent } from '../infrastructure/http/LocalHTTPServiceSSE.js';

const logger = new Logger({ module: 'runtime:notification' });

// ─── 类型定义 ──────────────────────────────────────────

export type NotificationCategory =
  | 'approval'
  | 'todo'
  | 'system'
  | 'notice'
  | 'mention';

export type NotificationPriority = 'urgent' | 'normal' | 'low';

export type NotificationStatus =
  | 'unread'
  | 'read'
  | 'resolved'
  | 'dismissed'
  | 'expired';

export interface NotificationAction {
  label: string;
  action: 'approve' | 'reject' | 'view' | 'dismiss';
  style?: 'primary' | 'danger' | 'secondary';
  confirmText?: string;
}

export interface NotificationLink {
  type: 'session' | 'page' | 'url';
  id: string;
  label?: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  content: string;
  status: NotificationStatus;
  source: string;
  source_ref: string;
  actions: NotificationAction[];
  link_to: NotificationLink | null;
  created_at: number;
  updated_at: number;
  read_at: number | null;
  resolved_at: number | null;
  expires_at: number | null;
  action_token: string | null;
}

export interface NotificationCreateInput {
  category: NotificationCategory;
  priority?: NotificationPriority;
  title: string;
  content?: string;
  source?: string;
  source_ref?: string;
  actions?: NotificationAction[];
  link_to?: NotificationLink | null;
  expires_at?: number | null;
}

export interface NotificationListParams {
  category?: NotificationCategory;
  status?: NotificationStatus;
  priority?: NotificationPriority;
  /** 分页游标：P0-6 复合格式 "created_at:id"（兼容旧纯 created_at 数字） */
  cursor?: number | string;
  limit?: number;
  userId?: string;
}

export interface NotificationListResult {
  items: NotificationItem[];
  nextCursor: number | string | null;
  hasMore: boolean;
}

export interface NotificationCountResult {
  [key: string]: number;
  total: number;
  approval: number;
  todo: number;
  system: number;
  notice: number;
  mention: number;
}

// ─── 持久化类 ──────────────────────────────────────────

export class NotificationPersistence {
  private dbPath: string;
  private db: Database | null = null;
  private expireTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    await this._getDb();
    this._startExpireScheduler();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }
    if (this.db) {
      await new Promise<void>((resolve) => {
        this.db!.close(() => resolve());
      });
      this.db = null;
    }
  }

  // ─── 内部 DB 管理 ───────────────────────────────

  private async _getDb(): Promise<Database> {
    if (this.disposed) {
      throw new Error('NotificationPersistence 已 dispose，禁止访问数据库');
    }
    if (this.db) return this.db;
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
    await this._createTable();
    return this.db!;
  }

  private async _createTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default',
          category TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'normal',
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'unread',
          source TEXT NOT NULL DEFAULT '',
          source_ref TEXT NOT NULL DEFAULT '',
          actions TEXT NOT NULL DEFAULT '[]',
          link_to TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          read_at INTEGER,
          resolved_at INTEGER,
          expires_at INTEGER,
          action_token TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notif_category ON notifications(category);
        CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);
        CREATE INDEX IF NOT EXISTS idx_notif_cat_status ON notifications(category, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notif_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_notif_source_ref ON notifications(source_ref);`,
        (err: Error | null) => {
          if (err) reject(err);
          else {
            logger.info('NotificationPersistence initialized');
            resolve();
          }
        }
      );
    });

    // FTS5 虚拟表（用于搜索）
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS notifications_fts USING fts5(
          title, content, tokenize='porter unicode61'
        );`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // P0-4: 存量 actions 清洗（幂等）——决策类消息已移出消息中心，
    // 存量 approval/todo/question/authorization 清空 actions 并归档，避免简化面板长期兼容废弃渲染分支
    await new Promise<void>((resolve) => {
      this.db!.run(
        `UPDATE notifications SET actions = '[]', status = 'dismissed', updated_at = ?,
           resolved_at = COALESCE(resolved_at, ?)
         WHERE category IN ('approval','todo','question','authorization')
           AND actions != '[]'`,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        (err: Error | null) => {
          if (err) {
            logger.warn('存量 approval/todo actions 清洗失败（非致命）', {
              error: String(err),
            });
          }
          resolve();
        }
      );
    });
  }

  // ─── 序列化/反序列化 ──────────────────────────

  private _serialize(item: NotificationItem): Record<string, unknown> {
    return {
      ...item,
      actions: JSON.stringify(item.actions),
      link_to: item.link_to ? JSON.stringify(item.link_to) : null,
    };
  }

  private _deserialize(row: Record<string, unknown>): NotificationItem {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      category: row.category as NotificationCategory,
      priority: (row.priority as NotificationPriority) || 'normal',
      title: row.title as string,
      content: (row.content as string) || '',
      status: (row.status as NotificationStatus) || 'unread',
      source: (row.source as string) || '',
      source_ref: (row.source_ref as string) || '',
      actions:
        typeof row.actions === 'string'
          ? (JSON.parse(row.actions as string) as NotificationAction[])
          : (row.actions as NotificationAction[]) || [],
      link_to: row.link_to
        ? ((typeof row.link_to === 'string'
            ? JSON.parse(row.link_to as string)
            : row.link_to) as NotificationLink)
        : null,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
      read_at: (row.read_at as number) || null,
      resolved_at: (row.resolved_at as number) || null,
      expires_at: (row.expires_at as number) || null,
      action_token: (row.action_token as string) || null,
    };
  }

  // ─── CRUD ─────────────────────────────────────

  async create(
    input: NotificationCreateInput,
    userId: string = 'default'
  ): Promise<NotificationItem> {
    const db = await this._getDb();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const action_token = input.actions?.length ? randomUUID() : null;

    const item: NotificationItem = {
      id,
      user_id: userId,
      category: input.category,
      priority: input.priority || 'normal',
      title: input.title,
      content: input.content || '',
      status: 'unread',
      source: input.source || '',
      source_ref: input.source_ref || '',
      actions: input.actions || [],
      link_to: input.link_to || null,
      created_at: now,
      updated_at: now,
      read_at: null,
      resolved_at: null,
      expires_at: input.expires_at || null,
      action_token,
    };

    const serialized = this._serialize(item);
    await new Promise<void>((resolve, reject) => {
      const keys = Object.keys(serialized).join(', ');
      const placeholders = Object.keys(serialized)
        .map(() => '?')
        .join(', ');
      const values = Object.values(serialized);
      db.run(
        `INSERT INTO notifications (${keys}) VALUES (${placeholders})`,
        values,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // FTS5 索引
    await new Promise<void>((resolve, _reject) => {
      db.run(
        `INSERT INTO notifications_fts(rowid, title, content) VALUES (?, ?, ?)`,
        id,
        item.title,
        item.content,
        (err: Error | null) => {
          if (err) {
            /* FTS 索引失败不影响主流程 */
          }
          resolve();
        }
      );
    });

    // SSE 广播
    void broadcastEvent('notification:new', {
      id,
      category: item.category,
      priority: item.priority,
      title: item.title,
      content: item.content,
      status: item.status,
      actions: item.actions,
      link_to: item.link_to,
      source: item.source,
      source_ref: item.source_ref,
      created_at: item.created_at,
      expires_at: item.expires_at,
    });

    // 更新角标计数（fire-and-forget；dispose 竞态下广播无意义，静默忽略）
    void this._broadcastCount(userId).catch(() => {});

    return item;
  }

  async get(id: string): Promise<NotificationItem | null> {
    const db = await this._getDb();
    return new Promise<NotificationItem | null>((resolve, reject) => {
      db.get(
        'SELECT * FROM notifications WHERE id = ?',
        id,
        (err: Error | null, row: Record<string, unknown>) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else resolve(this._deserialize(row));
        }
      );
    });
  }

  async list(
    params: NotificationListParams = {}
  ): Promise<NotificationListResult> {
    const db = await this._getDb();
    const limit = Math.min(params.limit || 20, 100);
    const userId = params.userId || 'default';

    const conditions: string[] = ['user_id = ?'];
    const values: (string | number)[] = [userId];

    if (params.category) {
      conditions.push('category = ?');
      values.push(params.category);
    }
    if (params.status) {
      conditions.push('status = ?');
      values.push(params.status);
    }
    if (params.priority) {
      conditions.push('priority = ?');
      values.push(params.priority);
    }
    if (params.cursor) {
      // P0-6: 复合游标 "created_at:id"，消除同秒多条数据的漏/重
      const [createdAt, id] = String(params.cursor).split(':');
      const cursorTs = Number(createdAt);
      if (id) {
        conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
        values.push(cursorTs, cursorTs, id);
      } else {
        // 兼容旧格式游标（纯 created_at）
        conditions.push('created_at < ?');
        values.push(cursorTs);
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询 limit+1 判断 hasMore；复合游标需按 (created_at, id) 排序保证确定性
    const sql = `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ?`;
    values.push(limit + 1);

    const items = await new Promise<NotificationItem[]>((resolve, reject) => {
      db.all(
        sql,
        values,
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows.map((r) => this._deserialize(r)));
        }
      );
    });

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    const last = items[items.length - 1];
    return {
      items,
      nextCursor: last != null ? `${last.created_at}:${last.id}` : null,
      hasMore,
    };
  }

  async getUnreadCount(
    userId: string = 'default'
  ): Promise<NotificationCountResult> {
    const db = await this._getDb();
    return new Promise<NotificationCountResult>((resolve, reject) => {
      db.all(
        `SELECT category, COUNT(*) as cnt FROM notifications
         WHERE user_id = ? AND status = 'unread'
         GROUP BY category`,
        userId,
        (err: Error | null, rows: { category: string; cnt: number }[]) => {
          if (err) reject(err);
          else {
            const result: NotificationCountResult = {
              total: 0,
              approval: 0,
              todo: 0,
              system: 0,
              notice: 0,
              mention: 0,
            };
            for (const row of rows) {
              const key = row.category as keyof NotificationCountResult;
              if (key in result) {
                (result[key] as number) = row.cnt;
                result.total += row.cnt;
              }
            }
            resolve(result);
          }
        }
      );
    });
  }

  async markRead(id: string, userId: string = 'default'): Promise<boolean> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    const self = this;
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = 'read', read_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'unread'`,
        now,
        now,
        id,
        userId,
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            const changed = this.changes > 0;
            if (changed) {
              void broadcastEvent('notification:update', {
                id,
                status: 'read',
                updated_at: now,
              });
              void (async () => {
                const count = await self._scopeCount(userId);
                void broadcastEvent('notification:count', count);
              })();
            }
            resolve(changed);
          }
        }
      );
    });
  }

  async markReadAll(
    category?: NotificationCategory,
    userId: string = 'default',
    limit: number = 500
  ): Promise<number> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    const self = this;
    const conditions = [`user_id = ?`, `status = 'unread'`];
    const values: (string | number)[] = [userId];

    if (category) {
      conditions.push('category = ?');
      values.push(category);
    }

    // P0-4: 循环处理直到未读清空，避免超过 limit 条时剩余未读静默保留
    let totalChanged = 0;
    for (;;) {
      const changed = await new Promise<number>((resolve, reject) => {
        db.run(
          `UPDATE notifications SET status = 'read', read_at = ?, updated_at = ?
           WHERE id IN (
             SELECT id FROM notifications WHERE ${conditions.join(' AND ')} LIMIT ?
           )`,
          [now, now, ...values, limit],
          function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });
      totalChanged += changed;
      if (changed < limit) break; // 本批不足 limit（或为 0），未读已处理完
    }

    if (totalChanged > 0) {
      void broadcastEvent('notification:bulk-updated', {
        category: category || 'all',
        updated_count: totalChanged,
      });
      void (async () => {
        const count = await self._scopeCount(userId);
        void broadcastEvent('notification:count', count);
      })();
    }
    return totalChanged;
  }

  async dismiss(id: string, userId: string = 'default'): Promise<boolean> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = 'dismissed', updated_at = ? WHERE id = ? AND user_id = ?`,
        now,
        id,
        userId,
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              void broadcastEvent('notification:update', {
                id,
                status: 'dismissed',
                updated_at: now,
              });
            }
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  async batchUpdate(
    ids: string[],
    newStatus: 'read' | 'dismissed',
    userId: string = 'default'
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    const values = [now, userId, ...ids];

    return new Promise<number>((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = ?, updated_at = ?
         WHERE user_id = ? AND id IN (${placeholders})`,
        [newStatus, ...values],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              void broadcastEvent('notification:bulk-updated', {
                ids,
                status: newStatus,
                updated_count: this.changes,
              });
            }
            resolve(this.changes);
          }
        }
      );
    });
  }

  async delete(id: string, userId: string = 'default'): Promise<boolean> {
    const db = await this._getDb();
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
        id,
        userId,
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              void broadcastEvent('notification:delete', { id });
            }
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  async resolveById(
    id: string,
    status: 'resolved',
    userId: string = 'default'
  ): Promise<boolean> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        [status, now, now, id, userId],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              void broadcastEvent('notification:update', {
                id,
                status,
                updated_at: now,
              });
            }
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /** 按 source_ref 解析通知（用于 Inbox 回复后同步状态） */
  async resolveBySourceRef(
    sourceRef: string,
    userId: string = 'default'
  ): Promise<boolean> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    const self = this;
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = 'resolved', resolved_at = ?, updated_at = ?, action_token = NULL
         WHERE source_ref = ? AND user_id = ? AND status = 'unread'`,
        [now, now, sourceRef, userId],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              void broadcastEvent('notification:bulk-updated', {
                source_ref: sourceRef,
                status: 'resolved',
                updated_count: this.changes,
              });
              void (async () => {
                const count = await self._scopeCount(userId);
                void broadcastEvent('notification:count', count);
              })();
            }
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  // ─── 搜索 ────────────────────────────────────

  /** FTS5 全文搜索通知 */
  async search(query: string): Promise<NotificationItem[]> {
    const db = await this._getDb();
    const self = this;

    const rows: { rowid: string }[] = await new Promise((resolve, reject) => {
      db.all(
        `SELECT rowid FROM notifications_fts WHERE notifications_fts MATCH ? ORDER BY rank LIMIT 50`,
        query,
        (err: Error | null, results: { rowid: string }[]) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.rowid);
    const placeholders = ids.map(() => '?').join(',');
    const items = await new Promise<NotificationItem[]>((resolve, reject) => {
      db.all(
        `SELECT * FROM notifications WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
        ids,
        (err: Error | null, results: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(results.map((r) => self._deserialize(r)));
        }
      );
    });

    return items;
  }

  // ─── 过期调度 ────────────────────────────────

  private _startExpireScheduler(): void {
    this.expireTimer = setInterval(
      () => {
        this._checkExpired()
          .catch((err) => {
            logger.warn('过期检查失败', { error: String(err) });
          })
          .then(() =>
            this._physicalCleanup().catch((err) => {
              logger.warn('物理清理失败', { error: String(err) });
            })
          );
      },
      2 * 60 * 1000
    ); // 每 2 分钟
  }

  private async _checkExpired(): Promise<void> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);

    const expiredIds: { id: string; user_id: string }[] = await new Promise(
      (resolve, reject) => {
        db.all(
          `SELECT id, user_id FROM notifications
           WHERE expires_at IS NOT NULL AND expires_at <= ? AND status = 'unread'
           LIMIT 100`,
          now,
          (err: Error | null, rows: { id: string; user_id: string }[]) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      }
    );

    if (expiredIds.length === 0) return;

    const ids = expiredIds.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await new Promise<void>((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = 'expired', updated_at = ? WHERE id IN (${placeholders})`,
        [now, ...ids],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    for (const { id } of expiredIds) {
      void broadcastEvent('notification:expired', { id, expires_at: now });
    }

    logger.info(`已过期 ${expiredIds.length} 条通知`);
  }

  /**
   * P3-1: 物理清理，对齐前端 footer"保留最近 1000 条、30 天自动归档"：
   * 1) 删除 30 天前的记录
   * 2) 保留最近 1000 条，删除超量最旧记录
   */
  private async _physicalCleanup(): Promise<void> {
    const db = await this._getDb();
    const now = Math.floor(Date.now() / 1000);
    const cutoff30d = now - 30 * 24 * 3600;

    await new Promise<void>((resolve, reject) => {
      db.run(
        `DELETE FROM notifications WHERE created_at < ?`,
        [cutoff30d],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });

    await new Promise<void>((resolve, reject) => {
      db.run(
        `DELETE FROM notifications WHERE id IN (
           SELECT id FROM notifications ORDER BY created_at DESC LIMIT -1 OFFSET 1000
         )`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  // ─── 辅助 ────────────────────────────────────

  private async _scopeCount(userId: string): Promise<NotificationCountResult> {
    return this.getUnreadCount(userId);
  }

  private async _broadcastCount(userId: string): Promise<void> {
    const count = await this.getUnreadCount(userId);
    void broadcastEvent('notification:count', count);
  }
}

// ─── 单例 ──────────────────────────────────────────

let _instance: NotificationPersistence | null = null;

export function notificationPersistence(): NotificationPersistence {
  if (!_instance) {
    _instance = new NotificationPersistence();
  }
  return _instance;
}

export function setNotificationPersistence(
  instance: NotificationPersistence
): void {
  _instance = instance;
}
