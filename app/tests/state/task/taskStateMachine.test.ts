// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * TaskStateMachine — §十 阶段 C 测试
 * 验证：生命周期转移（pending→running→completed/failed）、恢复场景（running→lost）、
 * 关键状态日志分级、注册表登记。
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { TaskStatus } from '../../../src/tasks/types';
import { StateMachineRegistry } from '../../../src/state/engine/StateMachineRegistry';
import {
  TaskStateMachine,
  getTaskStateMachine,
} from '../../../src/state/task/TaskStateMachine';
import { IllegalTransitionError } from '../../../src/state/errors';

const TEST_TASK_ID = 'sm-test-task-001';

afterAll(() => {
  // 清理共享单例状态，避免污染顺序靠后的 state-all 契约测试
  StateMachineRegistry.getInstance().unregister(`task:${TEST_TASK_ID}`);
});

describe('TaskStateMachine — §十 阶段 C', () => {
  test('初始状态为 PENDING', () => {
    const m = new TaskStateMachine('t1');
    expect(m.getState()).toBe(TaskStatus.PENDING);
  });

  test('完整生命周期：pending → running → completed；失败路径 running → failed', () => {
    const m = new TaskStateMachine('t2');
    expect(m.transition(TaskStatus.RUNNING, 'spawn')).toBe(true);
    expect(m.getState()).toBe(TaskStatus.RUNNING);
    expect(m.transition(TaskStatus.COMPLETED, 'done')).toBe(true);
    expect(m.getState()).toBe(TaskStatus.COMPLETED);

    const m2 = new TaskStateMachine('t3');
    m2.transition(TaskStatus.RUNNING, 'spawn');
    expect(m2.transition(TaskStatus.FAILED, 'boom')).toBe(true);
    expect(m2.getState()).toBe(TaskStatus.FAILED);
  });

  test('重启恢复场景：running → lost（持久化初始状态传入）', () => {
    const m = new TaskStateMachine('t4', TaskStatus.RUNNING);
    expect(m.getState()).toBe(TaskStatus.RUNNING);
    expect(m.transition(TaskStatus.LOST, 'process restarted')).toBe(true);
    expect(m.getState()).toBe(TaskStatus.LOST);
  });

  test('终态不可逆（completed 不能再回到 pending）', () => {
    const m = new TaskStateMachine('t5');
    m.transition(TaskStatus.RUNNING, 'spawn');
    m.transition(TaskStatus.COMPLETED, 'done');
    expect(() =>
      m.transition(TaskStatus.PENDING, 'revert')
    ).toThrow(IllegalTransitionError);
  });

  test('getTaskStateMachine 注册到 StateMachineRegistry（id=task:{id}）且缓存复用', () => {
    const m = getTaskStateMachine(TEST_TASK_ID);
    expect(m.getState()).toBe(TaskStatus.PENDING);
    const registry = StateMachineRegistry.getInstance();
    expect(registry.listActive()).toContain(`task:${TEST_TASK_ID}`);
    expect(getTaskStateMachine(TEST_TASK_ID)).toBe(m);
  });

  test('任务终态为关键状态（failed/killed/lost）时历史含转移记录', () => {
    const m = new TaskStateMachine('t6');
    m.transition(TaskStatus.RUNNING, 'spawn');
    m.transition(TaskStatus.KILLED, 'user cancelled');
    const history = m.getHistory();
    expect(history.length).toBe(2);
    expect(history[1].to).toBe(TaskStatus.KILLED);
  });
});
