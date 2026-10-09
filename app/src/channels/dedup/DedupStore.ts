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
 * DedupStore —— 通道消息**处理态**持久化（PR4 遗留-⑨ / 2026-10-09）
 *
 * 见 `.trae/specs/dedup-message-state.md`（§6 遗留）与 `.trae/specs/execution-lifecycle-ownership.md`（§8-PR4）。
 *
 * 动机（验收 ⑨）：去重处理态原为**进程内内存**（`dedup/index.ts` 的 `messageStates`）⇒ 重启后归零，
 * 同一 `messageId` 的渠道重传会被**重新认领并再次调用 LLM**（重复计费）。本表把处理态落盘，
 * 启动期 **hydrate** 回内存 ⇒ 跨重启仍能阻断同 `messageId` 重传。
 *
 * 复用仓内既定 DB 模式（单例 + 惰性 `CREATE TABLE IF NOT EXISTS`，对照 `chat/yield/SettlementOutbox`）。
 * **仅新增表**（`project_rules §1.5`）。写盘为 best-effort（观测面失败仅留痕，不阻断去重判定）。
 */

import { Database } from '@modules/core/external/sqlite3';
import type { MessageProcessingState } from './index';

export const DEDUP_STATES_TABLE = 'channel_message_states';

/** 持久化的处理态行 */
export interface PersistedMessageState {
  messageId: string;
  state: MessageProcessingState;
  expiresAt: number;
}

interface StateRow {
  message_id: string;
  state: string;
  expires_at: number;
}

export class DedupStore {
  private db: Database | null = null;
  private dbPath?: string;
  private initPromise: Promise<void> | null = null;

  /** @param dbPath 显式库路径（测试用）；缺省惰性解析 `resolveDbPath()` */
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
      `CREATE TABLE IF NOT EXISTS ${DEDUP_STATES_TABLE} (
        message_id TEXT PRIMARY KEY,
        state      TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_channel_message_states_exp
       ON ${DEDUP_STATES_TABLE} (expires_at)`
    );
  }

  /** 写入/覆盖处理态（best-effort 调用方已包 catch） */
  async upsert(
    messageId: string,
    state: MessageProcessingState,
    expiresAt: number
  ): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${DEDUP_STATES_TABLE}
        (message_id, state, expires_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         state = excluded.state,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      [messageId, state, expiresAt, Date.now()]
    );
  }

  /** 删除处理态（释放 claim 时） */
  async remove(messageId: string): Promise<void> {
    await this.init();
    await this.run(`DELETE FROM ${DEDUP_STATES_TABLE} WHERE message_id = ?`, [
      messageId,
    ]);
  }

  /** 载入**未过期**处理态（启动期 hydrate） */
  async loadLive(now: number = Date.now()): Promise<PersistedMessageState[]> {
    await this.init();
    const rows = await this.all<StateRow>(
      `SELECT * FROM ${DEDUP_STATES_TABLE} WHERE expires_at > ?`,
      [now]
    );
    return rows.map((r) => ({
      messageId: r.message_id,
      state: r.state as MessageProcessingState,
      expiresAt: r.expires_at,
    }));
  }

  /** 清理过期行（防无界增长） */
  async purgeExpired(now: number = Date.now()): Promise<number> {
    await this.init();
    return this.run(`DELETE FROM ${DEDUP_STATES_TABLE} WHERE expires_at <= ?`, [
      now,
    ]);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initPromise = null;
  }

  private run(sql: string, params: unknown[] = []): Promise<number> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<number>((resolve, reject) => {
      db.run(
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
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<T[]>((resolve, reject) => {
      db.all(sql, params, (err: Error | null, rows: T[] | undefined) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }
}

let _instance: DedupStore | null = null;

/** 全局单例（惰性建表） */
export function getDedupStore(): DedupStore {
  if (!_instance) _instance = new DedupStore();
  return _instance;
}

/** 重置单例（仅测试用） */
export function resetDedupStore(): void {
  _instance?.close();
  _instance = null;
}
