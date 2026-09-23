// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B4-3 验收②：**注入式崩溃演练**（结算写入 → `markDelivered` 之间）——方案 §5-B4-3 v2.2
 *
 * ⚠ **崩溃点由 hook 决定，非 OS 信号**：本环境无法用 OS 信号精确死在指定点
 * （Windows 只有 `taskkill /F /PID`，无法保证恰好死在"结算写入之后、`markDelivered` 之前"）
 * ⇒ 崩溃由 `setSettlementCrashHookForTest` 注入抛错模拟"进程此刻断电"；
 * 重启由**独立实例 / 重开 store** 模拟（新 `SettlementOutbox` + 重建等待集）。
 *
 * 两个崩溃点（都在"结算写入 → markDelivered"之间）：
 * - `after-persist`：结算已落台账（行仍 `pending`）、投递未发生 ⇒ 重启后**必须重投且只投一次**；
 * - `after-ack`：投递已返回（**恢复已发生**）、台账未确认（行 `attempting`）⇒
 *   重启 + 陈窗过后重投**不得重复恢复**（G15：重复副作用）。
 *
 * 断言：① 未 `delivered` 的行仍 `pending`/`attempting`；② 被回放重投；
 * ③ 最终恰好投递一次（不重复、不丢失）。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@modules/core/external/sqlite3';
import {
  CLAIM_STALE_MS,
  SETTLEMENT_OUTBOX_TABLE,
  SettlementOutbox,
} from '../../src/chat/yield/SettlementOutbox';
import {
  YIELD_SETTLEMENT_RESTORED_REASON,
  replayPendingSettlements,
  setSettlementCrashHookForTest,
  setYieldRecoveryAuditSink,
  setYieldResumeHandler,
  yieldSettlementListeners,
  type YieldResumerDeps,
} from '../../src/chat/yield';
import {
  YieldWaitingStore,
  getYieldRegistry,
  rebuildYieldWaitingSet,
  resetYieldRegistry,
} from '../../src/session/yield';

/** Bun 运行时全局（tsc 类型面未声明 `gc`，按仓内既有约定就地声明） */
declare const Bun: { gc(force: boolean): void };

const SESSION = 's-b4-3-crash';

let roots: string[] = [];
let openedOutboxes: SettlementOutbox[] = [];
let openedStores: YieldWaitingStore[] = [];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 临时库路径（等待集与结算台账**共用同一库**，与生产 `app.db` 同口径） */
function makeDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'yield-crash-'));
  roots.push(root);
  return join(root, 'app.db');
}

async function openOutbox(dbPath: string): Promise<SettlementOutbox> {
  const outbox = new SettlementOutbox(dbPath);
  openedOutboxes.push(outbox);
  await outbox.init();
  return outbox;
}

async function openStore(dbPath: string): Promise<YieldWaitingStore> {
  const store = new YieldWaitingStore(dbPath);
  openedStores.push(store);
  await store.init();
  return store;
}

/**
 * 老化台账行的 `updated_at`（**模拟"进程死亡 ≥ 陈旧窗口"后的回放**）。
 *
 * 必要性：`CLAIM_STALE_MS` 窗口内不允许重复认领（防与在飞投递并发）⇒ 崩溃后立即重启
 * 时该行会被跳过（这正是"不重复投递"的设计）。要演练"窗口过后自愈重投"，
 * 必须让时间前进 —— 直接改盘的 `updated_at` 是等价且可控的模拟（不引入假数据：
 * 行内容、状态、attempts 都是真实的，仅时钟前移）。
 */
async function ageRow(dbPath: string, id: number, byMs: number): Promise<void> {
  const db = await new Promise<Database>((resolve, reject) => {
    const d = new Database(dbPath, (err: Error | null) =>
      err ? reject(err) : resolve(d)
    );
  });
  await new Promise<void>((resolve, reject) => {
    db.run(
      `UPDATE ${SETTLEMENT_OUTBOX_TABLE} SET updated_at = ? WHERE id = ?`,
      [Date.now() - byMs, id],
      (err: Error | null) => (err ? reject(err) : resolve())
    );
  });
  db.close();
}

/** 轮询等待等待集从盘上消失（`resolve` 的删行是 fire-and-forget） */
async function waitStoreEmpty(
  store: YieldWaitingStore,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while ((await store.loadAll()).length > 0 && Date.now() - start < timeoutMs) {
    await sleep(10);
  }
}

/** 模拟"进程重启"：清掉内存等待集（**不碰盘**）→ 从盘重建（生产启动顺序） */
async function simulateRestart(store: YieldWaitingStore): Promise<number> {
  const registry = getYieldRegistry();
  registry.setPersistence(null);
  registry.clear(); // persistence 已卸下 ⇒ 只清内存，不删盘上的等待行
  registry.setPersistence(store);
  return rebuildYieldWaitingSet(store, registry);
}

function deps(): YieldResumerDeps {
  return { hasActiveRuns: () => false, latestTurn: () => 5 };
}

beforeEach(() => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
});

afterEach(async () => {
  setSettlementCrashHookForTest(null);
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  yieldSettlementListeners.length = 0;
  const registry = getYieldRegistry();
  registry.setPersistence(null);
  resetYieldRegistry();
  while (openedOutboxes.length > 0) openedOutboxes.pop()!.close();
  while (openedStores.length > 0) openedStores.pop()!.close();
  // 删临时库前强制 GC（预编译语句未终结时 sqlite close 只是"僵尸化"连接）
  Bun.gc(true);
  for (const r of roots) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(r, { recursive: true, force: true });
        break;
      } catch {
        // @ignore-catch — 句柄尚未释放：退避后重试
        await sleep(25);
      }
    }
  }
  roots = [];
});

describe('B4-3②：注入式崩溃演练（崩溃点由 hook 决定，非 OS 信号）', () => {
  test('崩溃于 after-persist（结算已写入、投递未发生）⇒ 重启后重投恰好一次', async () => {
    const dbPath = makeDbPath();
    const outboxA = await openOutbox(dbPath);
    const storeA = await openStore(dbPath);

    // 预置现场：「谁在等」+「结算信号已落台账」
    await storeA.saveRecord({
      sessionId: SESSION,
      turn: 5,
      toolCallId: 'c-crash-1',
      yieldedAt: 1000,
    });
    const rowId = await outboxA.enqueue({ sessionId: SESSION, endedAt: 2000 });

    let resumes = 0;
    const reasons: string[] = [];
    setYieldResumeHandler(async ({ reason }) => {
      resumes += 1;
      reasons.push(reason);
      return { ok: true };
    });
    expect(await simulateRestart(storeA)).toBe(1); // 先重建等待集（启动顺序）

    // 注入崩溃：点由 hook 决定（非 OS 信号）
    setSettlementCrashHookForTest((point) => {
      if (point === 'after-persist') {
        throw new Error('注入式崩溃（hook，非 OS 信号）: after-persist');
      }
    });

    // 进程 A：回放到"结算写入之后、投递之前"即断电
    await expect(replayPendingSettlements(deps(), outboxA)).rejects.toThrow(
      '注入式崩溃'
    );

    // ① 未 delivered 的行仍 pending（投递未发生 ⇒ 未丢失，只是尚未送达）
    const crashed = await outboxA.getRow(rowId);
    expect(crashed?.state).toBe('pending');
    expect(crashed?.attempts).toBe(0);
    expect(resumes).toBe(0);

    // === 重启（独立实例 / 重开 store）===
    setSettlementCrashHookForTest(null);
    outboxA.close();
    storeA.close();
    const outboxB = await openOutbox(dbPath);
    const storeB = await openStore(dbPath);
    expect(await simulateRestart(storeB)).toBe(1);

    // ② 被回放重投
    expect(await replayPendingSettlements(deps(), outboxB)).toBe(1);
    // ③ 最终恰好投递一次（不重复、不丢失）+ 重放带**可见标记**（G15 防护）
    expect(resumes).toBe(1);
    expect(reasons).toEqual([YIELD_SETTLEMENT_RESTORED_REASON]);
    const settled = await outboxB.getRow(rowId);
    expect(settled?.state).toBe('delivered');
    expect(settled?.attempts).toBe(1);
  });

  test('崩溃于 after-ack（恢复已发生、台账未确认）⇒ 重启后不得重复恢复', async () => {
    const dbPath = makeDbPath();
    const outboxA = await openOutbox(dbPath);
    const storeA = await openStore(dbPath);

    await storeA.saveRecord({
      sessionId: SESSION,
      turn: 5,
      toolCallId: 'c-crash-2',
      yieldedAt: 1000,
    });
    const rowId = await outboxA.enqueue({ sessionId: SESSION, endedAt: 2000 });

    let resumes = 0;
    setYieldResumeHandler(async () => {
      resumes += 1;
      return { ok: true };
    });
    expect(await simulateRestart(storeA)).toBe(1);

    setSettlementCrashHookForTest((point) => {
      if (point === 'after-ack') {
        throw new Error('注入式崩溃（hook，非 OS 信号）: after-ack');
      }
    });

    await expect(replayPendingSettlements(deps(), outboxA)).rejects.toThrow(
      '注入式崩溃'
    );

    // ① 恢复**已发生**（1 次），但台账未确认：行仍 attempting（不谎报 delivered）
    expect(resumes).toBe(1);
    const crashed = await outboxA.getRow(rowId);
    expect(crashed?.state).toBe('attempting');
    expect(crashed?.attempts).toBe(1);

    // === 重启 ===
    setSettlementCrashHookForTest(null);
    await waitStoreEmpty(storeA); // resolve 的删行是 fire-and-forget
    outboxA.close();
    storeA.close();
    const outboxB = await openOutbox(dbPath);
    const storeB = await openStore(dbPath);
    // 等待集重建为空：该等待已 resolve（终态删行）⇒ 重启后不存在"谁在等"
    expect(await simulateRestart(storeB)).toBe(0);

    // 窗口内回放：不得重复投递（行仍 attempting、attempts 不增）
    expect(await replayPendingSettlements(deps(), outboxB)).toBe(0);
    expect(resumes).toBe(1);
    let row = await outboxB.getRow(rowId);
    expect(row?.state).toBe('attempting');
    expect(row?.attempts).toBe(1);

    // 陈窗过后重投：允许再认领（attempts+1）但**无等待者 ⇒ 不重复恢复、不谎报 delivered**
    await ageRow(dbPath, rowId, CLAIM_STALE_MS + 1000);
    expect(await replayPendingSettlements(deps(), outboxB)).toBe(0);
    expect(resumes).toBe(1); // ③ 恢复仍恰好一次（不重复）
    row = await outboxB.getRow(rowId);
    expect(row?.state).toBe('failed'); // 诚实落 failed（留待重试，超上限转 dropped）
    expect(row?.attempts).toBe(2);
  });
});
