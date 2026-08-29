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
 * planAbortRegistry — 活跃 PlanDrivenLoop 注册表（S4 / BUG-7 修复，2026-08-23）
 *
 * PdcaLauncher 启动计划循环时注册（sessionId → loop），ChatManager.abortSessionStream
 * 停止会话流时经 abortSessionPlans 顺带中止该会话的活跃计划循环（方案 A：前端零改动）。
 *
 * 生命周期：run 开始前 register，run 结束后（then/catch/finally）unregister。
 * 同一会话并发 loop：后注册覆盖（前一个视为已结束，由 run 结束清理兜底）。
 */

import type { PlanDrivenLoop } from '@modules/core';

const loopBySession = new Map<string, PlanDrivenLoop>();

export function registerPlanLoop(
  sessionId: string,
  loop: PlanDrivenLoop
): void {
  // 同一会话并发 loop：后注册覆盖（前一个视为已结束）
  loopBySession.set(sessionId, loop);
}

export function unregisterPlanLoop(
  sessionId: string,
  loop: PlanDrivenLoop
): void {
  // 仅当当前注册的是同一实例时才删除，防止旧 loop 结束后误删新 loop
  if (loopBySession.get(sessionId) === loop) {
    loopBySession.delete(sessionId);
  }
}

export function abortSessionPlans(sessionId: string): void {
  const loop = loopBySession.get(sessionId);
  if (loop) {
    loop.abort();
    // abort 后该 loop 即将结束，直接移除避免重复 abort
    loopBySession.delete(sessionId);
  }
}
