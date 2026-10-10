/**
 * P2-1f —— S3 工具轮 `assistant/todo` **载荷构造**契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S3 / §5；实现见
 * `src/chat/orchestrator/streamMessageHelpers.ts`。
 *
 * 锁定：
 * 1. 映射口径（`phase` → 事件 `status`；任务字段逐项透传）；
 * 2. **可选键有值才写**（`planId` / `result` / `durationMs`）—— `undefined` 键会被落盘前
 *    的 D1 无损 JSON 校验**整条拒绝**（本仓既有约束）。
 */
import { describe, expect, it } from 'bun:test';

import { buildTodoEventData } from '../../../src/chat/orchestrator/streamMessageHelpers.js';
import type { TodoBlockData } from '@modules/runtime/api/todo-types';

function todo(overrides: Partial<TodoBlockData> = {}): TodoBlockData {
  return {
    title: '计划 A',
    phase: 'executing',
    createdAt: 0,
    tasks: [
      {
        id: 't1',
        name: '步骤一',
        status: 'in_progress',
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

describe('P2-1f S3 工具轮 · `assistant/todo` 载荷构造', () => {
  it('映射：`phase` → 事件 `status`；`action` 恒为 `write`', () => {
    const data = buildTodoEventData(todo());
    expect(data.action).toBe('write');
    expect(data.taskCard?.title).toBe('计划 A');
    expect(data.taskCard?.status).toBe('executing');
    expect(data.taskCard?.tasks[0]).toEqual({
      id: 't1',
      name: '步骤一',
      status: 'in_progress',
      dependsOn: [],
    });
  });

  it('`planId` 缺省 ⇒ **不含** `planId` 键（防 undefined 键被 D1 整条拒绝）', () => {
    const data = buildTodoEventData(todo());
    expect('planId' in (data.taskCard ?? {})).toBe(false);
  });

  it('`planId` 有值 ⇒ 写入', () => {
    const data = buildTodoEventData(todo({ planId: 'plan-1' }));
    expect(data.taskCard?.planId).toBe('plan-1');
  });

  it('任务的 `result` / `durationMs` 缺省 ⇒ **不含**对应键；有值 ⇒ 写入', () => {
    const absent = buildTodoEventData(todo());
    expect('result' in absent.taskCard!.tasks[0]).toBe(false);
    expect('durationMs' in absent.taskCard!.tasks[0]).toBe(false);

    const present = buildTodoEventData(
      todo({
        tasks: [
          {
            id: 't2',
            name: '步骤二',
            status: 'completed',
            dependsOn: ['t1'],
            result: 'ok',
            durationMs: 12,
          },
        ],
      })
    );
    expect(present.taskCard!.tasks[0].result).toBe('ok');
    expect(present.taskCard!.tasks[0].durationMs).toBe(12);
    expect(present.taskCard!.tasks[0].dependsOn).toEqual(['t1']);
  });
});
