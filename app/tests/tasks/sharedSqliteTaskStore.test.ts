/**
 * D-100 回归锁（2026-10-31）：任务状态存储改为**进程级共享实例**，且**必须已 `init()`**。
 *
 * 背景（台账 D-100）：端口实现曾逐调用 `new SqliteTaskStore()`（每次 `init()` 重跑建表 +
 * 迁移 DDL）且**从不 `close()`** ⇒ 连接不复用也不释放；另有两处调用点干脆**从未 `init()`**
 * （`runtime/api/domainSnapshotOps.ts` 的 `listPdcaDecisionRows`、`chat/manager/pdcaLaunch.ts`
 * 的 PDCA 决策审计）⇒ `withDb` 抛 "SqliteTaskStore not initialized"，决策轨迹查询与
 * 审计写入**实际不可用**。
 *
 * 本用例钉住四点：
 *  ① 同一 `dbPath` 复用**同一实例**（连接复用）；
 *  ② 不同 `dbPath` 分桶（测试临时库不与真实库串用）；
 *  ③ 共享实例**已 init** ⇒ 审计可写、按事件可读（原故障点）；
 *  ④ 对照：未 `init()` 的一次性实例仍会抛错（证明③依赖 init，而非偶然可用）。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  getSharedSqliteTaskStore,
  SqliteTaskStore,
} from '../../src/tasks/db/SqliteTaskStore.js';

const dirs: string[] = [];

/** 每个用例独占一个临时库路径（避免共享缓存跨用例串用） */
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-shared-taskstore-'));
  dirs.push(dir);
  return join(dir, 'tasks.db');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 上句柄释放略有延迟；临时目录残留不影响断言
    }
  }
});

describe('D-100 共享 SqliteTaskStore', () => {
  it('同一 dbPath 复用同一实例', async () => {
    const dbPath = tempDbPath();
    const first = await getSharedSqliteTaskStore(dbPath);
    const second = await getSharedSqliteTaskStore(dbPath);

    expect(second).toBe(first);
    await first.close();
  });

  it('不同 dbPath 分桶（测试临时库不与真实库串用）', async () => {
    const a = await getSharedSqliteTaskStore(tempDbPath());
    const b = await getSharedSqliteTaskStore(tempDbPath());

    expect(b).not.toBe(a);
    await a.close();
    await b.close();
  });

  it('共享实例已 init：审计写入 + 按事件查询可用（原为 not initialized 抛错）', async () => {
    const store = await getSharedSqliteTaskStore(tempDbPath());

    await store.writeAuditLogWithDetail({
      taskId: 'session:s1',
      eventType: 'pdca_decision',
      oldStatus: null,
      newStatus: 'pdl',
      detail: JSON.stringify({ reasons: ['simple-task'] }),
      timestamp: 1,
    });

    const rows = await store.listAuditLogByEvent('pdca_decision', 10);
    expect(rows.length).toBe(1);
    expect(rows[0]!.taskId).toBe('session:s1');
    expect(rows[0]!.newStatus).toBe('pdl');

    await store.close();
  });

  it('对照：未 init 的一次性实例仍抛 not initialized', async () => {
    const store = new SqliteTaskStore(tempDbPath());

    await expect(store.listAuditLogByEvent('pdca_decision', 1)).rejects.toThrow(
      /not initialized/
    );
  });
});
