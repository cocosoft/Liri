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
 * ChannelAlertStateStore — 入站告警静默期状态（入站监视 G3/P4，2026-11-21）
 *
 * 为什么必须落盘：静默期若只在内存，进程重启后同一告警会**再报一次**
 * （R08-001：跨重启状态必须持久化）。
 *
 * 表 `channel_alert_state`（PRIMARY KEY = `(rule_id, channel)`）：
 * - `last_fired_at`：上次成功投递时间（epoch ms）——投递成功后才写，
 *   投递失败 ⇒ 下个 tick 自然重试；
 * - 只新增表（`project_rules §1.5`）；复用仓内既定 DB 模式（对标 `DedupStore`）。
 */

import { Database } from '@openliri/infra/external';

export const CHANNEL_ALERT_STATE_TABLE = 'channel_alert_state';

interface AlertStateRow {
  last_fired_at: number;
}

export class ChannelAlertStateStore {
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
      this.dbPath ??
      (await import('@openliri/infra/environment')).resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${CHANNEL_ALERT_STATE_TABLE} (
        rule_id       TEXT NOT NULL,
        channel       TEXT NOT NULL,
        last_fired_at INTEGER NOT NULL,
        PRIMARY KEY (rule_id, channel)
      )`
    );
  }

  /** 上次投递时间（未投递过 ⇒ `null`） */
  async getLastFired(ruleId: string, channel: string): Promise<number | null> {
    await this.init();
    const row = await this.get<AlertStateRow>(
      `SELECT last_fired_at FROM ${CHANNEL_ALERT_STATE_TABLE}
       WHERE rule_id = ? AND channel = ?`,
      [ruleId, channel]
    );
    return row?.last_fired_at ?? null;
  }

  /**
   * 该 `(规则, 渠道)` 此刻是否允许投递。
   *
   * @param silenceMs 静默期（`<=0` ⇒ 每次都可投递）
   */
  async shouldFire(
    ruleId: string,
    channel: string,
    silenceMs: number,
    now: number = Date.now()
  ): Promise<boolean> {
    if (silenceMs <= 0) return true;
    const last = await this.getLastFired(ruleId, channel);
    return last === null || now - last >= silenceMs;
  }

  /** 记录一次成功投递 */
  async markFired(
    ruleId: string,
    channel: string,
    now: number = Date.now()
  ): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ${CHANNEL_ALERT_STATE_TABLE}
        (rule_id, channel, last_fired_at)
       VALUES (?, ?, ?)
       ON CONFLICT(rule_id, channel) DO UPDATE SET
         last_fired_at = excluded.last_fired_at`,
      [ruleId, channel, now]
    );
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

  private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    return new Promise<T | undefined>((resolve, reject) => {
      db.get(sql, params, (err: Error | null, row: T | undefined) =>
        err ? reject(err) : resolve(row)
      );
    });
  }
}

let _instance: ChannelAlertStateStore | null = null;

/** 全局单例（惰性建表） */
export function getChannelAlertStateStore(): ChannelAlertStateStore {
  if (!_instance) _instance = new ChannelAlertStateStore();
  return _instance;
}

/** 重置单例（仅测试用） */
export function resetChannelAlertStateStoreForTest(): void {
  _instance?.close();
  _instance = null;
}
