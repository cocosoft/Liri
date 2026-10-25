/**
 * U-15：四原语投影的**统一出站管道**（projectionOutbound）。
 *
 * 覆盖：
 * ① 注册 sink 后，`STATE_PROJECTED` 投影被 fan-out；
 * ② 注销后不再交付；最后一个 sink 注销会释放订阅；
 * ③ broker 开关关（默认）⇒ 无事件可转发（零行为变更）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { publishStateProjection } from '../../src/state/engine/projectionBroker.js';
import type { StateProjectionBroadcast } from '../../src/state/engine/projectionBroker.js';
import {
  getProjectionOutboundSinkCount,
  registerProjectionOutboundSink,
  resetProjectionOutboundForTest,
} from '../../src/state/engine/projectionOutbound.js';

const FLAG_ENV = 'FEATURE_STATE_PROJECTION_BROADCAST';

beforeEach(() => {
  resetProjectionOutboundForTest();
  delete process.env[FLAG_ENV];
});

afterEach(() => {
  resetProjectionOutboundForTest();
  delete process.env[FLAG_ENV];
});

describe('U-15 projection outbound pipeline', () => {
  it('注册 sink 后投影被 fan-out，注销后停止', () => {
    process.env[FLAG_ENV] = 'true';
    const received: StateProjectionBroadcast[] = [];
    const unregister = registerProjectionOutboundSink({
      name: 'test-sink',
      deliver: (p) => received.push(p),
    });
    expect(getProjectionOutboundSinkCount()).toBe(1);

    publishStateProjection({
      domain: 'orchestration',
      primitive: 'RUNNING',
      orchestrationId: 'plan-1',
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      domain: 'orchestration',
      primitive: 'RUNNING',
      orchestrationId: 'plan-1',
    });

    unregister();
    expect(getProjectionOutboundSinkCount()).toBe(0);
    publishStateProjection({
      domain: 'orchestration',
      primitive: 'SETTLED',
      orchestrationId: 'plan-1',
    });
    expect(received).toHaveLength(1);
  });

  it('broker 开关关（默认）⇒ 零转发', () => {
    const received: StateProjectionBroadcast[] = [];
    registerProjectionOutboundSink({
      name: 'test-sink',
      deliver: (p) => received.push(p),
    });
    publishStateProjection({
      domain: 'orchestration',
      primitive: 'PREPARED',
      orchestrationId: 'plan-2',
    });
    expect(received).toHaveLength(0);
  });

  // T25-01：准入由 sink 自声明，choke point 只机械调用（不做裁决）
  it('sink.accept 返回 false ⇒ 不交付；不声明 accept ⇒ 恒交付', () => {
    process.env[FLAG_ENV] = 'true';
    const denied: StateProjectionBroadcast[] = [];
    const all: StateProjectionBroadcast[] = [];
    registerProjectionOutboundSink({
      name: 'deny-all',
      accept: () => false,
      deliver: (p) => denied.push(p),
    });
    registerProjectionOutboundSink({
      name: 'no-accept',
      deliver: (p) => all.push(p),
    });

    publishStateProjection({
      domain: 'orchestration',
      primitive: 'RUNNING',
      orchestrationId: 'plan-3',
    });

    expect(denied).toHaveLength(0);
    expect(all).toHaveLength(1);
  });
});
