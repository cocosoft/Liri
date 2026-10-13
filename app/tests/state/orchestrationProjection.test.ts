/**
 * T2-8 / `✅-17`：编排域四原语**只读投影**（形态 A，2026-10-13）
 *
 * 覆盖：
 * ① 开关关（默认）⇒ **零发布**（零行为变更）；
 * ② 开关开 ⇒ 编排域载荷 = `{at, domain:'orchestration', primitive, …关联字段}`，
 *    **不**含原生细粒度状态 / 内部标识；
 * ③ 关联字段按域取：任务型编排携 `orchestrationId`、会话型携 `sessionId`、两者兼有则皆携；
 * ④ **execution 域不受影响**（键集仍恒为 4 个，`orchestrationId` 不出现）。
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  globalEventBus,
  SystemEvents,
  type EventSubscription,
} from '../../src/core/events/EventBus.js';
import { publishStateProjection } from '../../src/state/engine/projectionBroker.js';
import { publishOrchestrationProjection } from '../../src/state/engine/orchestrationProjection.js';
import type { StateProjectionBroadcast } from '../../src/state/engine/projectionBroker.js';

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

describe('T2-8 编排域只读投影（形态 A）', () => {
  it('开关关（默认）⇒ 零发布', () => {
    const events = capture();
    publishOrchestrationProjection({
      primitive: 'PREPARED',
      orchestrationId: 'w1',
    });
    expect(events).toEqual([]);
  });

  it('任务型编排：携 orchestrationId（不携 sessionId）', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();
    publishOrchestrationProjection({
      primitive: 'PREPARED',
      orchestrationId: 'task-1',
    });
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      domain: 'orchestration',
      primitive: 'PREPARED',
      orchestrationId: 'task-1',
      at: expect.any(Number),
    });
  });

  it('会话型编排：携 sessionId；兼有则两字段皆携', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();
    publishOrchestrationProjection({ primitive: 'RUNNING', sessionId: 's1' });
    publishOrchestrationProjection({
      primitive: 'SETTLED',
      sessionId: 's1',
      orchestrationId: 'task-1',
    });

    expect(Object.keys(events[0]!).sort()).toEqual([
      'at',
      'domain',
      'primitive',
      'sessionId',
    ]);
    expect(Object.keys(events[1]!).sort()).toEqual([
      'at',
      'domain',
      'orchestrationId',
      'primitive',
      'sessionId',
    ]);
    expect(events[1]!.primitive).toBe('SETTLED');
  });

  it('载荷不暴露原生细粒度状态 / 内部标识', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();
    publishOrchestrationProjection({
      primitive: 'RUNNING',
      sessionId: 's2',
      orchestrationId: 'task-2',
    });
    const serialized = JSON.stringify(events[0]);
    for (const nativeOnly of [
      'COMPLETED',
      'QUEUED',
      'CANCELLED',
      'executionId',
      'generation',
    ]) {
      expect(serialized).not.toContain(nativeOnly);
    }
  });

  it('execution 域不受影响：键集恒为 4（无 orchestrationId）', () => {
    process.env[FLAG_ENV] = 'true';
    const events = capture();
    publishStateProjection({
      domain: 'execution',
      primitive: 'RUNNING',
      sessionId: 's3',
    });
    expect(Object.keys(events[0]!).sort()).toEqual([
      'at',
      'domain',
      'primitive',
      'sessionId',
    ]);
  });
});
