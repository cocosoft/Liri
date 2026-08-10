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
 * BackgroundTaskStateMachine — §十 阶段 C 测试
 * 验证：生命周期转移（idle→running→completed/failed）、多轮复用、非法转移拒绝、注册表登记。
 */

import { describe, expect, test } from 'bun:test';
import { StateMachineRegistry } from '../../../src/state/engine/StateMachineRegistry';
import {
  BackgroundTaskState,
  BackgroundTaskStateMachine,
  getBackgroundTaskStateMachine,
} from '../../../src/state/background/BackgroundTaskStateMachine';
import { IllegalTransitionError } from '../../../src/state/errors';

describe('BackgroundTaskStateMachine — §十 阶段 C', () => {
  test('初始状态为 IDLE', () => {
    const m = new BackgroundTaskStateMachine('test-task');
    expect(m.getState()).toBe(BackgroundTaskState.IDLE);
  });

  test('完整生命周期：idle → running → completed，可再次 running（多轮）', () => {
    const m = new BackgroundTaskStateMachine('test-task');
    expect(m.transition(BackgroundTaskState.RUNNING, 'cycle start')).toBe(true);
    expect(m.getState()).toBe(BackgroundTaskState.RUNNING);
    expect(m.transition(BackgroundTaskState.COMPLETED, 'done')).toBe(true);
    expect(m.getState()).toBe(BackgroundTaskState.COMPLETED);
    // 下一轮：completed → running
    expect(m.transition(BackgroundTaskState.RUNNING, 'next cycle')).toBe(true);
    expect(m.transition(BackgroundTaskState.FAILED, 'boom')).toBe(true);
    expect(m.getState()).toBe(BackgroundTaskState.FAILED);
  });

  test('非法转移抛 IllegalTransitionError（如 idle 直接 completed）', () => {
    const m = new BackgroundTaskStateMachine('test-task');
    expect(() =>
      m.transition(BackgroundTaskState.COMPLETED, 'direct')
    ).toThrow(IllegalTransitionError);
  });

  test('getBackgroundTaskStateMachine 注册到 StateMachineRegistry（id=background:dream）', () => {
    const m = getBackgroundTaskStateMachine('dream');
    expect(m.getState()).toBe(BackgroundTaskState.IDLE);
    const registry = StateMachineRegistry.getInstance();
    expect(registry.listActive()).toContain('background:dream');
    // 二次获取返回同一实例（缓存）
    expect(getBackgroundTaskStateMachine('dream')).toBe(m);
  });
});
