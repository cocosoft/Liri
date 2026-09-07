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
 * planAbortRegistry — 活跃 PlanDrivenLoop 注册表（S4 / BUG-7 修复，2026-08-23；
 * PR9 S3 键化，2026-09-05）
 *
 * PdcaLauncher 启动计划循环时注册（taskId → { loop, sessionId }），ChatManager
 * abortSessionStream 停止会话流时经 abortSessionPlans 顺带中止该会话的全部活跃
 * 计划循环（方案 A：前端零改动）。
 *
 * 生命周期：run 开始前 register，run 结束后（then/catch/finally）unregister。
 * 键空间：taskId（弃「loopBySession 后注册覆盖」——同一任务重复注册视为冲突，
 * 显式报错，防止并发互相顶替；会话维度经 abortSessionPlans(sessionId) 遍历达成）。
 */

import type { PlanDrivenLoop } from '@modules/core';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('pdca:planAbort');

interface PlanLoopEntry {
  loop: PlanDrivenLoop;
  sessionId: string;
}

const loopByTask = new Map<string, PlanLoopEntry>();

/** 按 taskId 注册计划循环（同 taskId 重复注册显式报错，不覆盖） */
export function registerPlanLoop(
  taskId: string,
  sessionId: string,
  loop: PlanDrivenLoop
): void {
  if (loopByTask.has(taskId)) {
    throw new Error(
      `[planAbortRegistry] taskId ${taskId} 已注册活跃 PlanDrivenLoop，禁止覆盖（PR9 S3）`
    );
  }
  loopByTask.set(taskId, { loop, sessionId });
  logger.info('registerPlanLoop: 注册活跃 PDL', {
    taskId,
    sessionId,
    registrySize: loopByTask.size,
  });
}

/** 注销计划循环（仅当注册的是同一实例时删除，防止旧 run 结束后误删新 run） */
export function unregisterPlanLoop(taskId: string, loop: PlanDrivenLoop): void {
  const entry = loopByTask.get(taskId);
  if (entry && entry.loop === loop) {
    loopByTask.delete(taskId);
    logger.debug('unregisterPlanLoop: 注销 PDL（run 正常收尾）', {
      taskId,
      registrySize: loopByTask.size,
    });
  }
}

/** 中止某会话下的全部活跃计划循环（语义：停会话 = 停其全部任务） */
export function abortSessionPlans(sessionId: string): void {
  const doomed: Array<{ taskId: string; loop: PlanDrivenLoop }> = [];
  for (const [taskId, entry] of loopByTask) {
    if (entry.sessionId === sessionId)
      doomed.push({ taskId, loop: entry.loop });
  }
  for (const { taskId, loop } of doomed) {
    loop.abort();
    // abort 后该 loop 即将结束，直接移除避免重复 abort
    loopByTask.delete(taskId);
  }
  if (doomed.length > 0) {
    logger.info('abortSessionPlans: 会话中止已清空 PDL registry', {
      sessionId,
      abortedTaskIds: doomed.map((d) => d.taskId),
      registrySizeAfter: loopByTask.size,
    });
  }
}

/** 供事件/日志追溯：当前注册条目数 */
export function planAbortRegistrySize(): number {
  return loopByTask.size;
}
