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
import { handleError } from '@modules/error/handleError';

/** sqlite3 run() 回调中的 this 上下文 */
interface SqliteRunContext {
  changes: number;
  lastID: number;
}

/** session_route 表的数据库行类型 */
interface SessionRouteRow {
  session_id: string;
  tier: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  hit_count: number;
}
import { resolveDbPath } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import type { RouterTier, SessionRouteRecord } from './types.js';

const logger = getLogger('ai:session-store');

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
        (err: Error | null, row: unknown) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            const r = row as SessionRouteRow;
            const record: SessionRouteRecord = {
              sessionId: r.session_id,
              tier: r.tier as RouterTier,
              provider: r.provider,
              model: r.model,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
              hitCount: r.hit_count,
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
        function (this: SqliteRunContext, err: Error | null) {
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

// ─── 进程级单例 + 接线（2026-10-06，`任务计划-20261004.md` §21.4）─────────────

/**
 * 会话黏性存储的**进程级单例**（惰性初始化）。
 *
 * **接线背景**：本能力（`SmartRouter.decide()` 层 3：命中即**跳过 LLM Judge**，
 * 直接复用同会话上次档位）此前**生产不可达** —— `sessionStore` 从未被注入
 * （`main.ts` / `BootPipelineIntegrator` 构造 `SmartRouter` 时未传）。用户 2026-10-06
 * 裁定「接线」，本函数即**唯一构造点**（CS01：不再散落 new）。
 *
 * **与红线的关系（已取证）**：不违反 `model-usage.md`「模型选择遵循用户显式选择」——
 * `resolveModelRoute` 对 chat 类 route **先查用户显式配置**（`EXPLICIT_CONFIG_PREFERRED_ROUTES`
 * 优先返回，见 `ai/router/resolveModelRoute.ts:52-101`）⇒ 用户在「任务分工」里显式保存过时
 * **根本不会走到 SmartRouter**；黏性只影响"未显式配置"的自动档位选择。
 *
 * **开关**：`RouterConfig.sessionSticky === false` 时 `decide()` 层 3 直接跳过（配置已就绪，
 * 见 `main.ts` 的 `sessionSticky: savedRouter.sessionSticky !== false`）。
 *
 * **失败语义（如实）**：初始化失败 ⇒ `handleError` 留痕并返回 `null`；`sessionStore` 是
 * **可选能力**，缺失时 SmartRouter 退回"每轮 Judge"（= 接线前行为），不影响请求正确性
 * ⇒ 此处降级而非抛出（CS03 允许的"外部依赖不可用"场景 + CS03-002 必须留痕）。
 *
 * **清理**：初始化成功后顺带 `cleanExpired()` 一次（无定时器），避免历史过期行长期滞留。
 */
let _sessionRouterStore: SessionRouterStore | null = null;
let _sessionRouterStoreInitPromise: Promise<SessionRouterStore | null> | null =
  null;

export function getSessionRouterStore(): Promise<SessionRouterStore | null> {
  if (_sessionRouterStore) return Promise.resolve(_sessionRouterStore);
  // 并发调用共用同一次初始化（避免重复建连 / 重复 DDL）
  _sessionRouterStoreInitPromise ??= (async () => {
    try {
      const store = new SessionRouterStore();
      await store.init();
      const cleaned = await store.cleanExpired();
      if (cleaned > 0) {
        logger.info('会话黏性存储启动清理', { expiredRemoved: cleaned });
      }
      _sessionRouterStore = store;
      return store;
    } catch (error) {
      await handleError(error, {
        module: 'ai:session-store',
        action: 'getSessionRouterStore',
      });
      logger.warning('会话黏性存储初始化失败，SmartRouter 退回每轮 Judge', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();
  return _sessionRouterStoreInitPromise;
}

/** 测试缝：重置单例（**仅供测试**；生产不调用） */
export function resetSessionRouterStoreForTest(): void {
  _sessionRouterStore?.close();
  _sessionRouterStore = null;
  _sessionRouterStoreInitPromise = null;
}
