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
 * toolJobSuspend.ts — **侧车作业挂起**（「提交 → 挂起 → 完成 → 续跑」，T1-2② C₂，2026-10-13）。
 *
 * 原文（`.trae/specs/sidecar-async-suspend.md` §1）：长耗时侧车工具**不得同步阻塞** ——
 * 提交后须能向内核投影 `SUSPENDED`，完成后通知解冻续跑。§4 裁定：
 * **Q2** 新增 `kind='tool-job'`（与 budget/guard 正交）；**Q3** 冻结语义 = **不推进轮次 + 保留连接**。
 *
 * 本模块 = **实现体**（`IToolJobSuspendPort`）：
 *  - `registerToolJobSuspend`：登记 `kind='tool-job'`（协调器投影 `SUSPENDED` + 结构化日志）；
 *  - `releaseToolJobSuspend`：**仅**释放 `kind='tool-job'` 的登记（**不误放** budget/guard）+ 投影 `RUNNING`。
 *
 * **挂点位置（如实）**：挂点落在**工具侧**（`tools/sidecar/SidecarMediaAnalyzer` 的作业端口）——
 * 它经 **core SPI**（`resolveToolJobSuspend()`）调本模块，在**等完成**期间不推进轮次（Q3），
 * 完成通知到达后释放挂起并把结果交回调用方（续跑）。**本模块不建"万能 await 助手"**：
 * 单一调用方，包装只会多一层间接（CS03）。
 *
 * 边界（同 `budgetSuspend` / `guardSuspend` 纪律）：
 *  - **门控**：`TOOL_JOB_SUSPEND`（**默认关**）⇒ 关时 `register` 不登记（`disabled`）
 *    ⇒ 调用方**退化为纯等待**（与"未启用"逐字等价，零行为变更）；
 *  - **不被 relief 唤醒**：relief 只唤醒 `kind='budget'`（`isReliefEligible`）⇒ tool-job 天然免疫；
 *  - **不走 guard 继续入口**：那是人工放行通道（只受理 `kind='guard'`）⇒ 本挂起靠**完成通知自动续跑**；
 *  - 本模块**不** import `chat/**`（与 `budgetSuspend` 同纪律，避免成环）。
 */

import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import type {
  IToolJobSuspendPort,
  ToolJobSuspendRegisterResult,
} from '@modules/core/spi/ToolJobSuspendService.js';
import { publishStateProjection } from '../state/engine/projectionBroker.js';
import {
  getBudgetSuspendCoordinator,
  type SuspendEntry,
} from './budgetSuspend.js';

const logger = getLogger('query:toolJobSuspend');

/** 作业挂起原因（与 `SuspendEntry.reason` 字面量一致） */
export const TOOL_JOB_SUSPEND_REASON = 'tool_job_pending';

/** 是否启用侧车作业挂起（`FEATURE_TOOL_JOB_SUSPEND`，**默认关**） */
export function isToolJobSuspendEnabled(): boolean {
  return feature('TOOL_JOB_SUSPEND');
}

/** 该登记是否为**作业挂起**（`kind==='tool-job'`；缺省视为 budget ⇒ 非作业挂起） */
function isToolJobEntry(entry: SuspendEntry): boolean {
  return entry.kind === 'tool-job';
}

/**
 * 登记一条**作业挂起**（`kind='tool-job'`，`chain='tool-job'`）。
 *
 * 关（默认）⇒ 不登记、返回 `{registered:false, reason:'disabled'}`（零行为变更）。
 * 同 session 已有挂起 ⇒ 协调器**保留最早一条**（不覆盖）⇒ 本函数如返回 `registered:true`，
 * 但条目可能属于**更早**的挂起（如预算挂起）：**这是有意的**（一会话一个挂起点），
 * 故 `release` 侧**必须**按 `kind` 判据放行，不得无条件释放（见 `releaseToolJobSuspend`）。
 */
export function registerToolJobSuspend(input: {
  sessionId: string;
  jobId: string;
}): ToolJobSuspendRegisterResult {
  if (!isToolJobSuspendEnabled())
    return { registered: false, reason: 'disabled' };
  getBudgetSuspendCoordinator().suspend({
    sessionId: input.sessionId,
    chain: 'tool-job',
    reason: TOOL_JOB_SUSPEND_REASON,
    kind: 'tool-job',
  });
  logger.info('toolJobSuspend:registered', {
    sessionId: input.sessionId,
    jobId: input.jobId,
  });
  return { registered: true };
}

/**
 * 释放该会话的**作业挂起**（幂等）。
 *
 * **仅**当该会话的当前登记确为 `kind='tool-job'` 才释放（否则返回 `false`，**不动**别人的挂起）
 * ⇒ 防止把预算/guard 挂起误放行（放行语义串线是本仓既有红线）。
 * 实际释放时投影 `RUNNING`（解冻续跑）+ 结构化日志。
 */
export function releaseToolJobSuspend(sessionId: string): boolean {
  const entry = getBudgetSuspendCoordinator()
    .list()
    .find((e) => e.sessionId === sessionId);
  if (!entry || !isToolJobEntry(entry)) return false;
  // U-14 阶段 1.3：作业完成续跑前恢复该会话的编排内存态（无快照 ⇒ no-op）
  getBudgetSuspendCoordinator().restoreSnapshot(sessionId);
  getBudgetSuspendCoordinator().release(sessionId);
  // 解冻续跑 ⇒ 只读投影 RUNNING（协调器 `release()` 本身不投影，故在此显式发布；
  // 投影受 `FEATURE_STATE_PROJECTION_BROADCAST` 门控，关 ⇒ no-op，但**登记释放照常**）
  publishStateProjection({
    domain: 'execution',
    primitive: 'RUNNING',
    sessionId,
  });
  logger.info('toolJobSuspend:released', { sessionId });
  return true;
}

/**
 * 侧车作业挂起端口**实现体**（由 `entrypoints/spiWiring.ts` 注册进 core SPI）。
 *
 * 纯转发（门控/判定均在上述纯函数里）⇒ **无状态**，可安全地作为单例注册。
 */
export function createToolJobSuspendPort(): IToolJobSuspendPort {
  return {
    register: (input) => registerToolJobSuspend(input),
    release: (sessionId) => releaseToolJobSuspend(sessionId),
  };
}
