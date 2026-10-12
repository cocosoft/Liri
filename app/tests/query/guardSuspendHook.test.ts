// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T3-12：batch（TAOR）链「轮上限 / 熵门禁」guard 挂起落点。
//
// 门控：`GUARD_SUSPEND`（**默认关**）⇒ 关时零行为变更（不落检查点、不登记）。
// 落点复用既有轮间安全点：`saveCheckpoint('guard_suspend')` + `coordinator.suspend(kind='guard')`。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { handleTaorGuardSuspend } from '../../src/query/taor/budgetSuspendHook.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';

const FLAG = 'FEATURE_GUARD_SUSPEND';

describe('T3-12：TAOR guard 挂起落点', () => {
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

  it('开关关（默认）⇒ 不落、不登记（零行为变更）', async () => {
    const saved: string[] = [];
    await handleTaorGuardSuspend({
      sessionId: 'sess-guard',
      reason: 'turn_limit',
      saveCheckpoint: async (t) => {
        saved.push(t);
        return 'cp-1';
      },
    });
    expect(saved).toEqual([]);
    expect(getBudgetSuspendCoordinator().isSuspended('sess-guard')).toBe(false);
  });

  it('开关开 ⇒ 落 guard_suspend 检查点 + 登记 kind=guard + reason=turn_limit', async () => {
    process.env[FLAG] = 'true';
    const saved: string[] = [];
    await handleTaorGuardSuspend({
      sessionId: 'sess-guard',
      reason: 'turn_limit',
      saveCheckpoint: async (t) => {
        saved.push(t);
        return 'cp-guard-1';
      },
    });

    expect(saved).toEqual(['guard_suspend']);
    const c = getBudgetSuspendCoordinator();
    expect(c.isSuspended('sess-guard')).toBe(true);
    const e = c.list()[0];
    expect(e.chain).toBe('taor');
    expect(e.kind).toBe('guard');
    expect(e.reason).toBe('turn_limit');
    expect(e.checkpointRef).toBe('cp-guard-1');
  });

  it('开关开但检查点不可用（空 id）⇒ 不登记（不留幽灵挂起）', async () => {
    process.env[FLAG] = 'true';
    await handleTaorGuardSuspend({
      sessionId: 'sess-guard',
      reason: 'schema_entropy',
      saveCheckpoint: async () => '',
    });
    expect(getBudgetSuspendCoordinator().isSuspended('sess-guard')).toBe(false);
  });
});
