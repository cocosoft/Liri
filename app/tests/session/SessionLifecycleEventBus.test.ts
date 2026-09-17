// MIT License
// Copyright (c) 2026 190615273@qq.com
// H8 回归测试（2026-09-17）：
//   SessionLifecycleEventBus.getHistory 覆盖父类后漏掉 reverse → 返回最旧 N 条，
//   与父类「最新 N 条」契约相反。修复：子类补 result.reverse() 对齐父类语义。

import { describe, expect, it } from 'bun:test';
import { SessionLifecycleEventBus } from '../../src/session/lifecycle/SessionLifecycleEventBus';

describe('H8: getHistory 对齐父类「最新 N 条」契约', () => {
  it('limit=1 时返回最新一条（而非最旧一条）', () => {
    const bus = new SessionLifecycleEventBus();
    bus.emit({
      type: 'session:created',
      sessionKey: 's1',
      sessionId: 's1',
      timestamp: 1000,
    });
    bus.emit({
      type: 'session:activated',
      sessionKey: 's1',
      sessionId: 's1',
      timestamp: 2000,
    });

    const hist = bus.getHistory({ limit: 1 });
    expect(hist).toHaveLength(1);
    expect(hist[0].event).toBe('session:activated'); // 最新
  });

  it('event 过滤 + limit 同样取该类型最新 N 条', () => {
    const bus = new SessionLifecycleEventBus();
    for (let i = 1; i <= 3; i++) {
      bus.emit({
        type: 'session:created',
        sessionKey: 's1',
        sessionId: 's1',
        timestamp: 1000 + i,
      });
      bus.emit({
        type: 'session:pruned',
        sessionKey: 's1',
        sessionId: 's1',
        timestamp: 1000 + i,
      });
    }

    const hist = bus.getHistory({ event: 'session:created', limit: 2 });
    expect(hist).toHaveLength(2);
    // 3 条 created 事件，最新 2 条：timestamp 1003、1002
    expect((hist[0].data as { timestamp: number }).timestamp).toBe(1003);
    expect((hist[1].data as { timestamp: number }).timestamp).toBe(1002);
  });
});
