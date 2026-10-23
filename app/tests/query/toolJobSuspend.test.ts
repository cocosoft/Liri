// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T1-2② C₂（2026-10-13）：**侧车作业挂起**（`kind='tool-job'`）—— 登记 / 释放 / 投影，
// 以及它与既有放行通道（relief、guard 继续入口）**正交**。
//
// 覆盖：
// ① `TOOL_JOB_SUSPEND`（**默认关**）门控 ⇒ 关时不登记（`disabled`）、零行为变更；
// ② 开 ⇒ 登记 `kind='tool-job'` + `chain='tool-job'` + reason，并投影 `SUSPENDED`；
// ③ 释放 ⇒ **仅**放作业挂起 + 投影 `RUNNING`（时序 `SUSPENDED → RUNNING`）；幂等；
// ④ **不误放异类（红线）**：同会话为 `budget` 挂起时，`releaseToolJobSuspend` **不得**放行；
// ⑤ **relief 不唤醒**作业挂起（唤醒 handler 调用数 = 0，条目保持挂起）；
// ⑥ guard 继续入口**不适用**作业挂起（按类别给出可读原因，且**未**调用续跑通道）；
// ⑦ core SPI：**未注册 ⇒ no-op**（不挂起 / 不释放 / 不抛）；注册后走真实实现。

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  globalEventBus,
  SystemEvents,
  type EventSubscription,
} from '@modules/core/events/EventBus.js';
import type { StateProjectionBroadcast } from '../../src/state/engine/projectionBroker.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend';
import {
  createToolJobSuspendPort,
  isToolJobSuspendEnabled,
  registerToolJobSuspend,
  releaseToolJobSuspend,
} from '../../src/query/toolJobSuspend';
import { continueSuspendedSession } from '../../src/query/guardSuspend';
import {
  registerToolJobSuspendSpi,
  resetToolJobSuspendForTest,
  resolveToolJobSuspend,
} from '@modules/core/spi';

const FLAG = 'FEATURE_TOOL_JOB_SUSPEND';
const PROJECTION_FLAG = 'FEATURE_STATE_PROJECTION_BROADCAST';

let subscription: EventSubscription | null = null;
let received: StateProjectionBroadcast[] = [];

/** 订阅 `state:projected` 并收集载荷（同 `budgetSuspendProjection.test.ts` 手法） */
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

const prevEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of [FLAG, PROJECTION_FLAG]) {
    prevEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  resetBudgetSuspendForTest();
  resetToolJobSuspendForTest();
});

afterEach(() => {
  subscription?.unsubscribe();
  subscription = null;
  for (const key of [FLAG, PROJECTION_FLAG]) {
    const prev = prevEnv.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  resetBudgetSuspendForTest();
  resetToolJobSuspendForTest();
});

describe('T1-2② C₂：侧车作业挂起（kind=tool-job）', () => {
  it('① 默认关 ⇒ 不登记（disabled）且零投影；登记事实源无条目', () => {
    const events = capture();
    process.env[PROJECTION_FLAG] = 'true'; // 投影开着也不该有（未登记）

    expect(isToolJobSuspendEnabled()).toBe(false);
    const outcome = registerToolJobSuspend({ sessionId: 's1', jobId: 'job_1' });

    expect(outcome).toEqual({ registered: false, reason: 'disabled' });
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(false);
    expect(getBudgetSuspendCoordinator().list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('② 开 ⇒ 登记 kind=tool-job / chain=tool-job，并投影 SUSPENDED（载荷键集不变）', () => {
    process.env[FLAG] = 'true';
    process.env[PROJECTION_FLAG] = 'true';
    const events = capture();

    const outcome = registerToolJobSuspend({ sessionId: 's1', jobId: 'job_1' });

    expect(outcome).toEqual({ registered: true });
    const entries = getBudgetSuspendCoordinator().list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionId: 's1',
      kind: 'tool-job',
      chain: 'tool-job',
      reason: 'tool_job_pending',
    });
    expect(events.length).toBe(1);
    expect(events[0]!.primitive).toBe('SUSPENDED');
    expect(events[0]!.sessionId).toBe('s1');
    expect(Object.keys(events[0]!).sort()).toEqual([
      'at',
      'domain',
      'primitive',
      'sessionId',
    ]);
  });

  it('③ 释放 ⇒ 投影 RUNNING（SUSPENDED→RUNNING 时序）；二次调用幂等返回 false', () => {
    process.env[FLAG] = 'true';
    process.env[PROJECTION_FLAG] = 'true';
    const events = capture();

    registerToolJobSuspend({ sessionId: 's1', jobId: 'job_1' });
    const released = releaseToolJobSuspend('s1');

    expect(released).toBe(true);
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(false);
    expect(events.map((e) => e.primitive)).toEqual(['SUSPENDED', 'RUNNING']);
    expect(events[1]!.sessionId).toBe('s1');
    // 幂等：再次释放 ⇒ false（无条目），且**不再**产生投影
    expect(releaseToolJobSuspend('s1')).toBe(false);
    expect(events.map((e) => e.primitive)).toEqual(['SUSPENDED', 'RUNNING']);
  });

  it('④ 红线：同会话为 budget 挂起时，作业释放**不得**误放（返回 false 且条目仍在）', () => {
    process.env[FLAG] = 'true';

    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 's1',
      chain: 'taor',
      reason: 'daily_budget_exhausted',
    });

    expect(releaseToolJobSuspend('s1')).toBe(false);
    expect(c.isSuspended('s1')).toBe(true);
    expect(c.list()).toHaveLength(1);
  });

  it('⑤ relief **不**唤醒作业挂起（handler 调用数 0，条目保持挂起）', async () => {
    process.env[FLAG] = 'true';
    let handlerCalls = 0;
    const c = getBudgetSuspendCoordinator();
    c.setResumeHandler(async () => {
      handlerCalls += 1;
      return true;
    });

    registerToolJobSuspend({ sessionId: 's1', jobId: 'job_1' });
    const { woken } = await c.onReliefApplied('boost');

    expect(woken).toEqual([]);
    expect(handlerCalls).toBe(0);
    expect(c.isSuspended('s1')).toBe(true);
  });

  it('⑥ guard 继续入口**不适用**作业挂起（按类别给原因；续跑通道未被调用）', async () => {
    process.env[FLAG] = 'true';
    process.env['FEATURE_GUARD_SUSPEND'] = 'true';

    registerToolJobSuspend({ sessionId: 's1', jobId: 'job_1' });
    let resumeCalls = 0;
    const outcome = await continueSuspendedSession(
      getBudgetSuspendCoordinator(),
      async () => {
        resumeCalls += 1;
        return true;
      },
      's1'
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('budget_kind'); // 非 guard ⇒ 不得走人工放行通道
      expect(outcome.message).toContain('侧车作业挂起');
    }
    expect(resumeCalls).toBe(0);
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(true);
    delete process.env['FEATURE_GUARD_SUSPEND'];
  });

  it('⑦ core SPI：未注册 ⇒ no-op（不挂起/不释放/不抛）；注册后走真实实现', () => {
    process.env[FLAG] = 'true'; // 开关开着，但 SPI 未注册

    const unregistered = resolveToolJobSuspend();
    expect(unregistered.register({ sessionId: 's1', jobId: 'job_1' })).toEqual({
      registered: false,
      reason: 'not_registered',
    });
    expect(unregistered.release('s1')).toBe(false);
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(false);

    // 注册实现体（生产由 `entrypoints/spiWiring.ts` 推送注册）
    const registered: Array<{ id: string }> = [];
    void registerToolJobSuspendSpi(
      {
        registerDescriptor: (desc) => {
          registered.push({ id: desc.id });
        },
      },
      createToolJobSuspendPort()
    );

    expect(registered.map((r) => r.id)).toEqual([
      'core.spi.IToolJobSuspendPort',
    ]);
    const port = resolveToolJobSuspend();
    expect(port.register({ sessionId: 's1', jobId: 'job_1' })).toEqual({
      registered: true,
    });
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(true);
    expect(port.release('s1')).toBe(true);
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(false);
  });
});
