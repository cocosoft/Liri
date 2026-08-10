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
 * TaskStateMachine — 任务状态机（§十 阶段 C）
 *
 * 将 task-system 的任务状态（TaskStatus 6 态）接入统一状态机引擎：
 * pending / running / completed / failed / killed / lost。
 * 注册到 StateMachineRegistry，经 GET /v1/state/all（§十 阶段 D）前端可见；
 * 转移经 onTransition 桥接 SSE `task:state` 实时广播。
 * 注意：状态机是"观测层"（日志/事件/视图的事实源），不阻断 TaskRegistry
 * 既有状态流转——非法转移仅记录 warn，任务本体不受影响。
 */

import { getLogger } from '@modules/monitoring';
import { TaskStatus } from '../../tasks/types';
import { StateMachine } from '../engine/StateMachine';
import { StateMachineRegistry } from '../engine/StateMachineRegistry';
import type { TransitionRecord, TransitionRules } from '../engine/types';

const logger = getLogger('state:task-machine');

/**
 * 任务状态转移规则表
 * 覆盖 task-system 实际流转：pending→running→终态；重启恢复 running→lost；
 * 重试/重跑路径（failed/killed/lost → running）亦保留。
 */
export const TASK_TRANSITIONS: TransitionRules<TaskStatus> = {
  [TaskStatus.PENDING]: [
    TaskStatus.RUNNING,
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.KILLED,
    TaskStatus.LOST,
  ],
  [TaskStatus.RUNNING]: [
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.KILLED,
    TaskStatus.LOST,
  ],
  [TaskStatus.COMPLETED]: [
    TaskStatus.RUNNING,
    TaskStatus.FAILED,
    TaskStatus.KILLED,
    TaskStatus.LOST,
  ],
  [TaskStatus.FAILED]: [TaskStatus.RUNNING, TaskStatus.KILLED, TaskStatus.LOST],
  [TaskStatus.KILLED]: [TaskStatus.RUNNING, TaskStatus.FAILED, TaskStatus.LOST],
  [TaskStatus.LOST]: [
    TaskStatus.RUNNING,
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.KILLED,
  ],
};

/** 关键状态：进入这些状态时日志 ≥ warn */
const CRITICAL_STATES = [TaskStatus.FAILED, TaskStatus.KILLED, TaskStatus.LOST];

/**
 * 转移事件发布钩子 — 桥接 SSE `task:state`，前端可实时感知任务状态。
 * 与 AppLifecycle（app:state）/BackgroundTask（background:state）同构；
 * 惰性 require 规避 state → infrastructure 静态循环依赖。
 */
function createTransitionHook(
  taskId: string
): (record: TransitionRecord<TaskStatus>) => void {
  return (record) => {
    logger.info(`任务状态转移事件: ${record.from} → ${record.to}`, {
      taskId,
      reason: record.reason,
    });
    try {
      const { broadcastEvent } =
        require('@modules/infrastructure/http/LocalHTTPServiceSSE') as typeof import('@modules/infrastructure/http/LocalHTTPServiceSSE');
      broadcastEvent('task:state', {
        taskId,
        state: record.to,
        from: record.from,
        reason: record.reason,
        timestamp: record.timestamp,
      });
    } catch (e) {
      // @ignore-catch — 早期启动/非 HTTP 模式下 SSE 桥接不可用，不影响状态机
      logger.debug('task:state SSE 桥接失败', { error: String(e) });
    }
  };
}

export class TaskStateMachine extends StateMachine<TaskStatus> {
  /**
   * @param taskId 任务标识
   * @param initialState 初始状态（默认 pending；恢复场景传持久化状态）
   */
  constructor(taskId: string, initialState: TaskStatus = TaskStatus.PENDING) {
    super({
      initialState,
      rules: TASK_TRANSITIONS,
      contextId: `task:${taskId}`,
      criticalStates: CRITICAL_STATES,
      onTransition: createTransitionHook(taskId),
    });
  }
}

/** 注册表键前缀 */
const REGISTRY_PREFIX = 'task';

/**
 * 获取（并首次注册）指定任务的状态机实例。
 * 满足 R09-002：状态机必须注册到 StateMachineRegistry。
 */
export function getTaskStateMachine(
  taskId: string,
  initialState: TaskStatus = TaskStatus.PENDING
): TaskStateMachine {
  const id = `${REGISTRY_PREFIX}:${taskId}`;
  const registry = StateMachineRegistry.getInstance();
  const existing = registry.find<TaskStatus>(id);
  if (existing) {
    return existing as unknown as TaskStateMachine;
  }
  const machine = new TaskStateMachine(taskId, initialState);
  registry.register(id, machine as unknown as StateMachine<string>);
  return machine;
}
