// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B6（2026-11-09）：中途发言并入当前计划（设计稿 §5-1）。
 *
 * 覆盖：
 *  - 补充需求追加到计划描述（纯函数，空描述不造占位）；
 *  - 步骤空隙期间的暂存 → 下一个步骤 loop 注册时排空（不重复投递）；
 *  - 无活跃编排器 ⇒ 返回 false（调用方照常走既有 launch 判定，不误吞新任务）。
 */

import { describe, expect, it } from 'bun:test';
import {
  appendSupplementToDescription,
  appendSupplementToSession,
} from '../../src/tasks/lro/demandSupplement';
import {
  enqueueSupplement,
  flushSupplements,
  type SteeringSink,
} from '../../src/tasks/lro/supplementQueue';

/** 记录收到的 steering（不依赖真实 TAORLoop） */
function createSink(): SteeringSink & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    queueSteering(message) {
      received.push(message);
    },
  };
}

describe('B6：补充需求并入计划描述', () => {
  it('非空描述 ⇒ 空行分隔后追加补充分节', () => {
    expect(
      appendSupplementToDescription('把贪吃蛇做完', '再加一个计分板')
    ).toBe('把贪吃蛇做完\n\n【补充需求】再加一个计分板');
  });

  it('空描述 ⇒ 只有补充分节（不造空行占位）', () => {
    expect(appendSupplementToDescription('   ', '再加一个计分板')).toBe(
      '【补充需求】再加一个计分板'
    );
  });
});

describe('B6：步骤空隙期间的补充需求暂存', () => {
  it('暂存 ⇒ 下一个 loop 注册时按序投递并清空', () => {
    const sessionId = 'session-b6-flush';
    enqueueSupplement(sessionId, '补充 A');
    enqueueSupplement(sessionId, '补充 B');

    const sink = createSink();
    flushSupplements(sessionId, sink);
    expect(sink.received).toEqual(['补充 A', '补充 B']);

    // 已排空 ⇒ 再次注册不重复投递
    const second = createSink();
    flushSupplements(sessionId, second);
    expect(second.received).toEqual([]);
  });

  it('无 sessionId / 无暂存 ⇒ no-op', () => {
    const sink = createSink();
    flushSupplements(null, sink);
    flushSupplements('session-b6-empty', sink);
    expect(sink.received).toEqual([]);
  });
});

describe('B6：无活跃编排器时不并入', () => {
  it('会话无在跑任务 ⇒ 返回 false（交给既有 launch 判定）', () => {
    expect(appendSupplementToSession('session-b6-no-task', '补充')).toBe(false);
  });
});
