// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0（2026-11-24，真机 `session_mwq5ookl21aa28ea96`）：等待审批收口的调用侧归一。
 *
 * 真机日志：`[chatStream] 非法状态转换: idle → requires_action`（high）⇒ 编排器兜底补写
 * `turn/end{canceled}` ⇒ 前端把"等待审批"显示成"已中断"。
 * 修法：调用侧在 `pause()` 前把 `idle` 归一为 `running`；**转移表不动**
 *（`idle → requires_action` 仍是非法边，由本文件末例锁定）。
 */
import { describe, expect, it } from 'bun:test';
import { SessionStateMachine } from '@openliri/infra/state/session/SessionStateMachine';
import { IllegalTransitionError } from '@openliri/infra/state/errors';
import {
  pauseForApproval,
  type PauseableSessionMachine,
} from '../../../src/chat/services/sessionMachineGuards';

describe('pauseForApproval：idle 归一后暂停', () => {
  it('机器在 idle ⇒ 先 idle→running 再 running→requires_action，返回 true', () => {
    const machine = new SessionStateMachine('sess-idle-pause');

    expect(pauseForApproval(machine, '等待审批')).toBe(true);

    expect(machine.getState()).toBe('requires_action');
    const edges = machine.getHistory().map((r) => `${r.from}->${r.to}`);
    expect(edges).toEqual(['idle->running', 'running->requires_action']);
  });

  it('机器已在 running ⇒ 只做一次暂停，返回 false（无需归一）', () => {
    const machine = new SessionStateMachine('sess-running-pause');
    machine.start('回合开始');
    const before = machine.getHistory().length;

    expect(pauseForApproval(machine, '等待审批')).toBe(false);

    expect(machine.getState()).toBe('requires_action');
    expect(machine.getHistory().length).toBe(before + 1);
  });

  it('机器已在 requires_action ⇒ 幂等无操作（不新增历史）', () => {
    const machine = new SessionStateMachine('sess-dup-pause');
    machine.start('回合开始');
    machine.pause('首次暂停');
    const before = machine.getHistory().length;

    expect(pauseForApproval(machine, '再次暂停')).toBe(false);

    expect(machine.getState()).toBe('requires_action');
    expect(machine.getHistory().length).toBe(before);
  });

  it('调用顺序固定为 start → pause（替身记录）', () => {
    const calls: string[] = [];
    const stub: PauseableSessionMachine = {
      canStart: () => true,
      start: (reason) => {
        calls.push(`start:${reason ?? ''}`);
      },
      pause: (reason) => {
        calls.push(`pause:${reason ?? ''}`);
      },
    };

    expect(pauseForApproval(stub, '等待审批')).toBe(true);
    expect(calls).toEqual([
      'start:pause 前归一（idle → running）',
      'pause:等待审批',
    ]);
  });

  it('负向对照：转移表契约不变 —— idle 直接 pause 仍抛 IllegalTransitionError', () => {
    const machine = new SessionStateMachine('sess-contract');
    expect(() => machine.pause('绕过归一')).toThrow(IllegalTransitionError);
  });
});
