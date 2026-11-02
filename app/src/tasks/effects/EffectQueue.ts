/**
 * EffectQueue —— 统一 effects 队列（P38，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P38。
 *
 * 语义（与参考实现 `effects.ts` 对齐）：
 * - **先落库后执行**：`enqueue()` 只写库；派发由调用方（或其事务提交后钩子）触发；
 * - **Later**：`{ kind:'later' }` ⇒ 只前移 `due_at`、**attempts 不变**（暂停/槽位满不是失败）；
 * - **generation**：同 `(kind,key)` 再次 `enqueue` ⇒ `generation+1`；旧代次的
 *   `settle(..., generation)` 命中 0 行 ⇒ **不得**删除/改写新载荷；
 * - **FAILURES_BEFORE_ERROR=3**：前两次失败只退避重排，第 3 次才置 `failed`。
 *
 * 诚实边界：单进程内的领取/结算；跨进程由 `(kind,key)` 主键与 `generation` 比对兜底
 * （不做分布式租约）。
 */
import { Database } from '@openliri/infra/external';
import { resolveDbPath } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

import {
  EFFECT_CLAIM_STALE_MS,
  EFFECT_FAILURES_BEFORE_ERROR,
  EFFECT_DEFAULT_LATER_MS,
  EFFECT_KIND_MAX_ATTEMPTS,
  EFFECT_STATUS_ATTEMPTING,
  EFFECT_STATUS_FAILED,
  EFFECT_STATUS_PENDING,
  EFFECT_STATUS_SETTLED,
  EFFECT_STATUSES,
  effectRetryDelay,
  type ClaimEffectResult,
  type ClaimedEffect,
  type EffectEntry,
  type EffectKind,
  type EffectOutcome,
  type EffectStatus,
} from './types';

const logger = getLogger('tasks:effect-queue');

export const EFFECT_QUEUE_TABLE = 'effect_queue';

/** 本模块表结构（带域前缀，避免与其它台账的 `DDL` 同名被 `lint:consts` 判为重复常量） */
const EFFECT_DDL = [
  `CREATE TABLE IF NOT EXISTS ${EFFECT_QUEUE_TABLE} (
    kind         TEXT NOT NULL,
    key          TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    generation   INTEGER NOT NULL DEFAULT 1,
    status       TEXT NOT NULL DEFAULT '${EFFECT_STATUS_PENDING}',
    attempts     INTEGER NOT NULL DEFAULT 0,
    due_at       INTEGER NOT NULL,
    claimed_at   INTEGER,
    restored     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (kind, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_effect_due
     ON ${EFFECT_QUEUE_TABLE}(status, due_at)`,
];

interface EffectRow {
  kind: string;
  key: string;
  payload_json: string | null;
  generation: number;
  status: string;
  attempts: number;
  due_at: number;
  claimed_at: number | null;
  restored: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function toEntry(row: EffectRow): EffectEntry {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload_json ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // 坏 JSON ⇒ 空载荷（不猜；DB 边界校验）
  }
  return {
    kind: row.kind as EffectKind,
    key: row.key,
    payload,
    generation: Number(row.generation ?? 1),
    status: row.status as EffectStatus,
    attempts: Number(row.attempts ?? 0),
    dueAt: Number(row.due_at ?? 0),
    ...(row.claimed_at !== null && row.claimed_at !== undefined
      ? { claimedAt: Number(row.claimed_at) }
      : {}),
    ...(row.restored ? { restored: true } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export class EffectQueue {
  private db: Database | null = null;
  private initPromise: Promise<Database> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dbPath: string = resolveDbPath()) {}

  private init(): Promise<Database> {
    if (this.db) return Promise.resolve(this.db);
    this.initPromise ??= this.openAndCreate();
    return this.initPromise;
  }

  private async openAndCreate(): Promise<Database> {
    const db = await new Promise<Database>((resolve, reject) => {
      const d = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(d);
      });
    });
    try {
      for (const sql of EFFECT_DDL) {
        await new Promise<void>((resolve, reject) => {
          db.run(sql, (err) => (err ? reject(err) : resolve()));
        });
      }
      await this.ensureColumns(db);
    } catch (err) {
      db.close(() => {
        // @ignore-catch: 建表失败路径下尽力释放连接
      });
      this.initPromise = null;
      throw err;
    }
    this.db = db;
    return db;
  }

  /**
   * 存量库幂等补列（P38-b）：`CREATE TABLE IF NOT EXISTS` 不会给旧表加列。
   *
   * 只增不改；旧行 `claimed_at=NULL` / `restored=0`（等价"从未领取"）。
   */
  private async ensureColumns(db: Database): Promise<void> {
    const rows = await new Promise<Array<{ name: string }>>(
      (resolve, reject) => {
        db.all(`PRAGMA table_info(${EFFECT_QUEUE_TABLE})`, (err, result) => {
          if (err) reject(err);
          else resolve((result as Array<{ name: string }> | undefined) ?? []);
        });
      }
    );
    const existing = new Set(rows.map((r) => r.name));
    const additions: Array<[string, string]> = [
      ['claimed_at', 'INTEGER'],
      ['restored', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [name, type] of additions) {
      if (existing.has(name)) continue;
      await new Promise<void>((resolve, reject) => {
        db.run(
          `ALTER TABLE ${EFFECT_QUEUE_TABLE} ADD COLUMN ${name} ${type}`,
          (err) => (err ? reject(err) : resolve())
        );
      });
    }
  }

  private async run(sql: string, params: unknown[] = []): Promise<number> {
    const db = await this.init();
    return new Promise<number>((resolve, reject) => {
      db.run(sql, params, function (this: { changes: number }, err) {
        if (err) reject(err);
        else resolve(this.changes ?? 0);
      });
    });
  }

  private async allRows(
    sql: string,
    params: unknown[] = []
  ): Promise<EffectRow[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve((rows as EffectRow[] | undefined) ?? []);
      });
    });
  }

  /** 写入串行化（同键并发 enqueue 不会互相覆盖 generation） */
  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * 入队 / 更新载荷。
   *
   * 同 `(kind,key)` 再次入队 ⇒ `generation+1`、attempts 归零、状态回 `pending`
   * （新载荷是新工作）；`due_at` 取**较早**者，避免更新把已到期的活往后推。
   *
   * @returns 写入后的代次（调用方可用于日志/断言）
   */
  async enqueue(
    kind: EffectKind,
    key: string,
    payload: Record<string, unknown>,
    options: { dueAt?: number; now?: number } = {}
  ): Promise<number> {
    const now = options.now ?? Date.now();
    const dueAt = options.dueAt ?? now;
    return this.enqueueWrite(async () => {
      await this.run(
        `INSERT INTO ${EFFECT_QUEUE_TABLE}
           (kind, key, payload_json, generation, status, attempts, due_at,
            last_error, created_at, updated_at)
         VALUES (?, ?, ?, 1, '${EFFECT_STATUS_PENDING}', 0, ?, NULL, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET
           payload_json = excluded.payload_json,
           generation = ${EFFECT_QUEUE_TABLE}.generation + 1,
           status = '${EFFECT_STATUS_PENDING}',
           attempts = 0,
           due_at = MIN(${EFFECT_QUEUE_TABLE}.due_at, excluded.due_at),
           claimed_at = NULL,
           restored = 0,
           last_error = NULL,
           updated_at = excluded.updated_at`,
        [kind, key, JSON.stringify(payload ?? {}), dueAt, now, now]
      );
      const rows = await this.allRows(
        `SELECT generation FROM ${EFFECT_QUEUE_TABLE} WHERE kind = ? AND key = ?`,
        [kind, key]
      );
      return Number(rows[0]?.generation ?? 1);
    });
  }

  /** 领取到期的 pending 条目（按 due_at 升序；不改变状态，结算用 generation 比对） */
  async claimDue(now: number, limit = 20): Promise<ClaimedEffect[]> {
    const rows = await this.allRows(
      `SELECT * FROM ${EFFECT_QUEUE_TABLE}
        WHERE status = '${EFFECT_STATUS_PENDING}' AND due_at <= ?
        ORDER BY due_at ASC LIMIT ?`,
      [now, limit]
    );
    return rows.map((row) => ({ ...toEntry(row), claimedAt: now }));
  }

  /**
   * 派发候选（只读）：到期 `pending` **或**"超过陈旧窗口的 `attempting`"（崩溃自愈）。
   *
   * 扫描器据此取键，再逐条 `claimOne()`（原子单胜者）；本方法**不改状态**。
   */
  async listDueCandidates(now: number, limit = 20): Promise<EffectEntry[]> {
    const rows = await this.allRows(
      `SELECT * FROM ${EFFECT_QUEUE_TABLE}
        WHERE (status = '${EFFECT_STATUS_PENDING}' AND due_at <= ?)
           OR (status = '${EFFECT_STATUS_ATTEMPTING}'
               AND COALESCE(claimed_at, 0) + ? <= ?)
        ORDER BY due_at ASC LIMIT ?`,
      [now, EFFECT_CLAIM_STALE_MS, now, limit]
    );
    return rows.map((row) => toEntry(row));
  }

  /**
   * **原子领取**（P38-b）：`effect_pending`（到期）或"陈旧 `effect_attempting`" → `effect_attempting`。
   *
   * - 单胜者：`UPDATE … WHERE … AND generation/status`，命中 0 行即领取失败（并发不双投）；
   * - 陈旧窗口：`claimed_at + EFFECT_CLAIM_STALE_MS <= now` 才允许重领（崩溃自愈）；
   * - `restored=true` ⇒ 调用方必须带**可见标记**重投（对端可能已收到过）。
   * - 领取**不增加** attempts（只有失败结算才累计；`later` 仍不计失败）。
   */
  async claimOne(
    kind: EffectKind,
    key: string,
    now: number = Date.now()
  ): Promise<ClaimEffectResult> {
    return this.enqueueWrite(async () => {
      const rows = await this.allRows(
        `SELECT * FROM ${EFFECT_QUEUE_TABLE} WHERE kind = ? AND key = ?`,
        [kind, key]
      );
      const row = rows[0];
      if (!row) return { claimed: false };

      const due =
        row.status === EFFECT_STATUS_PENDING && Number(row.due_at) <= now;
      const stale =
        row.status === EFFECT_STATUS_ATTEMPTING &&
        Number(row.claimed_at ?? 0) + EFFECT_CLAIM_STALE_MS <= now;
      if (!due && !stale) return { claimed: false };

      const updated = await this.run(
        `UPDATE ${EFFECT_QUEUE_TABLE}
            SET status = ?, claimed_at = ?, restored = ?, updated_at = ?
          WHERE kind = ? AND key = ? AND generation = ? AND status = ?`,
        [
          EFFECT_STATUS_ATTEMPTING,
          now,
          stale ? 1 : 0,
          now,
          kind,
          key,
          Number(row.generation),
          row.status,
        ]
      );
      if (updated === 0) return { claimed: false };

      return {
        claimed: true,
        generation: Number(row.generation),
        restored: stale,
        payload: toEntry(row).payload,
        attempts: Number(row.attempts ?? 0),
      };
    });
  }

  /**
   * 结算一次派发（**必须带领取时的 generation**）。
   *
   * P38-b：只有 `effect_attempting` 才能结算 —— 未领取就结算视为编程错误
   * （返回 `false` 并 warn），避免"跳过领取直接标记完成"绕过崩溃语义。
   *
   * @returns `true` = 本次结算生效；`false` = 代次已过期（新载荷已在队列里，**不得改写**）
   */
  async settle(
    kind: EffectKind,
    key: string,
    generation: number,
    outcome: EffectOutcome,
    now: number = Date.now()
  ): Promise<boolean> {
    return this.enqueueWrite(async () => {
      // 先读一次用于 attempts 计算（写链串行 ⇒ 无进程内竞态）
      const rows = await this.allRows(
        `SELECT * FROM ${EFFECT_QUEUE_TABLE} WHERE kind = ? AND key = ?`,
        [kind, key]
      );
      const row = rows[0];
      if (!row) return false;
      // generation 不匹配 ⇒ 旧尝试，**不得**删除/改写新载荷（参考实现同语义）
      if (Number(row.generation) !== generation) {
        logger.debug('effect settle 代次过期（忽略旧尝试）', {
          kind,
          key,
          expected: generation,
          actual: row.generation,
        });
        return false;
      }
      if (row.status !== EFFECT_STATUS_ATTEMPTING) {
        logger.warn('effect settle 忽略：条目未被领取', {
          kind,
          key,
          status: row.status,
        });
        return false;
      }

      if (outcome.kind === 'done') {
        return (
          (await this.run(
            `UPDATE ${EFFECT_QUEUE_TABLE}
                SET status = '${EFFECT_STATUS_SETTLED}', last_error = NULL,
                    claimed_at = NULL, restored = 0, updated_at = ?
              WHERE kind = ? AND key = ? AND generation = ?
                AND status = '${EFFECT_STATUS_ATTEMPTING}'`,
            [now, kind, key, generation]
          )) > 0
        );
      }

      if (outcome.kind === 'later') {
        // 「推迟」不是失败：attempts 不变，回到 pending 并前移 due（暂停 / 槽位满）
        const retryAt = outcome.retryAt ?? now + EFFECT_DEFAULT_LATER_MS;
        return (
          (await this.run(
            `UPDATE ${EFFECT_QUEUE_TABLE}
                SET status = '${EFFECT_STATUS_PENDING}', due_at = ?,
                    claimed_at = NULL, restored = 0, updated_at = ?
              WHERE kind = ? AND key = ? AND generation = ?
                AND status = '${EFFECT_STATUS_ATTEMPTING}'`,
            [retryAt, now, kind, key, generation]
          )) > 0
        );
      }

      const attempts = Number(row.attempts ?? 0) + 1;
      // 每类上限（`reply` 取 8，其余沿用统一阈值）
      const maxAttempts =
        EFFECT_KIND_MAX_ATTEMPTS[kind] ?? EFFECT_FAILURES_BEFORE_ERROR;
      if (attempts >= maxAttempts) {
        // 连续失败达阈值 ⇒ 升级为系统问题（此前的每次失败都报错）
        return (
          (await this.run(
            `UPDATE ${EFFECT_QUEUE_TABLE}
                SET status = '${EFFECT_STATUS_FAILED}', attempts = ?, last_error = ?,
                    claimed_at = NULL, restored = 0, updated_at = ?
              WHERE kind = ? AND key = ? AND generation = ?
                AND status = '${EFFECT_STATUS_ATTEMPTING}'`,
            [attempts, outcome.error ?? null, now, kind, key, generation]
          )) > 0
        );
      }
      return (
        (await this.run(
          `UPDATE ${EFFECT_QUEUE_TABLE}
              SET status = '${EFFECT_STATUS_PENDING}', attempts = ?, due_at = ?,
                  last_error = ?, claimed_at = NULL, restored = 0, updated_at = ?
            WHERE kind = ? AND key = ? AND generation = ?
              AND status = '${EFFECT_STATUS_ATTEMPTING}'`,
          [
            attempts,
            now + effectRetryDelay(attempts),
            outcome.error ?? null,
            now,
            kind,
            key,
            generation,
          ]
        )) > 0
      );
    });
  }

  /** 读一条（测试/审计用；不存在 ⇒ `undefined`） */
  async get(kind: EffectKind, key: string): Promise<EffectEntry | undefined> {
    const rows = await this.allRows(
      `SELECT * FROM ${EFFECT_QUEUE_TABLE} WHERE kind = ? AND key = ?`,
      [kind, key]
    );
    return rows[0] ? toEntry(rows[0]) : undefined;
  }

  /** 按状态计数（面板/指标；一条 SQL 可复算） */
  async counts(): Promise<Record<EffectStatus, number>> {
    const rows = await this.allRows(
      `SELECT status, COUNT(*) AS n FROM ${EFFECT_QUEUE_TABLE} GROUP BY status`
    );
    const result = Object.fromEntries(
      EFFECT_STATUSES.map((status) => [status, 0])
    ) as Record<EffectStatus, number>;
    for (const row of rows) {
      const status = row.status as EffectStatus;
      // 计数查询额外带 `n` 列（与 `EffectRow` 的公共列取交集）
      const count = Number((row as EffectRow & { n?: number }).n ?? 0);
      if (status in result) result[status] = count;
    }
    return result;
  }

  close(): void {
    const db = this.db;
    this.db = null;
    this.initPromise = null;
    if (!db) return;
    db.close((err) => {
      if (err) logger.warn('effect_queue DB 关闭失败', { error: err.message });
    });
  }
}
