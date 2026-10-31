/**
 * 任务状态存储的进程级**共享实例**（惰性、按库路径分桶）—— 台账 D-100。
 *
 * 背景：端口实现与 PDCA 决策落点曾逐调用 `new SqliteTaskStore()`，每次 `init()` 重跑
 * 建表 + 迁移 DDL，且从不 `close()` ⇒ 连接不复用也不释放。取向同
 * `tasks/lro/portResolvers.ts` 的 `resolveAuditStore`（长连接惰性单例）；按 `dbPath`
 * 分桶是为了让测试注入的临时库与真实库互不串用。
 *
 * 为什么独立成文件：调用点全部是**动态导入**，把这段放进 `SqliteTaskStore.ts` 会把它
 * 计入启动面字节（`lint:startup-graph` 棘轮只允许减少）；本文件不在 eager 图上。
 *
 * ⚠️ 返回的实例**不要** `close()`（被多处共享）；需要一次性实例请用 `createSqliteTaskStore()`。
 */
import { resolveDbPath } from '@modules/environment';

import { SqliteTaskStore } from './SqliteTaskStore';

const sharedStores = new Map<string, Promise<SqliteTaskStore>>();

export function getSharedSqliteTaskStore(
  dbPath: string = resolveDbPath()
): Promise<SqliteTaskStore> {
  const cached = sharedStores.get(dbPath);
  if (cached) return cached;

  const created = (async () => {
    const store = new SqliteTaskStore(dbPath);
    await store.init();
    return store;
  })();
  // 初始化失败不留在缓存里，否则一次瞬时失败会固化成"永久不可用"
  created.catch(() => sharedStores.delete(dbPath));
  sharedStores.set(dbPath, created);
  return created;
}
