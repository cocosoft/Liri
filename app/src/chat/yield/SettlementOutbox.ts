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
// B4-2（2026-09-23）：恢复通路的相位标签（`yield:*`）—— 台账认领/状态写是恢复期的
// 两个真实阻塞点（SQLite 同步写），包相位后可由 `loopProbe` 逐条归因。
import { withPhase } from '@modules/diagnostics';

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
 * ⑧ 认领"陈旧窗口"（M-3 / P1-5）：`attempting` 行只有超过该时长才允许被**再次认领**。
 *
 * 作用：让 `claim()` 的并发语义成为**单胜者** ——
 * - 同一进程内的并发认领：先到者把行置 `attempting`，后者因未超窗口而**认领失败**（不再双投）；
 * - 崩溃后回放：`attempting` 行在窗口过后仍可被重投（否则该行永久卡死、无法自愈）。
 */
export const CLAIM_STALE_MS = 60_000;

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
    try {
      await this.initPromise;
    } catch (err) {
      // P1-1（M-3）：失败后**必须**清空 `initPromise`。
      // 原实现只在 `close()` 置 null ⇒ doInit 的 rejected promise 被**永久复用**：
      // 一次瞬时 DB 故障（锁竞争 / 路径未就绪）会让结算台账此后**永远不可用**，
      // 且每次调用都复现同一个陈旧错误（掩盖真实现场）。
      this.initPromise = null;
      throw err;
    }
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
    // 预存债务修复（2026-09-23）：把"同一 (session_id, ended_at) 至多一行**未终结**"
    // 从**应用层的先查后插**下沉为 **DB 级不变式**（部分唯一索引）。
    // 原缺陷：并发 `enqueue` 各自查到"无未终结行"并各自 INSERT（双行），且随后的
    // `ORDER BY id DESC LIMIT 1` 回读可能让两个调用方拿到**同一** id（另一行成孤儿）。
    await this._collapseDuplicateLiveRows();
    try {
      await this.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_outbox_live
         ON ${SETTLEMENT_OUTBOX_TABLE} (session_id, ended_at)
         WHERE state NOT IN ('delivered', 'dropped')`
      );
    } catch (err) {
      // 索引建不起来时**不得让结算台账不可用**（台账是投递前提，建索引失败就抛会让
      // 整个 yield 结算停摆 —— 比它要防的"重复行"更严重）。
      // 此时退回**应用层幂等**（`enqueue` 的预检查仍在）⇒ 并发缺口会重现，**必须留痕**（不静默降级）。
      logger.warn('settlementOutbox:live_unique_index_unavailable', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 预存债务修复（2026-09-23）：折叠**历史遗留**的重复"未终结"行（每组保留最新一条）。
   *
   * 只处理"同一 (session_id, ended_at) 存在多行未终结"这一**缺陷产物**（否则部分唯一
   * 索引创建会失败）：较旧的重复行置 `dropped`（终态）并留痕 `last_error`，
   * **审计可回溯、不物理删除**；无重复时为 no-op（一条 UPDATE 影响 0 行）。
   */
  private async _collapseDuplicateLiveRows(): Promise<void> {
    await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
          SET state = 'dropped',
              last_error = COALESCE(last_error, 'collapsed:duplicate_live_row'),
              updated_at = ?
        WHERE state NOT IN ('delivered', 'dropped')
          AND id NOT IN (
            SELECT MAX(id) FROM ${SETTLEMENT_OUTBOX_TABLE}
             WHERE state NOT IN ('delivered', 'dropped')
             GROUP BY session_id, ended_at
          )`,
      [Date.now()]
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
    // P1-4（M-3）：幂等键 = `(session_id, ended_at)`，但**只对未终结行**复用。
    // 原实现不过滤 state ⇒ 同键的**新**结算事件会被静默合并进已 `delivered`/`dropped`
    // 的旧行（丢的是"本次投递的独立身份"，即重放锚点与审计粒度）。现改为：
    // · 未终结（pending / attempting / failed）⇒ 复用（真幂等，同一事件不重复入队）；
    // · 已终结 ⇒ **插入新行**（历史行保留，审计可回溯）。
    const now = Date.now();
    // 兼容路径（**非冗余**）：唯一索引若因故未能建立（见 `doInit` 的 warn），本预检查
    // 仍提供应用层幂等；索引存在时它同时是**快路径**（命中 `idx_settlement_outbox_live`，
    // 代价极低），并让"顺序重复入队"无需依赖异常分支。
    const live = await this.get<{ id: number }>(
      `SELECT id FROM ${SETTLEMENT_OUTBOX_TABLE}
        WHERE session_id = ? AND ended_at = ?
          AND state NOT IN ('delivered', 'dropped')
        ORDER BY id DESC LIMIT 1`,
      [params.sessionId, params.endedAt]
    );
    if (live?.id) return live.id;

    // 预存债务修复（2026-09-23）：**取消"先查后插"作为唯一防线**（并发下失效），改由
    //   ① 单条 `INSERT ... RETURNING id` 直接拿到**本次插入**的 id（无回读竞态）；
    //   ② DB 级部分唯一索引 `idx_settlement_outbox_live` 保证"同键至多一行未终结"；
    //   ③ 并发第二个 INSERT 被唯一约束拒绝 ⇒ 走幂等回读（**真幂等**，不重复入队）。
    // 语义与上面的 P1-4 说明一致：**只有未终结行参与幂等**；已终结时新行照插。
    try {
      const inserted = await this.get<{ id: number }>(
        `INSERT INTO ${SETTLEMENT_OUTBOX_TABLE}
          (session_id, ended_at, state, attempts, restored, created_at, updated_at)
         VALUES (?, ?, 'pending', 0, ?, ?, ?)
         RETURNING id`,
        [params.sessionId, params.endedAt, params.restored ? 1 : 0, now, now]
      );
      if (inserted?.id) {
        await this.prune();
        return inserted.id;
      }
    } catch (err) {
      // 唯一约束拒绝属**预期并发分支**（非异常）；其它错误**照抛**（不掩盖真实故障，CS03）
      if (!/UNIQUE/i.test(String(err))) throw err;
      logger.debug('settlementOutbox:enqueue_idempotent_hit', {
        sessionId: params.sessionId,
        endedAt: params.endedAt,
      });
    }

    const existing = await this.get<{ id: number }>(
      `SELECT id FROM ${SETTLEMENT_OUTBOX_TABLE}
        WHERE session_id = ? AND ended_at = ?
          AND state NOT IN ('delivered', 'dropped')
        ORDER BY id DESC LIMIT 1`,
      [params.sessionId, params.endedAt]
    );
    return existing?.id ?? 0;
  }

  /**
   * ②③ claim：领取投递（`pending|failed|attempting → attempting`，`attempts+1`）。
   *
   * `attempting → attempting` **仅在超过 {@link CLAIM_STALE_MS} 陈旧窗口后**允许
   * （崩溃后自愈重投）；窗口内重复认领一律失败 ⇒ 并发时**单胜者**。
   *
   * @returns 领取成功返回该行（调用方据此投递并在 ack 后落 `delivered`）
   */
  async claim(id: number): Promise<SettlementDeliveryRow | null> {
    // B4-2（2026-09-23）：认领是恢复期的**共用端口**（运行期投递与崩溃回放都走它）
    // ⇒ 包相位 `yield:claim`，使"恢复期卡在认领"可归因。
    // 相位栈是固定容量的轻量栈（O(1)、无 I/O）⇒ 不改变并发语义、不引入热路径开销。
    return withPhase('yield:claim', () => this.claimImpl(id));
  }

  /** `claim` 的实现体（相位包装使公开签名保持不变 ⇒ 调用方零改动） */
  private async claimImpl(id: number): Promise<SettlementDeliveryRow | null> {
    await this.init();
    const now = Date.now();
    // P1-2 / P1-5（M-3）：**条件更新 + `changes` 判定**（原子认领）。
    // 原实现是 `getRow()` → `UPDATE` 两段式：并发 claim 各自通过检查、各自 `attempts+1`
    // ⇒ 上限被越过、同一行被**投递两次**（运行期投递与回放共用本方法）。
    //
    // 单胜者条件：
    // · `state IN ('pending','failed')` ⇒ 首次认领；
    // · `state = 'attempting' AND updated_at < 陈旧阈值` ⇒ 崩溃后**自愈重投**
    //   （窗口内不再放行，避免与在飞的投递并发）。
    // `attempts < MAX` 同时约束在 UPDATE 内 ⇒ 不再依赖先读后写。
    const staleBefore = now - CLAIM_STALE_MS;
    const changed = await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
         SET state = 'attempting', attempts = attempts + 1, updated_at = ?
       WHERE id = ?
         AND attempts < ?
         AND (state IN ('pending', 'failed')
              OR (state = 'attempting' AND updated_at < ?))`,
      [now, id, MAX_DELIVERY_ATTEMPTS, staleBefore]
    );
    if (changed === 0) {
      // 未获认领：区分"超重试上限"（转 dropped，终止重放）与
      // "已被他人认领 / 仍在陈旧窗口内"（本调用方**不得**投递）
      const row = await this.getRow(id);
      if (row && row.attempts >= MAX_DELIVERY_ATTEMPTS) {
        await this.markDropped(id, `超过重试上限 ${MAX_DELIVERY_ATTEMPTS}`);
      }
      return null;
    }
    return await this.getRow(id);
  }

  /**
   * 状态写入的**统一入口** —— 带**终态守卫**（P1-9 / I4 单向状态机）。
   *
   * 修复前 `markDelivered/markFailed/markDropped` 都是无条件 `UPDATE`：
   * `dropped` 可被改回 `delivered`（且重放与运行期共用）⇒ 状态机非单向、
   * `attempting` 语义失效、审计结论随最后写入者漂移。
   * 现统一为 `WHERE state NOT IN ('delivered','dropped')` —— 终态**不可改写**。
   *
   * @returns 是否真的发生迁移（`false` = 行不存在或已是终态）
   */
  private async writeState(
    id: number,
    state: 'delivered' | 'failed' | 'dropped',
    lastError?: string
  ): Promise<boolean> {
    // B4-2（2026-09-23）：状态写是恢复期的**落定端口**（三个 `mark*` 的唯一入口）
    // ⇒ 包相位 `yield:state`；与 `yield:claim` 成对，使"认领成功但落定慢"可分辨。
    return withPhase('yield:state', () =>
      this.writeStateImpl(id, state, lastError)
    );
  }

  /** `writeState` 的实现体（相位包装使调用方零改动） */
  private async writeStateImpl(
    id: number,
    state: 'delivered' | 'failed' | 'dropped',
    lastError?: string
  ): Promise<boolean> {
    const changed = await this.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE}
         SET state = ?, last_error = COALESCE(?, last_error), updated_at = ?
       WHERE id = ? AND state NOT IN ('delivered', 'dropped')`,
      [state, lastError ?? null, Date.now(), id]
    );
    if (changed === 0) {
      logger.debug('结算台账状态未迁移（已终态或行不存在）', { id, state });
    }
    return changed > 0;
  }

  /** ③ ack 成功 ⇒ `delivered`（可剪除；保留至保留期以留痕） */
  async markDelivered(id: number): Promise<boolean> {
    await this.init();
    return this.writeState(id, 'delivered');
  }

  /** 投递失败 ⇒ `failed`（仍可再 claim 重试，直至超上限转 `dropped`） */
  async markFailed(id: number, error: string): Promise<boolean> {
    await this.init();
    return this.writeState(id, 'failed', error);
  }

  /** 放弃投递（超上限/不可恢复）⇒ `dropped`，重放不再拾取 */
  async markDropped(id: number, reason: string): Promise<boolean> {
    await this.init();
    return this.writeState(id, 'dropped', reason);
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
