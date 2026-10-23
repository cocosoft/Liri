/**
 * 四原语投影**广播**（Broker）测试（状态机规范管理方案 阶段 4，2026-10-12）。
 *
 * 覆盖 §4.2/§4.3 的可判定部分：
 * ① **telemetry-gated**：`FEATURE_STATE_PROJECTION_BROADCAST` 关（默认）⇒ **零发布**（零行为变更）；
 * ② **挂钩唯一 choke point**：`ExecutionManager` 的 acquire/complete 经 `emitStatus` ⇒ 无需手工调用；
 * ③ **不暴露内部细粒度状态**（§4.3）：载荷**键集**恒为 `{at, domain, primitive, sessionId}`，
 *    **不含**任何原生状态/内部标识（以键集断言 + 原生专属字面量缺席双重锁定）；
 * ④ **观测面隔离**：订阅者抛错**不**回流到执行主链路（fire-and-forget 语义，见 eventbus-semantics.md）。
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { ExecutionManager } from '../../src/execution/index.js';
import {
  globalEventBus,
  SystemEvents,
  type EventSubscription,
} from '@modules/core/events/EventBus.js';
import type { StateProjectionBroadcast } from '../../src/state/engine/projectionBroker.js';

const FLAG_ENV = 'FEATURE_STATE_PROJECTION_BROADCAST';

let subscription: EventSubscription | null = null;
let received: StateProjectionBroadcast[] = [];

/** 订阅 `state:projected` 并收集载荷 */
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

beforeEach(() => {
  delete process.env[FLAG_ENV];
});

afterEach(() => {
  subscription?.unsubscribe();
  subscription = null;
  delete process.env[FLAG_ENV];
});

afterAll(() => {
  delete process.env[FLAG_ENV];
});

describe('四原语投影广播（阶段 4 / 4.2 / 4.3）', () => {
  it('开关关（默认）⇒ 零发布（零行为变更）', () => {
    const events = capture();
    const m = new ExecutionManager();
    const lease = m.acquire('s1');
    m.complete(lease.executionId);

    expect(events).toEqual([]);
  });

  it('开关开 ⇒ acquire/complete 各发一条，且只带原语（RUNNING → SETTLED）', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();
    const m = new ExecutionManager();
    const lease = m.acquire('s2');
    m.complete(lease.executionId);

    expect(events.map((e) => e.primitive)).toEqual(['RUNNING', 'SETTLED']);
    expect(events.every((e) => e.domain === 'execution')).toBe(true);
    expect(events.every((e) => e.sessionId === 's2')).toBe(true);
    expect(events.every((e) => typeof e.at === 'number')).toBe(true);
  });

  it('载荷**不暴露**内部细粒度状态：键集恒定，且无原生专属字面量', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();
    const m = new ExecutionManager();
    const lease = m.acquire('s3');
    m.complete(lease.executionId);

    expect(events.length).toBe(2);
    for (const payload of events) {
      expect(Object.keys(payload).sort()).toEqual([
        'at',
        'domain',
        'primitive',
        'sessionId',
      ]);
      const serialized = JSON.stringify(payload);
      // 原生专属取值（终态细分 / 在飞细分 / 内部标识）一律不得出现
      for (const nativeOnly of [
        'COMPLETED',
        'CANCELLED',
        'FAILED',
        'STALE',
        'QUEUED',
        'CANCEL_REQUESTED',
        'WAITING_USER',
        'executionId',
        'generation',
      ]) {
        expect(serialized).not.toContain(nativeOnly);
      }
    }
  });

  it('订阅者抛错不回流主链路（观测面隔离，fire-and-forget）', () => {
    process.env[FLAG_ENV] = 'true';
    const sub = globalEventBus.subscribe(SystemEvents.STATE_PROJECTED, () => {
      throw new Error('订阅者故意抛错');
    });
    try {
      const m = new ExecutionManager();
      expect(() => {
        const lease = m.acquire('s4');
        m.complete(lease.executionId);
      }).not.toThrow();
    } finally {
      sub.unsubscribe();
    }
  });
});
