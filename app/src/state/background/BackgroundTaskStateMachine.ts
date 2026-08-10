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
 * BackgroundTaskStateMachine — 后台任务状态机（§十 阶段 C）
 *
 * 将后台任务（Dream 记忆整理 / Buddy 成长等）的"手写布尔运行态"
 * （如 DreamEngine 的 `this.cycle.isRunning`）收敛到统一状态机引擎。
 * 状态：idle / running / skipped / failed / completed。
 * 注册到 StateMachineRegistry，经 GET /v1/state/all（§十 阶段 D）前端可见。
 */

import { StateMachine } from '../engine/StateMachine';
import { StateMachineRegistry } from '../engine/StateMachineRegistry';
import type { TransitionRules } from '../engine/types';

/** 后台任务状态枚举 */
export enum BackgroundTaskState {
  /** 空闲（可接受新任务） */
  IDLE = 'idle',
  /** 运行中 */
  RUNNING = 'running',
  /** 被跳过（前置条件不满足 / 并发守卫） */
  SKIPPED = 'skipped',
  /** 成功完成 */
  COMPLETED = 'completed',
  /** 执行失败 */
  FAILED = 'failed',
}

/** 后台任务状态转移规则表 */
export const BACKGROUND_TASK_TRANSITIONS: TransitionRules<BackgroundTaskState> =
  {
    [BackgroundTaskState.IDLE]: [
      BackgroundTaskState.RUNNING,
      BackgroundTaskState.SKIPPED,
    ],
    [BackgroundTaskState.RUNNING]: [
      BackgroundTaskState.COMPLETED,
      BackgroundTaskState.FAILED,
      BackgroundTaskState.IDLE,
    ],
    [BackgroundTaskState.SKIPPED]: [
      BackgroundTaskState.RUNNING,
      BackgroundTaskState.IDLE,
    ],
    [BackgroundTaskState.COMPLETED]: [
      BackgroundTaskState.RUNNING,
      BackgroundTaskState.IDLE,
    ],
    [BackgroundTaskState.FAILED]: [
      BackgroundTaskState.RUNNING,
      BackgroundTaskState.IDLE,
    ],
  };

export class BackgroundTaskStateMachine extends StateMachine<BackgroundTaskState> {
  /**
   * @param taskId 后台任务标识（如 dream / buddy-growth）
   */
  constructor(taskId: string) {
    super({
      initialState: BackgroundTaskState.IDLE,
      rules: BACKGROUND_TASK_TRANSITIONS,
      contextId: `background:${taskId}`,
      // FAILED 为关键状态：转移进入时日志 ≥ warn
      criticalStates: [BackgroundTaskState.FAILED],
    });
  }
}

/** 注册表键前缀 */
const REGISTRY_PREFIX = 'background';

/**
 * 获取（并首次注册）指定后台任务的状态机实例。
 * 满足 R09-002：状态机必须注册到 StateMachineRegistry。
 */
export function getBackgroundTaskStateMachine(
  taskId: string
): BackgroundTaskStateMachine {
  const id = `${REGISTRY_PREFIX}:${taskId}`;
  const registry = StateMachineRegistry.getInstance();
  const existing = registry.find<BackgroundTaskState>(id);
  if (existing) {
    return existing as unknown as BackgroundTaskStateMachine;
  }
  const machine = new BackgroundTaskStateMachine(taskId);
  registry.register(id, machine as unknown as StateMachine<string>);
  return machine;
}
