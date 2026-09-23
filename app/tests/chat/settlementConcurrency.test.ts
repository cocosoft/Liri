// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B4-3 验收①：**并发恢复压测**（N 路同会话并发结算）——方案 §5-B4-3
 *
 * 断言口径（与 B1-1 的裁决语义一致）：
 * - **恢复恰好一次**：N 路并发结算 ⇒ `resumeHandler` 恰好调用 1 次、只有 1 路返回 true；
 * - **台账状态唯一收敛**：并发入队后回放 ⇒ 恰好一行 `delivered`、恢复副作用唯一；
 * - **无重复投递**：N 路并发认领同一行 ⇒ 单胜者（`attempts` 恰为 1）；
 * - **终态幂等**：`delivered` 后重复 `mark*` 不再改写（单向状态机）。
 *
 * ⚠ 本文件实测发现一处**预存缺口（B4 范围外，未修）**：`SettlementOutbox.enqueue` 是
 * check-then-insert，**并发**入队同一幂等键时可能落多行（已在
 * `dev_docs/error_repairs/预存错误与待处理问题.md` 的 B4-3 附注记录）。
 * 该缺口不影响恢复语义的唯一性（唯一闸门是 `YieldRegistry.claim` 的同步 CAS）。
 *
 * 隔离：临时目录 DB（`SettlementOutbox(dbPath)`），不触碰真实 `~/.pyapp/data/app.db`。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SettlementOutbox } from '../../src/chat/yield/SettlementOutbox';
import {
  handleYieldSettlement,
  replayPendingSettlements,
  setSettlementCrashHookForTest,
  setYieldRecoveryAuditSink,
  setYieldResumeHandler,
  yieldSettlementListeners,
  type YieldResumerDeps,
} from '../../src/chat/yield';
import { getYieldRegistry, resetYieldRegistry } from '../../src/session/yield';

/** Bun 运行时全局（tsc 类型面未声明 `gc`，按仓内既有约定就地声明） */
declare const Bun: { gc(force: boolean): void };

/** 并发路数（方案建议 ≥8） */
const LANES = 8;
const SESSION = 's-b4-3-concurrent';

let roots: string[] = [];
let opened: SettlementOutbox[] = [];

function makeOutbox(): SettlementOutbox {
  const root = mkdtempSync(join(tmpdir(), 'yield-conc-'));
  roots.push(root);
  const outbox = new SettlementOutbox(join(root, 'outbox.db'));
  opened.push(outbox);
  return outbox;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
});

afterEach(async () => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
  yieldSettlementListeners.length = 0;
  while (opened.length > 0) opened.pop()!.close();
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

function deps(): YieldResumerDeps {
  return { hasActiveRuns: () => false, latestTurn: () => 5 };
}

describe('B4-3①：并发恢复压测（N 路同会话）', () => {
  test(`${LANES} 路并发结算 ⇒ 恢复恰好一次（单胜者）`, async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: SESSION,
      turn: 5,
      toolCallId: 'c-conc',
      yieldedAt: 100,
    });

    let calls = 0;
    setYieldResumeHandler(async () => {
      calls += 1;
      // 制造在飞窗口：让其余路在认领被占后仍能跑到判定
      await sleep(20);
      return { ok: true };
    });

    const results = await Promise.all(
      Array.from({ length: LANES }, () =>
        handleYieldSettlement({ sessionId: SESSION, endedAt: 200 }, deps())
      )
    );

    expect(calls).toBe(1); // 恢复恰好一次
    expect(results.filter(Boolean)).toHaveLength(1); // 只有一路自认"真的完成了投递"
    expect(registry.isWaiting(SESSION)).toBe(false); // 等待登记已收敛
    expect(registry.get(SESSION)).toBeUndefined();
  });

  test(`${LANES} 路并发认领同一台账行 ⇒ 单胜者且 attempts 恰为 1（无重复投递）`, async () => {
    const outbox = makeOutbox();
    const id = await outbox.enqueue({ sessionId: SESSION, endedAt: 2000 });

    const claims = await Promise.all(
      Array.from({ length: LANES }, () => outbox.claim(id))
    );
    const winners = claims.filter((row) => row !== null);

    expect(winners).toHaveLength(1);
    const row = await outbox.getRow(id);
    expect(row?.state).toBe('attempting');
    expect(row?.attempts).toBe(1); // 修复前为 8（各自 attempts+1 ⇒ 上限被越过、重复投递）
  });

  test('同一幂等键重复入队 ⇒ 复用同一行（模块契约：不重复入队）', async () => {
    const outbox = makeOutbox();
    const first = await outbox.enqueue({ sessionId: SESSION, endedAt: 3000 });
    const again = await outbox.enqueue({ sessionId: SESSION, endedAt: 3000 });

    expect(again).toBe(first);
    expect(await outbox.listAll()).toHaveLength(1);
  });

  test(`${LANES} 路并发入队后回放 ⇒ 恢复恰好一次（唯一闸门是 CAS，不依赖台账去重）`, async () => {
    // ⚠ 并发入队**不是**原子的（`enqueue` 为 check-then-insert）⇒ 同一幂等键可能落多行。
    // 该缺口已在 `dev_docs/error_repairs/预存错误与待处理问题.md` 记录（B4 范围外，未修）。
    // 本用例断言的是**恢复语义**在重复行下仍然唯一：真正的互斥闸门是
    // `YieldRegistry.claim`（同步 CAS，B1-1）⇒ 恢复恰好一次，其余行诚实落 `failed`。
    const outbox = makeOutbox();
    await Promise.all(
      Array.from({ length: LANES }, () =>
        outbox.enqueue({ sessionId: SESSION, endedAt: 5000 })
      )
    );

    const registry = getYieldRegistry();
    registry.register({
      sessionId: SESSION,
      turn: 5,
      toolCallId: 'c-dup',
      yieldedAt: 100,
    });
    let resumes = 0;
    setYieldResumeHandler(async () => {
      resumes += 1;
      return { ok: true };
    });

    const delivered = await replayPendingSettlements(deps(), outbox);
    const rows = await outbox.listAll();

    expect(delivered).toBe(1); // 恰好一条被确认送达
    expect(resumes).toBe(1); // 恢复恰好一次（不重复副作用）
    expect(rows.filter((r) => r.state === 'delivered')).toHaveLength(1);
    expect(rows.filter((r) => r.state === 'failed').length).toBe(
      rows.length - 1
    );
    expect(registry.isWaiting(SESSION)).toBe(false);
  });

  test('终态幂等：delivered 后重复 mark* 不改写（单向状态机）', async () => {
    const outbox = makeOutbox();
    const id = await outbox.enqueue({ sessionId: SESSION, endedAt: 4000 });
    await outbox.claim(id);

    expect(await outbox.markDelivered(id)).toBe(true);
    // 终态不可改写：后续任何 mark 都不得把 delivered 改回去
    expect(await outbox.markFailed(id, 'late')).toBe(false);
    expect(await outbox.markDropped(id, 'late')).toBe(false);
    expect((await outbox.getRow(id))?.state).toBe('delivered');
  });
});
