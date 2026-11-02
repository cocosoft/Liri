/**
 * P39-b-2 · 驾驶舱完整历史 / 接管候选（纯函数）
 *
 * 验证：
 * ① 历史按 `startedAt` 升序回放，且不改动入参顺序；
 * ② 接管候选：最新派工优先 → 工作项行 → 无（不猜、不新建）；
 * ③ 缺字段不补造。
 */
import { describe, it, expect } from 'bun:test';

import {
  buildCockpitHistory,
  pickTakeoverSessionId,
} from '../../../src/tasks/cockpit';
import type { TicketAssignmentRecord } from '../../../src/tasks/ticketAssignmentStore';

function assignment(
  over: Partial<TicketAssignmentRecord>
): TicketAssignmentRecord {
  return {
    assignmentId: 'a',
    workItemId: 'w',
    executor: 'alwayson',
    state: 'running',
    startedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('buildCockpitHistory', () => {
  it('派工 / 执行均按开始时刻升序；不改动入参', () => {
    const assignments = [
      assignment({ assignmentId: 'a2', startedAt: 20 }),
      assignment({ assignmentId: 'a1', startedAt: 10 }),
    ];
    const executions = [
      { executionId: 'e2', status: 'COMPLETED', startedAt: 200 },
      { executionId: 'e1', status: 'FAILED', startedAt: 100 },
    ];

    const history = buildCockpitHistory({
      workItem: { id: 'w1', status: 'completed', title: '修复 CI' },
      assignments,
      executions,
    });

    expect(history.assignments.map((a) => a.assignmentId)).toEqual([
      'a1',
      'a2',
    ]);
    expect(history.executions.map((e) => e.executionId)).toEqual(['e1', 'e2']);
    // 入参保持原顺序（纯函数不外溢副作用）
    expect(assignments.map((a) => a.assignmentId)).toEqual(['a2', 'a1']);
    expect(executions.map((e) => e.executionId)).toEqual(['e2', 'e1']);
  });

  it('工作项事实原样保留（缺字段不补造）', () => {
    const history = buildCockpitHistory({
      workItem: { id: 'w2', status: 'running' },
      assignments: [],
      executions: [],
    });
    expect(history.workItem).toEqual({ id: 'w2', status: 'running' });
    expect(history.assignments).toEqual([]);
    expect(history.executions).toEqual([]);
  });
});

describe('pickTakeoverSessionId', () => {
  it('最新派工优先于工作项行', () => {
    expect(
      pickTakeoverSessionId({
        latestAssignmentSessionId: 's-assign',
        workItemSessionId: 's-item',
      })
    ).toBe('s-assign');
  });

  it('无派工会话 ⇒ 回落工作项行', () => {
    expect(pickTakeoverSessionId({ workItemSessionId: 's-item' })).toBe(
      's-item'
    );
  });

  it('两者皆无 ⇒ undefined（不猜、不新建）', () => {
    expect(pickTakeoverSessionId({})).toBeUndefined();
  });
});
