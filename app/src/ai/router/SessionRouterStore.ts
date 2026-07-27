// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * SessionRouterStore — 会话黏性存储
 *
 * 将同一会话的上次路由决策持久化到 app.db，使后续同会话消息
 * 可跳过 Judge 直接使用上次的 tier，减少重复分类开销。
 * 使用 SQLite 存储，注册在统一 app.db 中。
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import type { RouterTier, SessionRouteRecord } from './types.js';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:session-store' });

const TABLE_NAME = 'router_session_routes';

/** 会话黏性 TTL：30 分钟内无更新则过期 */
const STICKY_TTL_MS = 30 * 60 * 1000;

export class SessionRouterStore {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库连接和表
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTable();
    this.initialized = true;
    logger.debug('SessionRouterStore 初始化完成');
  }

  /**
   * 创建表（IF NOT EXISTS）
   */
  private createTable(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          session_id TEXT PRIMARY KEY,
          tier TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 1
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 获取会话的上次路由决策（可能已过期）
   */
  async get(sessionId: string): Promise<SessionRouteRecord | null> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${TABLE_NAME} WHERE session_id = ?`,
        [sessionId],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            const record: SessionRouteRecord = {
              sessionId: row.session_id,
              tier: row.tier as RouterTier,
              provider: row.provider,
              model: row.model,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
              hitCount: row.hit_count,
            };

            // 检查是否过期
            if (Date.now() - record.updatedAt > STICKY_TTL_MS) {
              // @ignore-catch — 过期路由记录清理fire-and-forget，非关键路径
              this.delete(sessionId).catch(() => {});
              resolve(null);
            } else {
              resolve(record);
            }
          }
        }
      );
    });
  }

  /**
   * 保存会话的路由决策
   */
  async set(
    sessionId: string,
    tier: RouterTier,
    provider: string,
    model: string
  ): Promise<void> {
    await this.ensureInit();

    const now = Date.now();

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT INTO ${TABLE_NAME} (session_id, tier, provider, model, created_at, updated_at, hit_count)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(session_id) DO UPDATE SET
           tier = excluded.tier,
           provider = excluded.provider,
           model = excluded.model,
           updated_at = excluded.updated_at,
           hit_count = hit_count + 1`,
        [sessionId, tier, provider, model, now, now],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 删除过期记录
   */
  private delete(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TABLE_NAME} WHERE session_id = ?`,
        [sessionId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 清理所有过期记录（可定时调用）
   */
  async cleanExpired(): Promise<number> {
    await this.ensureInit();
    const cutoff = Date.now() - STICKY_TTL_MS;

    return new Promise((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TABLE_NAME} WHERE updated_at < ?`,
        [cutoff],
        function (this: any, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes || 0);
        }
      );
    });
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }
}
