// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T3-12（债二扩展，2026-10-13 用户裁定）：guard 挂起（熵门禁 / 轮上限）与**独立继续入口**。
//
// 锁定：
//  - `GUARD_SUSPEND`（**默认关**）门控新行为 ⇒ 关时零行为变更（不登记）；
//  - 协调器条目 `kind`（缺省 `'budget'`）—— `onReliefApplied` **只唤醒 budget**，
//    **绝不**唤醒 guard（落实"不复用 relief 放行通道"）；
//  - 独立继续入口 `continueSuspendedSession`：仅对 **guard** 挂起生效，
//    budget 挂起仍走 relief（本入口不成为 relief 旁路）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend';
import {
  isGuardSuspendEnabled,
  registerGuardSuspend,
  guardSuspendFromEntropy,
  continueSuspendedSession,
} from '../../src/query/guardSuspend';

const FLAG = 'FEATURE_GUARD_SUSPEND';

describe('GUARD_SUSPEND 开关与 guard 挂起登记', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[FLAG];
    delete process.env[FLAG];
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
    resetBudgetSuspendForTest();
  });

  it('缺省（未设 env）⇒ 关：registerGuardSuspend 不登记（返回 false）', () => {
    expect(isGuardSuspendEnabled()).toBe(false);
    const ok = registerGuardSuspend({
      sessionId: 'g1',
      chain: 'stream',
      reason: 'schema_entropy',
    });
    expect(ok).toBe(false);
    expect(getBudgetSuspendCoordinator().isSuspended('g1')).toBe(false);
  });

  it('开 ⇒ 登记 kind=guard，reason 如实（turn_limit）', () => {
    process.env[FLAG] = 'true';
    expect(isGuardSuspendEnabled()).toBe(true);
    const ok = registerGuardSuspend({
      sessionId: 'g1',
      chain: 'taor',
      reason: 'turn_limit',
    });
    expect(ok).toBe(true);
    const list = getBudgetSuspendCoordinator().list();
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe('guard');
    expect(list[0].reason).toBe('turn_limit');
    expect(list[0].chain).toBe('taor');
  });

  it('开 ⇒ 登记 schema_entropy（stream 链）', () => {
    process.env[FLAG] = 'true';
    registerGuardSuspend({
      sessionId: 'g2',
      chain: 'stream',
      reason: 'schema_entropy',
    });
    const e = getBudgetSuspendCoordinator().list()[0];
    expect(e.kind).toBe('guard');
    expect(e.reason).toBe('schema_entropy');
  });

  it('熵门禁裁决接线：warn=true 且开关开 ⇒ 登记 schema_entropy', () => {
    process.env[FLAG] = 'true';
    const ok = guardSuspendFromEntropy('g3', 'stream', { warn: true });
    expect(ok).toBe(true);
    const e = getBudgetSuspendCoordinator().list()[0];
    expect(e.kind).toBe('guard');
    expect(e.reason).toBe('schema_entropy');
  });

  it('熵门禁裁决接线：warn=false / verdict=null ⇒ 不登记', () => {
    process.env[FLAG] = 'true';
    expect(guardSuspendFromEntropy('g4', 'stream', { warn: false })).toBe(
      false
    );
    expect(guardSuspendFromEntropy('g4', 'stream', null)).toBe(false);
    expect(getBudgetSuspendCoordinator().list().length).toBe(0);
  });

  it('熵门禁裁决接线：开关关 ⇒ warn=true 也不登记（零行为变更）', () => {
    const ok = guardSuspendFromEntropy('g5', 'stream', { warn: true });
    expect(ok).toBe(false);
    expect(getBudgetSuspendCoordinator().isSuspended('g5')).toBe(false);
  });
});

describe('协调器 kind 过滤：relief 只唤醒 budget，绝不唤醒 guard（负向证据）', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[FLAG];
    delete process.env[FLAG];
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
    resetBudgetSuspendForTest();
  });

  it('仅 guard 挂起 ⇒ relief 零唤醒且 handler 零调用，guard 仍挂起', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'g1',
      chain: 'taor',
      reason: 'turn_limit',
      kind: 'guard',
    });

    let calls = 0;
    c.setResumeHandler(async () => {
      calls += 1;
      return true;
    });

    const { woken } = await c.onReliefApplied('unlock-today');
    expect(woken).toEqual([]);
    expect(calls).toBe(0);
    expect(c.isSuspended('g1')).toBe(true);
  });

  it('混挂 budget + guard ⇒ 只唤醒 budget（guard 保持挂起）', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'b1',
      chain: 'taor',
      reason: 'daily_budget_exhausted',
    });
    c.suspend({
      sessionId: 'g1',
      chain: 'taor',
      reason: 'schema_entropy',
      kind: 'guard',
    });

    const called: string[] = [];
    c.setResumeHandler(async (sid) => {
      called.push(sid);
      return true;
    });

    const { woken } = await c.onReliefApplied('boost');
    expect(woken).toEqual(['b1']);
    expect(called).toEqual(['b1']);
    expect(c.isSuspended('g1')).toBe(true);
  });

  it('list() 对缺省 kind 条目向后兼容（未声明 kind 视为 budget）', () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 'b1', chain: 'stream', reason: 'r' });
    expect(c.list()[0].kind ?? 'budget').toBe('budget');
  });
});

describe('独立继续入口 continueSuspendedSession（仅 guard）', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[FLAG];
    process.env[FLAG] = 'true'; // 继续入口仅在本开关开时生效
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
    resetBudgetSuspendForTest();
  });

  it('guard 挂起 ⇒ release + 走既有续跑通道（rsume 返回 true ⇒ ok）', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'g1',
      chain: 'taor',
      reason: 'turn_limit',
      kind: 'guard',
    });

    const invoked: Array<[string, string]> = [];
    const outcome = await continueSuspendedSession(
      c,
      async (sid, chain) => {
        invoked.push([sid, chain]);
        return true;
      },
      'g1'
    );

    expect(outcome).toEqual({ ok: true, chain: 'taor' });
    expect(invoked).toEqual([['g1', 'taor']]);
    expect(c.isSuspended('g1')).toBe(false); // release 后不再挂起
  });

  it('未挂起 ⇒ { ok:false, code:not_suspended }（无副作用）', async () => {
    const c = getBudgetSuspendCoordinator();
    let calls = 0;
    const outcome = await continueSuspendedSession(
      c,
      async () => {
        calls += 1;
        return true;
      },
      'nope'
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('not_suspended');
    expect(calls).toBe(0);
  });

  it('budget 挂起 ⇒ 拒绝（{ ok:false, code:budget_kind }），不走续跑（不成为 relief 旁路）', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'b1',
      chain: 'taor',
      reason: 'daily_budget_exhausted',
    });
    let calls = 0;
    const outcome = await continueSuspendedSession(
      c,
      async () => {
        calls += 1;
        return true;
      },
      'b1'
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('budget_kind');
    expect(calls).toBe(0);
    expect(c.isSuspended('b1')).toBe(true); // budget 挂起未被消费
  });

  it('续跑失败（resume 返回 false）⇒ { ok:false, code:resume_failed } 且回滚为挂起', async () => {
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'g1',
      chain: 'stream',
      reason: 'schema_entropy',
      kind: 'guard',
    });
    const outcome = await continueSuspendedSession(c, async () => false, 'g1');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('resume_failed');
    expect(c.isSuspended('g1')).toBe(true); // 回滚保留挂起
    expect(c.list()[0].kind).toBe('guard');
  });

  it('开关关 ⇒ { ok:false, code:disabled }（零行为变更）', async () => {
    process.env[FLAG] = 'false';
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'g1',
      chain: 'taor',
      reason: 'turn_limit',
      kind: 'guard',
    });
    let calls = 0;
    const outcome = await continueSuspendedSession(
      c,
      async () => {
        calls += 1;
        return true;
      },
      'g1'
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('disabled');
    expect(calls).toBe(0);
    expect(c.isSuspended('g1')).toBe(true);
  });
});
