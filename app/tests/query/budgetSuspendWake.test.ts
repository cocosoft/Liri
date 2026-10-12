// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Task 7（债二-预算挂起续跑）：放行（relief）⇒ 唤醒进程内挂起会话。
//
// 决策规则（硬要求）：
//  - `boost` / `unlock-today` ⇒ 按挂起时间**升序**、**串行**唤醒，数量 ≤ `resolveBudgetResumeMaxPerWake()`；
//  - `waive-once` ⇒ **只唤醒最早期挂起的 1 个**（单次额度语义）；
//  - **幂等**：已 release 的会话不得再次唤醒；并发/重复放行至多唤醒一次；
//  - **过期（>24h）不唤醒**；
//  - 唤醒经注入的 handler 端口（`handler(sessionId, chain) => boolean`）；
//  - 未设 handler ⇒ 只 warn、不报错、不改登记。
//
// 因果判别：唤醒只在**显式 relief 应用**处触发 ⇒ kill-switch / reset / PUT 配置变更**零调用**。

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend';

const MAX_KEY = 'BUDGET_RESUME_MAX_PER_WAKE';

describe('Task 7：放行 ⇒ 唤醒挂起会话', () => {
  let nowSpy: ReturnType<typeof spyOn>;
  let prevMax: string | undefined;

  beforeEach(() => {
    resetBudgetSuspendForTest();
    nowSpy = spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    prevMax = process.env[MAX_KEY];
    delete process.env[MAX_KEY];
  });
  afterEach(() => {
    nowSpy.mockRestore();
    resetBudgetSuspendForTest();
    if (prevMax === undefined) delete process.env[MAX_KEY];
    else process.env[MAX_KEY] = prevMax;
  });

  it('① boost/unlock-today ⇒ 时间序、串行、≤ 上限（超上限者保持挂起）', async () => {
    process.env[MAX_KEY] = '2';
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r1' });
    nowSpy.mockReturnValue(2_000);
    c.suspend({ sessionId: 's2', chain: 'stream', reason: 'r2' });
    nowSpy.mockReturnValue(3_000);
    c.suspend({ sessionId: 's3', chain: 'taor', reason: 'r3' });

    const called: string[] = [];
    let active = 0;
    let maxConcurrent = 0;
    c.setResumeHandler(async (sessionId) => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      called.push(sessionId);
      await new Promise((r) => setTimeout(r, 0));
      active -= 1;
      return true;
    });

    const { woken } = await c.onReliefApplied('boost');

    expect(woken).toEqual(['s1', 's2']);
    expect(called).toEqual(['s1', 's2']); // 时间序
    expect(maxConcurrent).toBe(1); // 串行
    // ② 超上限者仍在 list()
    expect(c.list().map((e) => e.sessionId)).toEqual(['s3']);
  });

  it('③ waive-once ⇒ 只唤醒最早期挂起的 1 个', async () => {
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r1' });
    nowSpy.mockReturnValue(2_000);
    c.suspend({ sessionId: 's2', chain: 'stream', reason: 'r2' });

    const called: string[] = [];
    c.setResumeHandler(async (sessionId) => {
      called.push(sessionId);
      return true;
    });

    const { woken } = await c.onReliefApplied('waive-once');

    expect(woken).toEqual(['s1']);
    expect(called).toEqual(['s1']);
    expect(c.list().map((e) => e.sessionId)).toEqual(['s2']);
  });

  it('④ 幂等：并发/重复放行同一条目 ⇒ handler 至多被调用一次', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });

    let calls = 0;
    c.setResumeHandler(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 0));
      return true;
    });

    const [a, b] = await Promise.all([
      c.onReliefApplied('boost'),
      c.onReliefApplied('boost'),
    ]);

    expect(calls).toBe(1);
    expect([...a.woken, ...b.woken]).toEqual(['s1']);
    expect(c.isSuspended('s1')).toBe(false);
  });

  it('④b 已 release 的会话不被再次唤醒', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });
    c.release('s1');

    let calls = 0;
    c.setResumeHandler(async () => {
      calls += 1;
      return true;
    });

    const { woken } = await c.onReliefApplied('boost');
    expect(woken).toEqual([]);
    expect(calls).toBe(0);
  });

  it('⑤ kill-switch / reset / PUT 配置变更 ⇒ handler 零调用（回调只在 relief 应用处）', async () => {
    const { getDailyBudget, resetDailyBudgetForTest } =
      await import('../../src/query/DailyBudgetManager');
    resetDailyBudgetForTest();
    const budget = getDailyBudget();
    budget.setLimit(100_000);

    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });

    let calls = 0;
    c.setResumeHandler(async () => {
      calls += 1;
      return true;
    });
    const off = budget.onReliefApplied((e) => {
      void c.onReliefApplied(e.kind);
    });

    try {
      budget.enableKillSwitch(); // 硬锁
      budget.reset(); // 重置
      budget.applyConfig({ dailyLimit: 200_000 }); // PUT 配置变更
      await new Promise((r) => setTimeout(r, 0));

      expect(calls).toBe(0);
      expect(c.isSuspended('s1')).toBe(true);

      budget.applyRelief({ kind: 'boost' }); // 显式放行 ⇒ 才触发
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toBe(1);
    } finally {
      off();
      resetDailyBudgetForTest();
    }
  });

  it('⑥ 过期（>24h）条目不被唤醒', async () => {
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });

    let calls = 0;
    c.setResumeHandler(async () => {
      calls += 1;
      return true;
    });

    // 越过 TTL
    nowSpy.mockReturnValue(1_000 + 24 * 60 * 60 * 1000 + 1);
    const { woken } = await c.onReliefApplied('boost');

    expect(woken).toEqual([]);
    expect(calls).toBe(0);
    // 过期条目保留（供人工查看），不被删除
    expect(c.list().length).toBe(1);
    expect(c.list()[0].expired).toBe(true);
  });

  it('未设 handler ⇒ 只 warn、不报错、不改登记', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });

    const { woken } = await c.onReliefApplied('boost');

    expect(woken).toEqual([]);
    expect(c.isSuspended('s1')).toBe(true);
  });

  it('唤醒 handler 返回 false ⇒ 回滚为挂起（保留原挂起时刻）', async () => {
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });
    nowSpy.mockReturnValue(2_000);
    c.suspend({ sessionId: 's2', chain: 'taor', reason: 'r2' });

    c.setResumeHandler(async (sessionId) => sessionId === 's2');

    const { woken } = await c.onReliefApplied('boost');

    expect(woken).toEqual(['s2']);
    const list = c.list();
    expect(list.map((e) => e.sessionId)).toEqual(['s1']);
    expect(list[0].suspendedAt).toBe(1_000); // 原挂起时刻保留（时间序不漂移）
  });
});

// ─── M3（最终整支评审）：口径统一 —— 过期判定 / 上限按"尝试数" / 唤醒日志 ──────────
describe('M3：isSuspended 计入过期 + 上限按 handler 调用数 + 唤醒日志', () => {
  let nowSpy: ReturnType<typeof spyOn>;
  let prevMax: string | undefined;

  beforeEach(() => {
    resetBudgetSuspendForTest();
    nowSpy = spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    prevMax = process.env[MAX_KEY];
    delete process.env[MAX_KEY];
  });
  afterEach(() => {
    nowSpy.mockRestore();
    resetBudgetSuspendForTest();
    if (prevMax === undefined) delete process.env[MAX_KEY];
    else process.env[MAX_KEY] = prevMax;
  });

  it('isSuspended 计入过期（>24h ⇒ false，与 list().expired 同口径）', () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });
    expect(c.isSuspended('s1')).toBe(true);

    nowSpy.mockReturnValue(1_000 + 24 * 60 * 60 * 1000 + 1);
    expect(c.isSuspended('s1')).toBe(false);
    expect(c.list()[0].expired).toBe(true); // 条目仍保留（供人工查看）
  });

  it('唤醒上限按"handler 调用数"计（失败也占额度，不无限尝试）', async () => {
    process.env[MAX_KEY] = '2';
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r1' });
    nowSpy.mockReturnValue(2_000);
    c.suspend({ sessionId: 's2', chain: 'taor', reason: 'r2' });
    nowSpy.mockReturnValue(3_000);
    c.suspend({ sessionId: 's3', chain: 'taor', reason: 'r3' });

    let calls = 0;
    c.setResumeHandler(async () => {
      calls += 1;
      return false; // 全部失败
    });

    const { woken } = await c.onReliefApplied('boost');

    expect(woken).toEqual([]);
    expect(calls).toBe(2); // 上限=2 ⇒ 只尝试 2 次（修复前按"成功数"计 ⇒ 会尝试 3 次）
    expect(c.list().length).toBe(3); // 全部回滚为挂起
  });

  it('唤醒汇总日志带 relief kind 与 woken', async () => {
    const { addLogHandler } =
      await import('../../src/monitoring/logs/Logger.js');
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });
    c.setResumeHandler(async () => true);

    const logs: Array<{ kind?: string; woken?: string[] }> = [];
    const off = addLogHandler((entry) => {
      if (entry.message === 'budgetSuspend:resume_summary') {
        logs.push(entry.data as { kind?: string; woken?: string[] });
      }
    });
    try {
      await c.onReliefApplied('unlock-today');
    } finally {
      off();
    }

    expect(logs.length).toBe(1);
    expect(logs[0].kind).toBe('unlock-today');
    expect(logs[0].woken).toEqual(['s1']);
  });
});
