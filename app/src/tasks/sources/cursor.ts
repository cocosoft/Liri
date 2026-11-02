/**
 * SourceCursorStore —— 来源读位点 + Trigger 幂等台账（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P35。
 *
 * 两张表（均为**只新增**，`project_rules §1.5`）：
 * - `source_cursors`：每个 `(source, thread)` 的读位点 ⇒ 重启从位点续读、不重放；
 * - `source_triggers`：已落库的 Trigger（主键 = 确定性 id）⇒ 同一事件重投只留一条。
 *
 * 写入串行化：单连接 + Promise 链 ⇒ `recordTriggerOnce()` 的「查-插」不会进程内竞争。
 * 诚实边界：只保证**本进程**内串行；跨进程由 SQLite 主键约束兜底。
 */
import { Database } from '@openliri/infra/external';
import { resolveDbPath } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

import type { Trigger } from './types';

const logger = getLogger('tasks:source-cursor');

export const SOURCE_CURSORS_TABLE = 'source_cursors';
export const SOURCE_TRIGGERS_TABLE = 'source_triggers';

/** 本模块的表结构（带域前缀，避免与其它台账的 `DDL` 同名被 `lint:consts` 判为重复常量） */
const SOURCE_DDL = [
  `CREATE TABLE IF NOT EXISTS ${SOURCE_CURSORS_TABLE} (
    source_id  TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    cursor     INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, thread_key)
  )`,
  `CREATE TABLE IF NOT EXISTS ${SOURCE_TRIGGERS_TABLE} (
    trigger_id   TEXT PRIMARY KEY,
    source_id    TEXT NOT NULL,
    thread_key   TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    payload_json TEXT,
    created_at   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_triggers_thread
     ON ${SOURCE_TRIGGERS_TABLE}(thread_key, created_at)`,
];

export class SourceCursorStore {
  private db: Database | null = null;
  private initPromise: Promise<Database> | null = null;
  /** 写入串行链（消除「查-插」在进程内的竞态） */
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
      for (const sql of SOURCE_DDL) {
        await new Promise<void>((resolve, reject) => {
          db.run(sql, (err) => (err ? reject(err) : resolve()));
        });
      }
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

  private async run(sql: string, params: unknown[] = []): Promise<void> {
    const db = await this.init();
    await new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private async allRows(
    sql: string,
    params: unknown[] = []
  ): Promise<Array<Record<string, unknown>>> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else
          resolve((rows as Array<Record<string, unknown>> | undefined) ?? []);
      });
    });
  }

  /** 写入串行化（所有写都走这里） */
  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    // 不让单次失败卡死后续写：链上只记录"已完成"，错误由调用方的 Promise 抛出
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /** 读某来源在某线程上的已消费位点（无记录 ⇒ `undefined`） */
  async readCursor(
    sourceId: string,
    threadKey: string
  ): Promise<number | undefined> {
    const rows = await this.allRows(
      `SELECT cursor FROM ${SOURCE_CURSORS_TABLE}
        WHERE source_id = ? AND thread_key = ?`,
      [sourceId, threadKey]
    );
    const value = rows[0]?.cursor;
    return value === undefined || value === null ? undefined : Number(value);
  }

  /** 推进位点（只在前进时写；回退请求被忽略 ⇒ 重投不会把位点拉回去） */
  async writeCursor(
    sourceId: string,
    threadKey: string,
    cursor: number,
    now: number
  ): Promise<void> {
    await this.enqueueWrite(() =>
      this.run(
        `INSERT INTO ${SOURCE_CURSORS_TABLE}
          (source_id, thread_key, cursor, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source_id, thread_key) DO UPDATE SET
           cursor = MAX(${SOURCE_CURSORS_TABLE}.cursor, excluded.cursor),
           updated_at = excluded.updated_at`,
        [sourceId, threadKey, cursor, now]
      )
    );
  }

  /**
   * 落一条 Trigger；**首次**落库返回 `true`，重复（同 `triggerId`）返回 `false`。
   *
   * 「查-插」在写串行链内完成 ⇒ 并发重投不会各插一条。
   */
  async recordTriggerOnce(trigger: Trigger): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const rows = await this.allRows(
        `SELECT 1 AS hit FROM ${SOURCE_TRIGGERS_TABLE} WHERE trigger_id = ?`,
        [trigger.triggerId]
      );
      if (rows.length > 0) return false;
      await this.run(
        `INSERT INTO ${SOURCE_TRIGGERS_TABLE}
          (trigger_id, source_id, thread_key, event_type, external_id,
           payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          trigger.triggerId,
          trigger.sourceId,
          trigger.threadKey,
          trigger.type,
          trigger.externalId,
          JSON.stringify(trigger.payload ?? {}),
          trigger.receivedAt,
        ]
      );
      return true;
    });
  }

  /** 统计某来源已落库的 Trigger 数（测试/审计用） */
  async countTriggers(sourceId: string): Promise<number> {
    const rows = await this.allRows(
      `SELECT COUNT(*) AS n FROM ${SOURCE_TRIGGERS_TABLE} WHERE source_id = ?`,
      [sourceId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  close(): void {
    const db = this.db;
    this.db = null;
    this.initPromise = null;
    if (!db) return;
    db.close((err) => {
      if (err) logger.warn('source 台账 DB 关闭失败', { error: err.message });
    });
  }
}
