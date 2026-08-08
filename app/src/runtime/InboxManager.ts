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
import { broadcastEvent } from '../infrastructure/http/LocalHTTPServiceSSE.js';
import type { FrontendMessageBlock } from '@modules/session/types/Message.js';

const logger = new Logger({ module: 'runtime:inbox' });

// ─── 类型定义 ──────────────────────────────────────────

export type InboxItemType = 'approval' | 'question' | 'authorization';
export type InboxItemStatus =
  | 'pending'
  | 'processing'
  | 'replied'
  | 'expired'
  | 'dismissed';

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
  /** 来源渠道 ID（如 'qq', 'telegram'） */
  channelId?: string;
  /** 来源渠道会话 ID（ChannelSession.id） */
  channelSessionId?: string;
  /** 来源渠道会话的 conversationId（原始对话标识） */
  channelConversationId?: string;
  /** 全链路追踪 ID */
  traceId?: string;
}

// ─── InboxManager ──────────────────────────────────────

export class InboxManager {
  private db: Database | null = null;
  private dbPath: string;
  private expireTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? resolveDbPath();
  }

  /**
   * 启动审批过期调度（P2-1 工具执行审批链路）
   * 定期把超过 TTL 的 pending 审批置为 expired；前端展示"已超时过期"，reply 被拒。
   */
  startExpireScheduler(
    ttlMs: number = 5 * 60 * 1000,
    intervalMs: number = 2 * 60 * 1000
  ): void {
    if (this.expireTimer) return;
    this.expireTimer = setInterval(() => {
      this.expireOlderThan(ttlMs).catch((err) => {
        logger.warn('审批过期清理失败', { error: String(err) });
      });
    }, intervalMs);
    this.expireTimer.unref?.();
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

  private async _createTable(): Promise<void> {
    // 修复: 原实现提前 return 导致 Phase 3/4/5（审计表、列迁移、session_inbox_map）成为死代码，
    // 旧库 inbox_items 缺 channel_id 等列使 submit() 必抛 SQLiteError，审批链路整体降级。
    await new Promise<void>((resolve, reject) => {
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
          channel_id TEXT,
          channel_session_id TEXT,
          channel_conversation_id TEXT,
          trace_id TEXT,
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

    // Phase 3: 创建审批审计日志表
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `CREATE TABLE IF NOT EXISTS approval_audit_log (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          event TEXT NOT NULL,
          actor TEXT NOT NULL,
          detail TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_item ON approval_audit_log(item_id);
        CREATE INDEX IF NOT EXISTS idx_audit_session ON approval_audit_log(session_id);`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Phase 4: 幂等列迁移（channel_id, channel_session_id, channel_conversation_id）
    await this._migrateSchema();

    // Phase 5: 创建 session_inbox_map 关联表
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `CREATE TABLE IF NOT EXISTS session_inbox_map (
          session_id TEXT NOT NULL,
          inbox_item_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, inbox_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sim_inbox ON session_inbox_map(inbox_item_id);
        CREATE INDEX IF NOT EXISTS idx_sim_session ON session_inbox_map(session_id);`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 幂等列迁移：通过 PRAGMA table_info 检测列是否存在，仅新增缺失列 */
  private async _migrateSchema(): Promise<void> {
    const db = this.db!;
    const columns: { name: string }[] = await new Promise((resolve, reject) => {
      db.all(
        'PRAGMA table_info(inbox_items)',
        (err: Error | null, rows: { name: string }[]) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
    const existing = new Set(columns.map((c) => c.name));

    const migrations: [string, string][] = [
      [
        'channel_id',
        "ALTER TABLE inbox_items ADD COLUMN channel_id TEXT DEFAULT ''",
      ],
      [
        'channel_session_id',
        "ALTER TABLE inbox_items ADD COLUMN channel_session_id TEXT DEFAULT ''",
      ],
      [
        'channel_conversation_id',
        "ALTER TABLE inbox_items ADD COLUMN channel_conversation_id TEXT DEFAULT ''",
      ],
      [
        'trace_id',
        "ALTER TABLE inbox_items ADD COLUMN trace_id TEXT DEFAULT ''",
      ],
    ];

    for (const [col, sql] of migrations) {
      if (!existing.has(col)) {
        await new Promise<void>((resolve, reject) => {
          db.run(sql, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.info(`Schema migrated: added column ${col}`);
      }
    }
  }

  /** 提交 Inbox 项 */
  async submit(
    item: Omit<InboxItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
    /** 可选：关联的会话 ID，用于注入 inbox block 到聊天消息 */
    sessionId?: string,
    /** 可选：关联的消息 ID，用于注入 inbox block */
    messageId?: string
  ): Promise<InboxItem> {
    const db = await this.getDb();
    const otel = getOTelTracing();
    const span = otel.startSpan('inbox.submit', {
      'inbox.type': item.type,
      'inbox.source': item.source,
      'inbox.sessionId': item.sessionId,
    });

    // ── channelSessionId 缺失告警（非 PDCA 来源的审批必须有来源追踪）──
    if (
      item.type === 'approval' &&
      item.source !== 'pdca' &&
      !item.channelSessionId &&
      !item.metadata?.sourceModule
    ) {
      logger.warn('Inbox item missing source reference', {
        type: item.type,
        title: item.title,
        source: item.source,
      });
      item.metadata = { ...item.metadata, _orphan: true };
    }

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

      // BEGIN IMMEDIATE 事务保护并发写入
      await new Promise<void>((resolve, reject) => {
        db.run('BEGIN IMMEDIATE', (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        await new Promise<void>((resolve, reject) => {
          db.run(
            `INSERT INTO inbox_items (id, session_id, type, title, message, status, options, offline_capable, source, metadata, channel_id, channel_session_id, channel_conversation_id, trace_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              full.channelId ?? null,
              full.channelSessionId ?? null,
              full.channelConversationId ?? null,
              full.traceId ?? null,
              full.createdAt,
              full.updatedAt,
            ],
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        // 自动写入 session_inbox_map 关联
        if (full.channelSessionId) {
          await new Promise<void>((resolve, reject) => {
            db.run(
              `INSERT OR IGNORE INTO session_inbox_map (session_id, inbox_item_id, created_at) VALUES (?, ?, ?)`,
              [full.channelSessionId, full.id, now],
              (err: Error | null) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        await new Promise<void>((resolve, reject) => {
          db.run('COMMIT', (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (innerErr) {
        await new Promise<void>((resolve) => {
          db.run('ROLLBACK', () => resolve());
        });
        throw innerErr;
      }

      logger.info('Inbox item submitted', {
        id,
        type: item.type,
        title: item.title,
        channelSessionId: item.channelSessionId,
        traceId: item.traceId,
      });
      span.setAttribute('inbox.id', id);
      otel.endSpan(span, SpanStatusCode.OK);
      void this._auditLog(
        id,
        'submitted',
        'system',
        `Inbox item submitted: ${item.title}`
      );

      // SSE 实时推送新 Inbox 项到前端（P1-1: 附带 sessionId 供前端定位会话实时展示决策卡片）
      void broadcastEvent('inbox:new', {
        id,
        type: item.type,
        title: item.title,
        status: 'pending',
        sessionId: item.sessionId,
        channelId: item.channelId,
        traceId: item.traceId,
      });

      // P0-1: 移除桥接写入消息中心（approval/todo 决策类不再进消息中心，决策 100% 走会话流式 InboxBlock）

      // 自动注入 Inbox block 到聊天消息（会话内可见交互卡片）
      if (sessionId) {
        const actions = _buildDefaultActions(item);
        void _injectInboxBlock(sessionId, messageId, {
          inboxId: id,
          type: item.type,
          title: item.title,
          content: item.message || '',
          status: 'pending',
          priority: 'normal',
          actions,
          channelSource: item.channelId,
        }).catch(() => {
          /* block 注入失败不影响主流程 */
        });
      }

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
      // inbox-handlers 的 CAS 锁（tryUpdateStatus pending→processing）成功后调用本方法，
      // 故 processing（已抢锁）与 pending 均应放行；其余状态视为已处理/不存在。
      if (
        !item ||
        (item.status !== 'pending' && item.status !== 'processing')
      ) {
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
      void this._auditLog(id, 'replied', 'user', `Reply: ${reply}`, {
        selectedOption: _selectedOption,
      });

      // 异步回传审批结果到来源渠道（失败不阻塞主流程）
      if (item.channelSessionId && item.channelId) {
        import('../channels/bridge/inboxChannelReply.js')
          .then(({ relayReplyToChannel }) => relayReplyToChannel(item))
          .catch(() => {
            /* 回传失败不影响 Inbox 主流程 */
          });
      }

      // SSE 推送状态更新到前端
      void broadcastEvent('inbox:update', {
        id,
        status: 'replied',
        reply,
        sessionId: item.sessionId,
      });

      // 桥接：按 Inbox source_ref 标记对应通知为已处理
      void (async () => {
        try {
          const { notificationPersistence } =
            await import('@modules/runtime/NotificationPersistence.js');
          await notificationPersistence().resolveBySourceRef(item.id);
        } catch {
          /* 通知更新失败不影响 Inbox 主流程 */
        }
      })();

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

    // 先查询将要过期的项（获取 channelSessionId 用于通知）
    const expiredItems = await new Promise<InboxItem[]>((resolve, reject) => {
      db.all(
        `SELECT * FROM inbox_items WHERE status = 'pending' AND created_at < ?`,
        [cutoff],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows.map((r) => this._mapRow(r)));
        }
      );
    });

    const count = await new Promise<number>((resolve, reject) => {
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

    // 通知渠道：已过期的审批项
    for (const item of expiredItems) {
      // SSE 推送过期状态到前端
      void broadcastEvent('inbox:update', {
        id: item.id,
        status: 'expired',
        sessionId: item.sessionId,
      });

      if (item.channelSessionId) {
        try {
          const { notifyExpired } =
            await import('@modules/channels/bridge/inboxChannelReply.js');
          await notifyExpired(item);
        } catch (err) {
          logger.warn('Expired notification failed', {
            inboxId: item.id,
            channelSessionId: item.channelSessionId,
            error: String(err),
          });
        }
      }
    }

    // 清理已过期项的关联记录
    try {
      await new Promise<void>((resolve, reject) => {
        db.run(
          `DELETE FROM session_inbox_map WHERE inbox_item_id IN (SELECT id FROM inbox_items WHERE status = 'expired')`,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch (err) {
      logger.warn('session_inbox_map cleanup failed', { error: String(err) });
    }

    return count;
  }

  /**
   * CAS 状态更新（幂等性保护）
   * 仅当当前状态为 expected 时更新为 target
   * @returns true 表示更新成功，false 表示状态已变更（并发冲突）
   */
  async tryUpdateStatus(
    id: string,
    expected: InboxItemStatus,
    target: InboxItemStatus
  ): Promise<boolean> {
    const db = await this.getDb();
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `UPDATE inbox_items SET status = ?, updated_at = ? WHERE id = ? AND status = ?`,
        [target, Date.now(), id, expected],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  /** 重置审批项状态为 pending（用于审批撤销） */
  async resetStatus(id: string, status: InboxItemStatus): Promise<boolean> {
    const db = await this.getDb();
    return new Promise<boolean>((resolve, reject) => {
      db.run(
        `UPDATE inbox_items SET status = ?, reply = NULL, replied_at = NULL, updated_at = ? WHERE id = ?`,
        [status, Date.now(), id],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    }).then(async (result) => {
      if (result) {
        await this._auditLog(id, 'undone', 'user:web', 'Approval undone');
      }
      return result;
    });
  }

  /** 写入审批审计日志 */
  private async _auditLog(
    itemId: string,
    event: string,
    actor: string,
    detail?: string,
    meta?: Record<string, unknown>
  ): Promise<void> {
    try {
      const db = await this.getDb();
      const item = await this.get(itemId);
      const id = randomUUID();
      await new Promise<void>((resolve, reject) => {
        db.run(
          `INSERT INTO approval_audit_log (id, item_id, session_id, event, actor, detail, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            itemId,
            item?.sessionId ?? '',
            event,
            actor,
            detail ?? null,
            meta ? JSON.stringify(meta) : null,
            Date.now(),
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch {
      // 审计日志失败不阻塞主流程
    }
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
      channelId: (row.channel_id as string) || undefined,
      channelSessionId: (row.channel_session_id as string) || undefined,
      channelConversationId:
        (row.channel_conversation_id as string) || undefined,
      traceId: (row.trace_id as string) || undefined,
    };
  }

  /** 记录 Inbox 项与渠道会话的关联 */
  async linkSession(sessionId: string, inboxItemId: string): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO session_inbox_map (session_id, inbox_item_id, created_at) VALUES (?, ?, ?)`,
        [sessionId, inboxItemId, Date.now()],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /** 查询某渠道会话关联的所有 Inbox 项 */
  async getBySession(sessionId: string): Promise<InboxItem[]> {
    const db = await this.getDb();
    const rows = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        db.all(
          `SELECT i.* FROM inbox_items i
           JOIN session_inbox_map m ON i.id = m.inbox_item_id
           WHERE m.session_id = ?
           ORDER BY i.created_at DESC`,
          [sessionId],
          (err: Error | null, rows: Record<string, unknown>[]) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      }
    );
    return rows.map((r) => this._mapRow(r));
  }

  /**
   * Orphan 补偿：根据 traceId 尝试回填 channelSessionId
   * traceId 格式: ch_trc_{channelId}_{timestamp}_{random4}
   */
  async repairOrphan(inboxItemId: string): Promise<boolean> {
    const item = await this.get(inboxItemId);
    if (!item || !item.traceId) return false;

    const parts = item.traceId.split('_');
    if (parts.length < 3) return false;

    const channelId = parts[2];
    const db = await this.getDb();

    try {
      await new Promise<void>((resolve, reject) => {
        db.run(
          `UPDATE inbox_items SET channel_id = ? WHERE id = ?`,
          [channelId, inboxItemId],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      logger.info('Orphan repaired', {
        inboxItemId,
        channelId,
        traceId: item.traceId,
      });
      return true;
    } catch (err) {
      logger.warn('Orphan repair failed', { inboxItemId, error: String(err) });
      return false;
    }
  }

  /**
   * 清理 session_inbox_map 中的孤立记录（inbox 项不存在）
   */
  async cleanupOrphanMappings(): Promise<number> {
    const db = await this.getDb();
    return new Promise<number>((resolve, reject) => {
      db.run(
        `DELETE FROM session_inbox_map WHERE inbox_item_id NOT IN (SELECT id FROM inbox_items)`,
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

// ─── Helper: Inbox Block 注入 ────────────────────────

/** 根据 Inbox 类型 + options 生成操作按钮 */
function _buildDefaultActions(item: {
  type: InboxItemType;
  options?: string[];
}): Array<{
  label: string;
  reply: string;
  style: 'primary' | 'danger' | 'secondary';
}> {
  if (item.type === 'approval') {
    const actions: Array<{
      label: string;
      reply: string;
      style: 'primary' | 'danger' | 'secondary';
    }> = [
      { label: '批准', reply: 'approve', style: 'primary' },
      { label: '拒绝', reply: 'reject', style: 'danger' },
    ];
    // P2-4: 命令类工具的白名单按钮（粒度由用户每次点击自主选择）
    const opts = item.options || [];
    if (opts.includes('allowlist_tool')) {
      actions.push({
        label: '白名单·工具级',
        reply: 'allowlist_tool',
        style: 'secondary',
      });
    }
    if (opts.includes('allowlist_command')) {
      actions.push({
        label: '白名单·仅此命令',
        reply: 'allowlist_command',
        style: 'secondary',
      });
    }
    return actions;
  }
  if (item.type === 'question') {
    return [
      { label: '确认', reply: 'confirm', style: 'primary' },
      { label: '取消', reply: 'cancel', style: 'secondary' },
    ];
  }
  return [
    { label: '授权', reply: 'authorize', style: 'primary' },
    { label: '拒绝', reply: 'deny', style: 'danger' },
  ];
}

/** 将 Inbox block 注入到聊天消息中（通过 SessionGateway 持久化管线） */
async function _injectInboxBlock(
  sessionId: string,
  messageId: string | undefined,
  data: Record<string, unknown>
): Promise<void> {
  const { randomUUID } = await import('crypto');
  const { createSessionGateway } =
    await import('@modules/session/SessionGateway.js');

  const gateway = createSessionGateway();
  const allMessages = await gateway.getMessages(sessionId);

  // 如果未指定 messageId，自动查找该会话最新的助手消息
  let targetMessageId = messageId;
  if (!targetMessageId) {
    const lastAssistant = allMessages
      .filter((m) => m.role === 'assistant')
      .pop();
    if (!lastAssistant) return;
    targetMessageId = lastAssistant.id;
  }

  // 读取当前消息并追加 inbox block
  const msg = allMessages.find((m) => m.id === targetMessageId);
  if (!msg) return;

  const existingBlocks = (msg.blocks ?? []) as unknown as Record<
    string,
    unknown
  >[];
  const updatedBlocks = [
    ...existingBlocks,
    {
      id: randomUUID(),
      type: 'inbox' as const,
      content: '',
      inboxData: data,
    },
  ];

  await gateway.updateMessage(sessionId, targetMessageId, {
    ...msg,
    blocks: updatedBlocks as unknown as FrontendMessageBlock[],
  });
}

export const inboxManager = new InboxManager();

// P2-1: 审批过期调度 —— 启动后定期把超时 pending 审批置 expired
inboxManager.startExpireScheduler();

// Re-export unattended mode for convenience
export { unattendedMode } from './UnattendedModeManager.js';
