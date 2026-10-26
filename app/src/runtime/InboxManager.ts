/**
 * InboxManager — 统一交互队列
 *
 * 将所有需要用户决策的操作（审批、提问、授权）统一路由到 Inbox——
 * 一个跨会话、支持持久化和离线处理的消息队列。
 *
 * 对标 OpenWorker Inbox 抽象设计。
 */

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { Database } from '@openliri/kernel/external/sqlite3';
import { resolveDbPath, resolveTenantDbPath } from '@openliri/kernel/paths';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalFromKey,
  principalKeyOf,
  runWithPrincipal,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { randomUUID } from 'crypto';
import { broadcastEvent } from '@modules/infrastructure';
import type { FrontendMessageBlock } from '@modules/session/types/UnifiedMessage.js';

const logger = getLogger('runtime:inbox');

// ─── 类型定义 ──────────────────────────────────────────

export type InboxItemType = 'approval' | 'question' | 'authorization';
export type InboxItemStatus =
  | 'pending'
  | 'processing'
  | 'replied'
  | 'expired'
  | 'dismissed';

/**
 * 状态字面量的**唯一事实源**（审批解析在 `runtime/inboxApproval` 里做 CAS 比较，
 * 不得再裸写 `'pending'` / `'processing'` —— 状态字面量棘轮要求登记或引用常量）
 */
export const INBOX_STATUS_PENDING: InboxItemStatus = 'pending';
export const INBOX_STATUS_PROCESSING: InboxItemStatus = 'processing';

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
  /**
   * 多租户 P1（2026-10-21）：非本地身份的审批库连接（各自独立 app.db）。
   * `getDb()` 每次返回**当次身份**的连接，调用方都保存为局部变量
   * （`const db = await this.getDb()`）⇒ 不存在"共享字段换连接"的并发串库。
   */
  private scopedDbs = new Map<string, Database>();
  /** 调用方显式传路径（测试隔离）⇒ 不做身份分区 */
  private readonly explicitPath: boolean;

  constructor(dbPath?: string) {
    this.explicitPath = dbPath !== undefined;
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
      // 多租户 P3：定时器无请求作用域 ⇒ 必须显式遍历**所有已打开的分区库**
      // （原实现走 `expireOlderThan` → `getDb()` ⇒ 本地身份 ⇒ 租户库的 pending 永不过期）
      this.expireAllScopes(ttlMs).catch((err) => {
        logger.warn('审批过期清理失败', { error: String(err) });
      });
    }, intervalMs);
    this.expireTimer.unref?.();
  }

  /**
   * 停止审批过期调度（幂等）。
   */
  stopExpireScheduler(): void {
    if (!this.expireTimer) return;
    clearInterval(this.expireTimer);
    this.expireTimer = null;
  }

  /**
   * 资源释放入口。
   */
  dispose(): void {
    this.stopExpireScheduler();
  }

  private async getDb(): Promise<Database> {
    // 租户级 DB（§6.1）：本地身份 ⇒ 原共享连接（零变更）；已认证身份 ⇒ **该租户**的库
    const principal = getRequestPrincipal();
    const scope =
      this.explicitPath || isLocalPrincipal(principal)
        ? ''
        : principal.tenantId;

    if (scope === '') {
      if (this.db) return this.db;
      const opened = await this.open(this.dbPath);
      try {
        await this._createTable(opened);
      } catch (err) {
        // 初始化失败**不得缓存**：原实现先赋值 `this.db` 再建表，建表抛错后
        // `if (this.db) return this.db` 会让后续每次调用都跳过迁移 ⇒ 首次失败被永久固化。
        // 实测 2026-10-27：旧库缺 `owner_key` ⇒ 建索引抛错 ⇒ 审批通道整日不可用。
        try {
          opened.close();
        } catch {
          // 已关闭 / 关闭中：忽略
        }
        throw err;
      }
      this.db = opened;
      return this.db;
    }

    const cached = this.scopedDbs.get(scope);
    if (cached) return cached;
    const opened = await this.open(resolveTenantDbPath(principal));
    await this._createTable(opened);
    this.scopedDbs.set(scope, opened);
    // 登记键用**创建者**的 `<tenant>:<user>`：purge 按 `<tenant>:` 前缀关闭 ⇒ 删租户能命中
    registerScopedResource(principalKeyOf(principal), () => {
      try {
        opened.close();
      } catch {
        // 已关闭 / 关闭中：忽略
      }
      this.scopedDbs.delete(scope);
    });
    return opened;
  }

  /** 当前写入/查询的归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /** 打开连接（不建表） */
  private open(path: string): Promise<Database> {
    return new Promise<Database>((resolve, reject) => {
      const db = new Database(path, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  private async _createTable(db: Database): Promise<void> {
    // 修复: 原实现提前 return 导致 Phase 3/4/5（审计表、列迁移、session_inbox_map）成为死代码，
    // 旧库 inbox_items 缺 channel_id 等列使 submit() 必抛 SQLiteError，审批链路整体降级。
    await new Promise<void>((resolve, reject) => {
      db.exec(
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
          replied_at INTEGER,
          owner_key TEXT NOT NULL DEFAULT 'local:local'
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
      db.exec(
        `CREATE TABLE IF NOT EXISTS approval_audit_log (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          event TEXT NOT NULL,
          actor TEXT NOT NULL,
          detail TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          owner_key TEXT NOT NULL DEFAULT 'local:local'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_item ON approval_audit_log(item_id);
        CREATE INDEX IF NOT EXISTS idx_audit_session ON approval_audit_log(session_id);`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await this._ensureOwnerColumn(db, 'approval_audit_log');

    // Phase 4: 幂等列迁移（channel_id, channel_session_id, channel_conversation_id）
    await this._migrateSchema(db);

    // Phase 4.0（2026-10-27）：`owner_key` 索引**必须在补列之后**创建。
    // 原实现把它写在建表的同一个 `exec` 里 ⇒ 旧库（无该列）执行到
    // `CREATE INDEX … (owner_key)` 即抛 `table inbox_items has no column named owner_key`
    // ⇒ `_createTable` 整体失败 ⇒ 审批提交全部降级为 "Inbox unavailable"。
    await new Promise<void>((resolve, reject) => {
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_inbox_owner ON inbox_items(owner_key)',
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });

    // Phase 4.1（2026-10-23）：审批卡去重的 **DB 级兜底**（部分唯一索引）
    await this._ensureApprovalDedupeIndex(db);

    // Phase 5: 创建 session_inbox_map 关联表
    await new Promise<void>((resolve, reject) => {
      db.exec(
        `CREATE TABLE IF NOT EXISTS session_inbox_map (
          session_id TEXT NOT NULL,
          inbox_item_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          owner_key TEXT NOT NULL DEFAULT 'local:local',
          PRIMARY KEY (session_id, inbox_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sim_inbox ON session_inbox_map(inbox_item_id);
        CREATE INDEX IF NOT EXISTS idx_sim_session ON session_inbox_map(session_id);
        CREATE INDEX IF NOT EXISTS idx_sim_owner ON session_inbox_map(owner_key);`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    await this._ensureOwnerColumn(db, 'session_inbox_map');

    // P0-3（2026-10-27）：启动期 schema **自检** —— 三张表的必备列缺失即 error。
    // 实测教训：v0.5.15 之前 `owner_key` 缺失只留一条 warn，日志里看不出"审批已全废"。
    await this._assertSchemaComplete(db);
  }

  /**
   * P0-3：启动期 schema 自检（唯一判据 = 实际列集合，不猜）。
   *
   * 缺失不抛出（避免把"历史库"整体打死），但必须留 **error** 级日志，
   * 使健康检查/排查看得到"审批通道不可用"，而不是从业务失败反推。
   */
  private async _assertSchemaComplete(db: Database): Promise<void> {
    const required: Array<[string, string[]]> = [
      ['inbox_items', ['owner_key']],
      ['approval_audit_log', ['owner_key']],
      ['session_inbox_map', ['owner_key']],
    ];
    let failing = 0;
    for (const [table, cols] of required) {
      const rows = await new Promise<{ name: string }[]>((resolve, reject) => {
        db.all(`PRAGMA table_info(${table})`, (err, r) => {
          if (err) reject(err);
          else resolve(r as { name: string }[]);
        });
      });
      const have = new Set(rows.map((r) => r.name));
      const missing = cols.filter((c) => !have.has(c));
      if (missing.length > 0) {
        failing += 1;
        logger.error('inbox schema 缺列（审批通道将不可用）', {
          table,
          missing,
        });
      }
    }
    if (failing === 0) {
      logger.info('inbox schema 自检通过', {
        tables: required.map(([t]) => t),
      });
    }
  }

  /** 幂等列迁移：通过 PRAGMA table_info 检测列是否存在，仅新增缺失列 */
  private async _migrateSchema(db: Database): Promise<void> {
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
      [
        'owner_key',
        "ALTER TABLE inbox_items ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'",
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

    // 另两张表的补列在各自建表之后进行（新库已带列；旧库在此幂等补齐）
  }

  /** 幂等补列（`PRAGMA table_info` 判存在；`ALTER` 不能改主键，只补列） */
  private async _ensureOwnerColumn(db: Database, table: string): Promise<void> {
    const columns: { name: string }[] = await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(${table})`, (err: Error | null, rows) => {
        if (err) reject(err);
        else resolve(rows as { name: string }[]);
      });
    });
    if (columns.some((c) => c.name === 'owner_key')) return;
    await new Promise<void>((resolve, reject) => {
      db.run(
        `ALTER TABLE ${table} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  /**
   * 审批卡去重的 **DB 级约束**（2026-10-23，多租户/审批收口续做）。
   *
   * 提交前的 `findPendingApprovalId()` 只能覆盖"查询 → INSERT"之间没有并发插入的情况；
   * 多通道重试 / 多进程仍可能各插一张。这里补一条**部分唯一索引**（仅 `pending` 的
   * `approval`，且仅当 metadata 同时带 `toolName` + `commandHash`）作为最终兜底。
   *
   * 存量库可能已有重复项（历史缺陷所致）⇒ 建索引会失败。此时**不删用户数据**：
   * 记录告警并跳过索引（提交前去重仍生效），待重复项被处理后再随启动补建。
   */
  private async _ensureApprovalDedupeIndex(db: Database): Promise<void> {
    const duplicates = await new Promise<number>((resolve) => {
      db.get(
        `SELECT COUNT(*) AS cnt FROM (
           SELECT 1 FROM inbox_items
            WHERE type = 'approval' AND status = 'pending'
              AND json_extract(metadata, '$.toolName') IS NOT NULL
              AND json_extract(metadata, '$.commandHash') IS NOT NULL
            GROUP BY owner_key,
                     session_id,
                     json_extract(metadata, '$.toolName'),
                     json_extract(metadata, '$.commandHash')
           HAVING COUNT(*) > 1
         )`,
        (err: Error | null, row: { cnt?: number } | undefined) => {
          resolve(err ? -1 : Number(row?.cnt ?? 0));
        }
      );
    });

    if (duplicates < 0) {
      logger.warn('审批去重索引：存量重复项检查失败，跳过建索引');
      return;
    }
    if (duplicates > 0) {
      logger.warn('审批去重索引：存量存在重复的 pending 审批项，跳过建索引', {
        duplicateGroups: duplicates,
      });
      return;
    }

    await new Promise<void>((resolve) => {
      db.exec(
        `DROP INDEX IF EXISTS ux_inbox_pending_approval;
         CREATE UNIQUE INDEX IF NOT EXISTS ux_inbox_pending_approval
           ON inbox_items (
             owner_key,
             session_id,
             json_extract(metadata, '$.toolName'),
             json_extract(metadata, '$.commandHash')
           )
           WHERE type = 'approval' AND status = 'pending'
             AND json_extract(metadata, '$.toolName') IS NOT NULL
             AND json_extract(metadata, '$.commandHash') IS NOT NULL`,
        (err: Error | null) => {
          if (err) {
            logger.warn('审批去重索引创建失败（已跳过，不影响主流程）', {
              error: err.message,
            });
          } else {
            logger.info('审批去重唯一索引已就绪');
          }
          resolve();
        }
      );
    });
  }

  /** 唯一约束冲突是否来自审批去重索引 */
  private _isApprovalUniqueConflict(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /UNIQUE constraint failed/i.test(msg);
  }

  /**
   * 唯一约束冲突后的**兜底查询**：返回同一 `(sessionId, toolName, commandHash)`
   * 下最早的 pending 审批项，使并发竞态的调用方仍拿到可用卡片（而不是提交失败）。
   */
  private async _findPendingApprovalByFingerprint(
    db: Database,
    item: Omit<InboxItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<InboxItem | null> {
    const toolName = item.metadata?.toolName;
    const commandHash = item.metadata?.commandHash;
    if (
      item.type !== 'approval' ||
      typeof toolName !== 'string' ||
      typeof commandHash !== 'string'
    ) {
      return null;
    }
    const row = await new Promise<Record<string, unknown> | undefined>(
      (resolve) => {
        db.get(
          `SELECT * FROM inbox_items
            WHERE session_id = ? AND type = 'approval' AND status = 'pending'
              AND owner_key = ?
              AND json_extract(metadata, '$.toolName') = ?
              AND json_extract(metadata, '$.commandHash') = ?
            ORDER BY created_at ASC LIMIT 1`,
          [item.sessionId, this.owner(), toolName, commandHash],
          (err: Error | null, row: Record<string, unknown> | undefined) => {
            resolve(err ? undefined : row);
          }
        );
      }
    );
    return row ? this._mapRow(row) : null;
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
            `INSERT INTO inbox_items (id, session_id, type, title, message, status, options, offline_capable, source, metadata, channel_id, channel_session_id, channel_conversation_id, trace_id, created_at, updated_at, owner_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              this.owner(),
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
              `INSERT OR IGNORE INTO session_inbox_map (session_id, inbox_item_id, created_at, owner_key) VALUES (?, ?, ?, ?)`,
              [full.channelSessionId, full.id, now, this.owner()],
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
      // 2026-10-23：唯一索引兜底 —— 并发竞态下已有同一指纹的 pending 卡，
      // 返回既有项而不是让审批提交失败（卡片仍然可用）。
      if (this._isApprovalUniqueConflict(e)) {
        const existing = await this._findPendingApprovalByFingerprint(db, item);
        if (existing) {
          logger.info('审批项已存在（DB 唯一约束兜底），返回既有 pending 项', {
            id: existing.id,
            sessionId: existing.sessionId,
          });
          otel.endSpan(span, SpanStatusCode.OK);
          return existing;
        }
      }
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
        logger.warn('Inbox reply 拒绝（非 pending/processing）', {
          id,
          status: item?.status,
          reply,
        });
        otel.endSpan(
          span,
          SpanStatusCode.ERROR,
          item ? 'already_replied' : 'not_found'
        );
        return null;
      }

      // 排查审批链路：记录放行状态（pending/processing）与回复动作
      logger.info('Inbox item replied', {
        id,
        status: item.status,
        reply,
        type: item.type,
        title: item.title,
        sessionId: item.sessionId,
        channelSessionId: item.channelSessionId,
      });

      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        db.run(
          `UPDATE inbox_items SET status = 'replied', reply = ?, updated_at = ?, replied_at = ?
            WHERE id = ? AND owner_key = ?`,
          [reply, now, now, id, this.owner()],
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
          'SELECT * FROM inbox_items WHERE id = ? AND owner_key = ?',
          [id, this.owner()],
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
    // owner 过滤**恒在首位**（本地 ⇒ `local:local`；租户内 ⇒ `<tenant>:<user>`）
    const conditions: string[] = ['owner_key = ?'];
    const values: unknown[] = [this.owner()];

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
      ? 'SELECT COUNT(*) as cnt FROM inbox_items WHERE status = ? AND session_id = ? AND owner_key = ?'
      : 'SELECT COUNT(*) as cnt FROM inbox_items WHERE status = ? AND owner_key = ?';
    const params = sessionId
      ? ['pending', sessionId, this.owner()]
      : ['pending', this.owner()];

    const row = await new Promise<{ cnt: number }>((resolve, reject) => {
      db.get(sql, params, (err: Error | null, row: { cnt: number }) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    return row.cnt;
  }

  /** 清除过期项（当前身份库） */
  async expireOlderThan(maxAgeMs: number): Promise<number> {
    return this._expireOnDb(await this.getDb(), maxAgeMs);
  }

  /**
   * 多租户 P3：清理**所有已打开的分区库**（本地 + 本进程内建过的身份库）。
   *
   * 为什么只清"已打开"的：本仓还没有租户注册表可枚举（L3 的代价项之一），
   * 凭空为每个身份建库文件反而是扩散而非收敛 ⇒ 只清理已被访问过的库；
   * 某身份重启后首次访问时，其 pending 仍会由下一次 tick 清掉。
   *
   * 租户级库（§6.1）：清理是**跨用户**维护动作（不按当前身份过滤）；
   * 事件按行内 `owner_key` 回落到各自身份投递，避免把别人的审批状态广播出去。
   */
  async expireAllScopes(maxAgeMs: number): Promise<number> {
    let total = 0;
    if (this.db) total += await this._expireOnDb(this.db, maxAgeMs);
    for (const db of this.scopedDbs.values()) {
      // 租户库：过期是**跨用户**维护动作（不按当前身份过滤）；事件按行内 owner_key
      // 回落到各自身份（见 `_expireOnDb`），避免把别人的审批状态推给本地连接。
      total += await this._expireOnDb(db, maxAgeMs);
    }
    return total;
  }

  /** 过期清理的单一实现（连接由调用方给，避免再走 `getDb()` 的当前身份语义） */
  private async _expireOnDb(db: Database, maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;

    // 先查询将要过期的项（获取 channelSessionId 用于通知）+ 归属键（用于事件投递身份）
    const expired = await new Promise<
      Array<{ item: InboxItem; ownerKey?: string }>
    >((resolve, reject) => {
      db.all(
        `SELECT * FROM inbox_items WHERE status = 'pending' AND created_at < ?`,
        [cutoff],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else
            resolve(
              (rows ?? []).map((r) => ({
                item: this._mapRow(r),
                ownerKey:
                  typeof r.owner_key === 'string' ? r.owner_key : undefined,
              }))
            );
        }
      );
    });

    const count = await new Promise<number>((resolve, reject) => {
      db.run(
        `UPDATE inbox_items SET status = 'expired', updated_at = ?
          WHERE status = 'pending' AND created_at < ?`,
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

    // 通知渠道：已过期的审批项（按行归属身份投递，租户库下不会串到别人）
    for (const { item, ownerKey } of expired) {
      const emit = async (): Promise<void> => {
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
      };

      const principal = ownerKey ? principalFromKey(ownerKey) : null;
      if (principal) await runWithPrincipal(principal, emit);
      else await emit();
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
        `UPDATE inbox_items SET status = ?, updated_at = ?
          WHERE id = ? AND status = ? AND owner_key = ?`,
        [target, Date.now(), id, expected, this.owner()],
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
        `UPDATE inbox_items SET status = ?, reply = NULL, replied_at = NULL, updated_at = ?
          WHERE id = ? AND owner_key = ?`,
        [status, Date.now(), id, this.owner()],
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
          `INSERT INTO approval_audit_log (id, item_id, session_id, event, actor, detail, metadata, created_at, owner_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            itemId,
            item?.sessionId ?? '',
            event,
            actor,
            detail ?? null,
            meta ? JSON.stringify(meta) : null,
            Date.now(),
            this.owner(),
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
        `INSERT OR IGNORE INTO session_inbox_map (session_id, inbox_item_id, created_at, owner_key) VALUES (?, ?, ?, ?)`,
        [sessionId, inboxItemId, Date.now(), this.owner()],
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
           WHERE m.session_id = ? AND i.owner_key = ?
           ORDER BY i.created_at DESC`,
          [sessionId, this.owner()],
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
   * M2-T2.2（2026-08-31）：删除会话时级联关闭孤儿审批项。
   * 将该会话下 pending/processing 的审批项置为 dismissed（不可再答复），
   * 避免删除会话后 /v1/inbox 残留可答复项。
   * @returns 关闭的审批项数量
   */
  async dismissBySession(sessionId: string): Promise<number> {
    const db = await this.getDb();
    return new Promise<number>((resolve, reject) => {
      db.run(
        `UPDATE inbox_items SET status = 'dismissed', updated_at = ?
         WHERE session_id = ? AND status IN ('pending', 'processing')
           AND owner_key = ?`,
        [Date.now(), sessionId, this.owner()],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
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
          `UPDATE inbox_items SET channel_id = ?
            WHERE id = ? AND owner_key = ?`,
          [channelId, inboxItemId, this.owner()],
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
    }> = [{ label: '批准', reply: 'approve', style: 'primary' }];
    // PR-2（2026-10-23）四档：本会话都允许 / 始终允许（粒度为「工具 + 参数指纹」）
    const opts = item.options || [];
    if (opts.includes('approve_session')) {
      actions.push({
        label: '本会话都允许',
        reply: 'approve_session',
        style: 'secondary',
      });
    }
    if (opts.includes('allowlist_call')) {
      actions.push({
        label: '始终允许',
        reply: 'allowlist_call',
        style: 'secondary',
      });
    }
    // P2-4: 命令类工具的白名单按钮（粒度由用户每次点击自主选择）
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
    actions.push({ label: '拒绝', reply: 'reject', style: 'danger' });
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
  const { createSessionGateway } = await import('@modules/session');

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
