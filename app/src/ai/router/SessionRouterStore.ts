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

import { Database } from '@openliri/kernel/external/sqlite3';
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
import { resolveDbPath, resolveTenantDbPath } from '@openliri/kernel';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { getLogger } from '@modules/monitoring';
import type { RouterTier, SessionRouteRecord } from './types.js';

const logger = getLogger('ai:session-store');

const SESSION_ROUTER_TABLE_NAME = 'router_session_routes';

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
   * 创建表（IF NOT EXISTS）+ 旧库补 `owner_key` 列
   *
   * ⚠️ 租户库：同一 `sessionId` 可能属于同租户的不同用户 ⇒ 主键为
   * `(session_id, owner_key)`。旧库（单身份）仍是 `session_id` 单列主键，
   * `ALTER` 不能改主键，但本地全 `local:local` ⇒ 不会碰撞。
   */
  private async createTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${SESSION_ROUTER_TABLE_NAME} (
          session_id TEXT NOT NULL,
          tier TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 1,
          owner_key TEXT NOT NULL DEFAULT 'local:local',
          PRIMARY KEY (session_id, owner_key)
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const columns = await new Promise<Array<{ name: string }>>(
      (resolve, reject) => {
        this.db!.all(
          `PRAGMA table_info(${SESSION_ROUTER_TABLE_NAME})`,
          [],
          (err: Error | null, rows) =>
            err ? reject(err) : resolve((rows || []) as Array<{ name: string }>)
        );
      }
    );
    if (columns.some((c) => c.name === 'owner_key')) return;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `ALTER TABLE ${SESSION_ROUTER_TABLE_NAME} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  /** 当前写入/查询的归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /**
   * 获取会话的上次路由决策（可能已过期）
   */
  async get(sessionId: string): Promise<SessionRouteRecord | null> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${SESSION_ROUTER_TABLE_NAME}
          WHERE session_id = ? AND owner_key = ?`,
        [sessionId, this.owner()],
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
        `INSERT INTO ${SESSION_ROUTER_TABLE_NAME} (session_id, tier, provider, model, created_at, updated_at, hit_count, owner_key)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(session_id, owner_key) DO UPDATE SET
           tier = excluded.tier,
           provider = excluded.provider,
           model = excluded.model,
           updated_at = excluded.updated_at,
           hit_count = hit_count + 1`,
        [sessionId, tier, provider, model, now, now, this.owner()],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 删除过期记录（**只删自己那行**：同一 `sessionId` 在租户内可能属于他人）
   */
  private delete(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${SESSION_ROUTER_TABLE_NAME} WHERE session_id = ? AND owner_key = ?`,
        [sessionId, this.owner()],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 清理所有过期记录（可定时调用）
   *
   * ⚠️ 这是**维护动作**：实例是租户级的，过期行对本租户内**所有用户**都已失效
   * ⇒ 不按 owner 过滤（与 InboxManager 的过期清理同口径）；否则长期不登录的用户
   * 会让死行永久滞留。`get()` 命中过期行时仍按 owner 精准删除自己那行。
   */
  async cleanExpired(): Promise<number> {
    await this.ensureInit();
    const cutoff = Date.now() - STICKY_TTL_MS;

    return new Promise((resolve, reject) => {
      // @owner-exempt 跨用户维护动作（见方法注释）
      this.db!.run(
        `DELETE FROM ${SESSION_ROUTER_TABLE_NAME} WHERE updated_at < ?`,
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
/** 租户级库实例缓存（键 = `tenantId`；库按租户分，用户靠 `owner_key` 行级隔离） */
const _scopedStores = new Map<string, SessionRouterStore>();
const _scopedInitPromises = new Map<
  string,
  Promise<SessionRouterStore | null>
>();

/**
 * 取会话黏性路由存储。
 *
 * 租户级 DB（基础设施专项 §6.1 期 3）：本地身份 ⇒ 原单例（零变更）；已认证身份 ⇒
 * 该**租户**的实例（`tenants/<t>/app.db`），同租户内不同用户共用连接、按 `owner_key`
 * 行级隔离。
 */
export function getSessionRouterStore(): Promise<SessionRouterStore | null> {
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const tenantKey = principal.tenantId;
    const cached = _scopedStores.get(tenantKey);
    if (cached) return Promise.resolve(cached);
    const existing = _scopedInitPromises.get(tenantKey);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const store = new SessionRouterStore(resolveTenantDbPath(principal));
        await store.init();
        const cleaned = await store.cleanExpired();
        if (cleaned > 0) {
          logger.info('会话黏性存储启动清理（租户库）', {
            tenantId: tenantKey,
            expiredRemoved: cleaned,
          });
        }
        _scopedStores.set(tenantKey, store);
        // 多租户 P5：登记 closer（关连接 + 摘除本模块缓存），删租户时统一释放文件句柄。
        // 登记键用**创建者**的 `<tenant>:<user>`：purge 按 `<tenant>:` 前缀关闭 ⇒
        // 无论哪个用户触发创建，删租户都能命中的这**一个**租户级实例。
        registerScopedResource(principalKeyOf(principal), () => {
          store.close();
          _scopedStores.delete(tenantKey);
        });
        return store;
      } catch (error) {
        await handleError(error, {
          module: 'ai:session-store',
          action: 'getSessionRouterStore',
        });
        logger.warning('租户库会话黏性存储初始化失败，退回每轮 Judge', {
          tenantId: tenantKey,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    })();
    _scopedInitPromises.set(tenantKey, pending);
    return pending;
  }

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
  for (const store of _scopedStores.values()) store.close();
  _scopedStores.clear();
  _scopedInitPromises.clear();
  _sessionRouterStore = null;
  _sessionRouterStoreInitPromise = null;
}
