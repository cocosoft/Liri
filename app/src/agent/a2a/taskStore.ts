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
 * A2A 任务存取（D3）
 *
 * **定位与边界（重要）**：本存储只缓存**同步委派**的结果，供 `tasks/get` 在
 * 同一进程内回查；它**不是**后台任务账本 —— 本实现不启动任何后台任务循环、
 * 不做跨轮计数，故不适用 R08-001（跨重启状态持久化）。
 * 进程重启后旧任务不可查，客户端应按 §3.4「终态不可重启、细化请求新建任务」重新发起。
 */

import { randomUUID } from 'node:crypto';
import {
  isTerminalState,
  type A2AArtifact,
  type A2AMessage,
  type A2ATask,
  type A2ATaskState,
} from './types';

/** 完成后保留的任务条目上限（防内存无界增长） */
const MAX_RETAINED_TASKS = 200;

export class A2ATaskStore {
  /** taskId → Task（插入序即创建序，超限时淘汰最旧） */
  private tasks = new Map<string, A2ATask>();

  /** 新建任务（§3.4：新任务才能承载新工作，终态任务永不复用） */
  create(contextId?: string): A2ATask {
    const task: A2ATask = {
      id: randomUUID(),
      contextId: contextId ?? randomUUID(),
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      artifacts: [],
      history: [],
    };
    this.tasks.set(task.id, task);
    this.evictIfNeeded();
    return task;
  }

  get(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId);
  }

  list(): A2ATask[] {
    return [...this.tasks.values()];
  }

  /**
   * 更新状态与产物。
   *
   * @throws Error 若任务已处于终态（§3.4 不可重启）或不存在
   */
  complete(
    taskId: string,
    state: A2ATaskState,
    artifacts: A2AArtifact[],
    message?: A2AMessage
  ): A2ATask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在：${taskId}`);
    if (isTerminalState(task.status.state)) {
      throw new Error(
        `任务已处于终态（${task.status.state}），不可重启：${taskId}`
      );
    }

    task.status = { state, timestamp: new Date().toISOString(), message };
    if (artifacts.length > 0) task.artifacts = artifacts;
    if (message) task.history = [...(task.history ?? []), message];
    return task;
  }

  /**
   * 取消任务（§4.4 CancelTask）。
   *
   * 同步委派模型下任务在响应时已是终态 → 此时返回"不可取消"，由调用方映射为
   * JSON-RPC `TaskNotCancelable`（`-32002`）。
   */
  cancel(taskId: string): A2ATask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在：${taskId}`);
    if (isTerminalState(task.status.state)) {
      throw new Error(
        `任务已处于终态（${task.status.state}），不可取消：${taskId}`
      );
    }

    task.status = { state: 'canceled', timestamp: new Date().toISOString() };
    return task;
  }

  /** 测试与重启语义用：清空 */
  clear(): void {
    this.tasks.clear();
  }

  private evictIfNeeded(): void {
    while (this.tasks.size > MAX_RETAINED_TASKS) {
      const oldest = this.tasks.keys().next().value;
      if (oldest === undefined) return;
      this.tasks.delete(oldest);
    }
  }
}

/** 进程内单例（与仓库既有 store 风格一致：模块级实例 + 显式 clear 供测试） */
export const a2aTaskStore = new A2ATaskStore();
