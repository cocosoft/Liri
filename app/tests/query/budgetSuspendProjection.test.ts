// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Task 8（债二-预算挂起续跑）：挂起/唤醒的**只读四原语投影** + 结构化日志。
//
// 覆盖：
// ① `suspend` ⇒ 广播一条 `primitive==='SUSPENDED'`，且载荷**键集恒为**
//    `{at, domain, primitive, sessionId}`（多一个键即失败）；
// ② 唤醒 ⇒ 广播 `primitive==='RUNNING'`；
// ③ 双开关口径：`FEATURE_STATE_PROJECTION_BROADCAST` 关 ⇒ **零投影**，但**挂起登记照常**
//    （可见性不以投影为准）。

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  globalEventBus,
  SystemEvents,
  type EventSubscription,
} from '@openliri/kernel/events/EventBus.js';
import type { StateProjectionBroadcast } from '../../src/state/engine/projectionBroker.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend';

const FLAG_ENV = 'FEATURE_STATE_PROJECTION_BROADCAST';

let subscription: EventSubscription | null = null;
let received: StateProjectionBroadcast[] = [];

function capture(): StateProjectionBroadcast[] {
  received = [];
  subscription = globalEventBus.subscribe<StateProjectionBroadcast>(
    SystemEvents.STATE_PROJECTED,
    (payload) => {
      received.push(payload);
    }
  );
  return received;
}

describe('Task 8：预算挂起/唤醒的四原语投影', () => {
  beforeEach(() => {
    resetBudgetSuspendForTest();
    delete process.env[FLAG_ENV];
  });
  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
    delete process.env[FLAG_ENV];
    resetBudgetSuspendForTest();
  });

  it('① suspend ⇒ 投影 SUSPENDED，载荷键集恒为 {at,domain,primitive,sessionId}', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();

    getBudgetSuspendCoordinator().suspend({
      sessionId: 's1',
      chain: 'taor',
      reason: 'daily_budget_exhausted',
    });

    expect(events.length).toBe(1);
    expect(events[0].primitive).toBe('SUSPENDED');
    expect(events[0].domain).toBe('execution');
    expect(events[0].sessionId).toBe('s1');
    expect(Object.keys(events[0]).sort()).toEqual([
      'at',
      'domain',
      'primitive',
      'sessionId',
    ]);
  });

  it('② 唤醒 ⇒ 投影 RUNNING', async () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();

    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'stream', reason: 'r' });
    c.setResumeHandler(async () => true);
    await c.onReliefApplied('boost');

    expect(events.map((e) => e.primitive)).toEqual(['SUSPENDED', 'RUNNING']);
    expect(events[1].sessionId).toBe('s1');
  });

  it('③ 双开关口径：投影开关关 ⇒ 零投影，但挂起登记照常', () => {
    // FLAG 保持未设（默认关）
    const events = capture();

    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'r' });

    expect(events).toEqual([]); // 零投影
    expect(c.isSuspended('s1')).toBe(true); // 但登记照常
    expect(c.list().length).toBe(1);
  });
});
