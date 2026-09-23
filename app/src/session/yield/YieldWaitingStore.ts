// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * YieldWaitingStore —— yield **等待集**的持久化（B1-3 / P0-2）
 *
 * 为什么需要：`SettlementOutbox` 只持久化了"**结算信号**"，没持久化"**谁在等**"
 *（`YieldRegistry` 原为纯内存）⇒ 崩溃重启后回放时 `registry.get() = undefined`
 * ⇒ 逐次 `markFailed` ⇒ 8 次后 `dropped`：**O8 的崩溃恢复能力结构性不成立**。
 *
 * 口径（**D-2 定论**：写时落盘 + 读走内存）：
 * - 落盘点**四处**：`register` / `updateTurn` / `resolve|abandon` / `clear`
 *   （方案原文列三处，实施时补出第四处：终态**必须删行**，否则重启重建会把已恢复的
 *   等待"复活" ⇒ 对陈旧登记再发起一次恢复 —— 见 §15.4 偏离说明。前两处缺一不可：
 *   只落 `register`/`clear` 会让重启后 `turn` 恒 0 ⇒ turn 取代判定恒失效
 *   ⇒ 重复恢复从后门回来 —— 见方案 §14.2 洞①）；
 * - 热路径 `get()` 仍走内存（不把磁盘延迟引入等待判定）；
 * - 落盘失败**不阻断**主流程（可观测性 < 功能可用性）⇒ 只 warn。
 *
 * 表 `agent_yield_waiting`：`session_id` 为主键 ⇒ 与内存口径一致
 *（同会话同时只允许一个 yield 等待）。重建顺序：**先重建等待集，再回放结算**
 *（否则回放必然找不到等待者）。
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('session:yield:waitingStore');

export const YIELD_WAITING_TABLE = 'agent_yield_waiting';

/** 一条等待登记（与 `YieldWaitingEntry` 的持久化投影一致，**含 turn**） */
export interface YieldWaitingRecord {
  sessionId: string;
  turn: number;
  toolCallId: string;
  yieldedAt: number;
}

/**
 * 持久化端口（`YieldRegistry` 只依赖本接口，不依赖具体存储 ⇒ 可注入、可测试）。
 *
 * 同步签名 + 内部 fire-and-forget：等待集在**热路径**上（工具执行阶段登记），
 * 不能因为落盘而让 `register()` 变成 async 并阻塞 agent 循环。
 */
export interface YieldWaitingPersistence {
  save(record: YieldWaitingRecord): void;
  remove(sessionId: string): void;
  clearAll(): void;
}

export class YieldWaitingStore implements YieldWaitingPersistence {
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
      // 与 SettlementOutbox 同法（P1-1）：失败必须清空，否则一次瞬时故障永久失效
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
      `CREATE TABLE IF NOT EXISTS ${YIELD_WAITING_TABLE} (
        session_id   TEXT PRIMARY KEY,
        turn         INTEGER NOT NULL,
        tool_call_id TEXT NOT NULL,
        yielded_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )`
    );
  }

  /** 落盘（upsert）：同会话覆盖（与内存"同会话只允许一个等待"一致） */
  async saveRecord(record: YieldWaitingRecord): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${YIELD_WAITING_TABLE}
         (session_id, turn, tool_call_id, yielded_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         turn = excluded.turn,
         tool_call_id = excluded.tool_call_id,
         yielded_at = excluded.yielded_at,
         updated_at = excluded.updated_at`,
      [
        record.sessionId,
        record.turn,
        record.toolCallId,
        record.yieldedAt,
        Date.now(),
      ]
    );
  }

  async removeRecord(sessionId: string): Promise<void> {
    await this.init();
    await this.run(`DELETE FROM ${YIELD_WAITING_TABLE} WHERE session_id = ?`, [
      sessionId,
    ]);
  }

  async clearRecords(): Promise<void> {
    await this.init();
    await this.run(`DELETE FROM ${YIELD_WAITING_TABLE}`);
  }

  /** 启动重建用：读出全部等待登记（**含 turn**，见文件头洞①） */
  async loadAll(): Promise<YieldWaitingRecord[]> {
    await this.init();
    const rows = await this.all<Record<string, unknown>>(
      `SELECT * FROM ${YIELD_WAITING_TABLE} ORDER BY yielded_at ASC`
    );
    return rows.map((raw) => ({
      sessionId: String(raw['session_id']),
      turn: Number(raw['turn'] ?? 0),
      toolCallId: String(raw['tool_call_id'] ?? ''),
      yieldedAt: Number(raw['yielded_at'] ?? 0),
    }));
  }

  // ==================== 端口实现（同步签名 + fire-and-forget） ====================

  /** @inheritdoc 落盘失败只 warn：不得让观测面阻断 agent 循环 */
  save(record: YieldWaitingRecord): void {
    void this.saveRecord(record).catch((err) => {
      logger.warn('yield 等待集落盘失败（不阻断主流程）', {
        sessionId: record.sessionId,
        error: String(err),
      });
    });
  }

  remove(sessionId: string): void {
    void this.removeRecord(sessionId).catch((err) => {
      logger.warn('yield 等待集删除失败（不阻断主流程）', {
        sessionId,
        error: String(err),
      });
    });
  }

  clearAll(): void {
    void this.clearRecords().catch((err) => {
      logger.warn('yield 等待集清空失败（不阻断主流程）', {
        error: String(err),
      });
    });
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

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: T[] | undefined) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }
}

let instance: YieldWaitingStore | null = null;

/** 全局单例（惰性：首次使用才解析 DB 路径并建表） */
export function getYieldWaitingStore(): YieldWaitingStore {
  if (!instance) {
    instance = new YieldWaitingStore();
  }
  return instance;
}
