// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SettlementOutbox —— 子代理**结算信号**的可靠投递台账（方案 O8）
 *
 * 解决的问题：结算通知（`notifyYieldSettled`）此前是**纯内存广播** ——
 * 若进程在"子代理已结算 → 父会话被恢复"之间崩溃，这次结算**永久丢失**，
 * 等待中的父会话永远等不到恢复（A7/A10 类故障的最后一环）。
 *
 * 投递状态机（四态）：
 * ```
 *  enqueue()          claim()             ack()
 *  ─────────▶ pending ─────────▶ attempting ─────────▶ delivered
 *                 │                   │
 *                 │ 失败/超次          │ 失败/超次
 *                 ▼                   ▼
 *              failed ─────────────▶ dropped（放弃投递，终止重放）
 * ```
 * - `pending`：已落台账、**尚未开始**投递（崩溃 ⇒ 无标记重投即可）；
 * - **`attempting`**：已发出、**在 await 中崩溃 ⇒ 对端可能已收到** ⇒
 *   重投**必须带可见标记**（`restored`），否则会造成**重复恢复**（G15）；
 * - `delivered`：收到 ack（`handleYieldSettlement` 返回 `true`）⇒ 剪除；
 * - `failed` / `dropped`：重试超上限（{@link MAX_DELIVERY_ATTEMPTS}）⇒ 终止重放。
 *
 * 回放与上限：只回放 **48h 内** 且 `attempts < MAX_DELIVERY_ATTEMPTS` 的行；
 * 台账保留 **500 行 / 7 天**（⑥，避免无界增长）。
 *
 * 连接不泄漏：单例持一个连接，`close()` 显式释放。
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:yield:settlementOutbox');

export const SETTLEMENT_OUTBOX_TABLE = 'agent_settlement_outbox';

/** ⑦ 重试上限（对齐委派侧 `_MAX_ATTEMPTS = 8`） */
export const MAX_DELIVERY_ATTEMPTS = 8;
/** ④ 回放年龄上限 48h */
export const REPLAY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
/** ⑥ 台账保留上限：行数 + 年龄 */
export const OUTBOX_MAX_ROWS = 500;
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 投递状态（四态）。
 * `attempting` 的存在意义：区分"从未发出"（pending，可无标记重投）与
 * "可能已发出"（attempting，重投须带可见标记）。
 */
export type DeliveryState =
  | 'pending'
  | 'attempting'
  | 'delivered'
  | 'failed'
  | 'dropped';

export interface SettlementDeliveryRow {
  id: number;
  sessionId: string;
  endedAt: number;
  state: DeliveryState;
  attempts: number;
  /** ⑤ 是否属于"重放投递"（对端据此在恢复内容里带可见标记，避免重复恢复被误认为首次） */
  restored: boolean;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export class SettlementOutbox {
  private db: Database | null = null;
  private dbPath?: string;
  private initPromise: Promise<void> | null = null;

  /** @param dbPath 显式库路径（测试用）；缺省由 `init()` 惰性解析 `resolveDbPath()` */
  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    const dbPath =
      this.dbPath ?? (await import('@modules/core')).resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${SETTLEMENT_OUTBOX_TABLE} (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        ended_at    INTEGER NOT NULL,
        state       TEXT NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        restored    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_settlement_outbox_state
       ON ${SETTLEMENT_OUTBOX_TABLE} (state, created_at)`
    );
  }

  /**
   * ① 先落台账再投递：入队（`pending`）。
   *
   * 幂等：同一 (sessionId, endedAt) 已存在时**不新增行**（避免同一结算被重复入队）。
   */
  async enqueue(params: {
    sessionId: string;
    endedAt: number;
    restored?: boolean;
  }): Promise<number> {
    await this.init();
    const existing = await this.get<{ id: number }>(
      `SELECT id FROM ${SETTLEMENT_OUTBOX_TABLE}
       WHERE session_id = ? AND ended_at = ? LIMIT 1`,
      [params.sessionId, params.endedAt]
    );
    if (existing) return existing.id;

    const now = Date.now();
    await this.run(
      `INSERT INTO ${SETTLEMENT_OUTBOX_TABLE}
        (session_id, ended_at, state, attempts, restored, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?, ?)`,
      [params.sessionId, params.endedAt, params.restored ? 1 : 0, now, now]
    );
    const row = await this.get<{ id: number }>(
      `SELECT id FROM ${SETTLEMENT_OUTBOX_TABLE}
       WHERE session_id = ? AND ended_at = ? ORDER BY id DESC LIMIT 1`,
      [params.sessionId, params.endedAt]
    );
    const id = row?.id ?? 0;
    await this.prune();
    return id;
  }

  /**
   * ②③ claim：领取投递（`pending|failed|attempting → attempting`，`attempts+1`）。
   *
   * `attempting → attempting` 也允许（崩溃后重放同一行），但会累加 attempts 直至上限。
   *
   * @returns 领取成功返回该行（调用方据此投递并在 ack 后落 `delivered`）
   */
  async claim(id: number): Promise<SettlementDeliveryRow | null> {
    await this.init();
    const row = await this.getRow(id);
    if (!row) return null;
    if (row.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await this.markDropped(id, `超过重试上限 ${MAX_DELIVERY_ATTEMPTS}`);
      return null;
    }
    const now = Date.now();
    await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
       SET state = 'attempting', attempts = attempts + 1, updated_at = ?
       WHERE id = ?`,
      [now, id]
    );
    return await this.getRow(id);
  }

  /** ③ ack 成功 ⇒ `delivered`（可剪除；保留至保留期以留痕） */
  async markDelivered(id: number): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
       SET state = 'delivered', updated_at = ? WHERE id = ?`,
      [Date.now(), id]
    );
  }

  /** 投递失败 ⇒ `failed`（仍可再 claim 重试，直至超上限转 `dropped`） */
  async markFailed(id: number, error: string): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
       SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
      [error, Date.now(), id]
    );
  }

  /** 放弃投递（超上限/不可恢复）⇒ `dropped`，重放不再拾取 */
  async markDropped(id: number, reason: string): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
       SET state = 'dropped', last_error = ?, updated_at = ? WHERE id = ?`,
      [reason, Date.now(), id]
    );
  }

  /**
   * ④⑤ 回放候选：`pending|failed|attempting` 且 **48h 内** 且 `attempts < 上限`。
   *
   * `attempting` 命中的行 ⇒ 调用方必须带 `restored=true` 标记重投（避免重复恢复被当成首次）。
   */
  async listReplayable(now = Date.now()): Promise<SettlementDeliveryRow[]> {
    await this.init();
    const rows = await this.all<Record<string, unknown>>(
      `SELECT * FROM ${SETTLEMENT_OUTBOX_TABLE}
       WHERE state IN ('pending', 'failed', 'attempting')
         AND created_at >= ?
         AND attempts < ?
       ORDER BY created_at ASC`,
      [now - REPLAY_MAX_AGE_MS, MAX_DELIVERY_ATTEMPTS]
    );
    return rows.map(SettlementOutbox.toRow);
  }

  /** ⑥ 保留裁剪：删 7 天前 + 只保留最近 {@link OUTBOX_MAX_ROWS} 行（优先删已投递） */
  async prune(now = Date.now()): Promise<number> {
    await this.init();
    let removed = await this.run(
      `DELETE FROM ${SETTLEMENT_OUTBOX_TABLE} WHERE created_at < ?`,
      [now - OUTBOX_MAX_AGE_MS]
    );
    removed += await this.run(
      `DELETE FROM ${SETTLEMENT_OUTBOX_TABLE}
       WHERE state = 'delivered'
         AND id NOT IN (
           SELECT id FROM ${SETTLEMENT_OUTBOX_TABLE} WHERE state = 'delivered'
           ORDER BY created_at DESC LIMIT ?
         )`,
      [OUTBOX_MAX_ROWS]
    );
    return removed;
  }

  /** 查询单行（巡检/测试用） */
  async getRow(id: number): Promise<SettlementDeliveryRow | null> {
    await this.init();
    const row = await this.get<Record<string, unknown>>(
      `SELECT * FROM ${SETTLEMENT_OUTBOX_TABLE} WHERE id = ?`,
      [id]
    );
    return row ? SettlementOutbox.toRow(row) : null;
  }

  /** 列出全部行（巡检/测试用） */
  async listAll(): Promise<SettlementDeliveryRow[]> {
    await this.init();
    const rows = await this.all<Record<string, unknown>>(
      `SELECT * FROM ${SETTLEMENT_OUTBOX_TABLE} ORDER BY id ASC`
    );
    return rows.map(SettlementOutbox.toRow);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  // ==================== 内部：sqlite 封装 ====================

  private run(sql: string, params: unknown[] = []): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<number>((resolve, reject) => {
      this.db!.run(
        sql,
        params,
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
  }

  private get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<T | null>((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: T | undefined) =>
        err ? reject(err) : resolve(row ?? null)
      );
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: T[] | undefined) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }

  private static toRow(raw: Record<string, unknown>): SettlementDeliveryRow {
    return {
      id: Number(raw['id']),
      sessionId: String(raw['session_id']),
      endedAt: Number(raw['ended_at']),
      state: raw['state'] as DeliveryState,
      attempts: Number(raw['attempts'] ?? 0),
      restored: Number(raw['restored'] ?? 0) === 1,
      lastError: (raw['last_error'] as string | null) ?? undefined,
      createdAt: Number(raw['created_at']),
      updatedAt: Number(raw['updated_at']),
    };
  }
}

let instance: SettlementOutbox | null = null;

/** 全局单例（惰性：首次使用才解析 DB 路径并建表） */
export function getSettlementOutbox(): SettlementOutbox {
  if (!instance) {
    instance = new SettlementOutbox();
    instance.init().catch((err) => {
      logger.error('SettlementOutbox 初始化失败', { error: String(err) });
    });
  }
  return instance;
}
