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
 * guardSuspend.ts — **guard 挂起**（熵门禁 / 轮上限）与**独立继续入口**（T3-12，2026-10-13）。
 *
 * 背景（用户 2026-10-13 裁定「熵门禁 + 轮上限两者都接通挂起」+「挂起后新增独立的『长程继续』
 * 入口/端点，不复用 relief 放行通道」；来源：`长程任务编排链路优化方案-20261012.md` §4 阶段 2.2
 * `T3-12` / `五方案总览-20261012.md` §2 `✅-18`）。
 *
 * 边界：
 *  - **门控**：`GUARD_SUSPEND`（**默认关**）⇒ 关时零行为变更（`registerGuardSuspend` 直接返回
 *    `false`；继续入口 `continueSuspendedSession` 返回 `disabled`）。熵门禁仍只 WARN。
 *  - **不复用 relief**：guard 挂起登记为 `kind='guard'`；协调器 `onReliefApplied` 只唤醒
 *    `kind='budget'` ⇒ guard 绝不被放行通道唤醒，只能经本模块的继续入口。
 *  - **不改既有语义**：budget 挂起（缺省 kind）仍走日预算放行（relief）；本继续入口**拒绝对
 *    budget 挂起生效**（避免成为 relief 旁路）。
 *  - 本模块**不** import `chat/**`（与 `budgetSuspend` 同纪律）——续跑经注入的 `resume` 端口。
 */

import { feature } from '@modules/core';
import {
  getBudgetSuspendCoordinator,
  isResumableChain,
  type BudgetSuspendCoordinator,
  type ResumableSuspendChain,
  type SuspendChain,
} from './budgetSuspend.js';

/** guard 挂起原因（与 `SuspendEntry.reason` 字面量一致） */
export type GuardSuspendReason = 'schema_entropy' | 'turn_limit';

/** 合法 guard 挂起原因清单（供测试/断言单点引用） */
export const GUARD_SUSPEND_REASONS: readonly GuardSuspendReason[] = [
  'schema_entropy',
  'turn_limit',
];

/** 是否启用 guard 挂起 + 继续入口（`FEATURE_GUARD_SUSPEND`，**默认关**） */
export function isGuardSuspendEnabled(): boolean {
  return feature('GUARD_SUSPEND');
}

/**
 * 登记一条 **guard** 挂起（`kind='guard'`）。
 *
 * 关（默认）⇒ 不登记、返回 `false`（零行为变更）。挂起事实源仍是各链检查点；本函数只做协调器内存登记。
 *
 * @returns 是否**实际登记**（开关关 ⇒ false）
 */
export function registerGuardSuspend(params: {
  sessionId: string;
  chain: SuspendChain;
  reason: GuardSuspendReason;
  checkpointRef?: string;
}): boolean {
  if (!isGuardSuspendEnabled()) return false;
  getBudgetSuspendCoordinator().suspend({
    sessionId: params.sessionId,
    chain: params.chain,
    checkpointRef: params.checkpointRef,
    reason: params.reason,
    kind: 'guard',
  });
  return true;
}

/**
 * 熵门禁裁决 → guard 挂起（T3-12 接线判据）。
 *
 * 命中 `warn` 且 `GUARD_SUSPEND` 开 ⇒ 登记 `kind='guard'` 的 `schema_entropy` 挂起；否则不登记。
 * 提取为纯入口，使 stream 链调用点（`streamMessageToolSelectionFlow`）保持一行，且决策可单测。
 *
 * @returns 是否**实际登记**
 */
export function guardSuspendFromEntropy(
  sessionId: string,
  chain: SuspendChain,
  verdict: { warn?: boolean } | null
): boolean {
  if (!verdict?.warn) return false;
  return registerGuardSuspend({ sessionId, chain, reason: 'schema_entropy' });
}

/** 继续入口结果码（映射到 HTTP：disabled/not_suspended ⇒ 404；budget_kind ⇒ 409；resume_failed ⇒ 502） */
export type ContinueCode =
  | 'disabled'
  | 'not_suspended'
  | 'budget_kind'
  | 'resume_failed';

/** 继续入口结果 */
export type ContinueOutcome =
  | { ok: true; chain: SuspendChain }
  | { ok: false; code: ContinueCode; message: string };

/**
 * 独立「长程继续」入口（**仅 guard**）：`release` 占位后走既有续跑通道。
 *
 * 语义：
 *  - 开关关 ⇒ `{ ok:false, code:'disabled' }`（零行为变更）；
 *  - 未挂起 ⇒ `not_suspended`；budget 挂起 ⇒ `budget_kind`（拒绝，不成为 relief 旁路）；
 *  - 命中 guard ⇒ 先 `coordinator.release`（幂等占位，防并发重复续跑），再经注入的 `resume`
 *    端口触发**既有**续跑通道（流式链见 `ChatManager._resumeSuspendedStream`；taor 链见
 *    `resumeSuspendedSession(sid,'taor')`）；
 *  - 续跑失败（`resume` 返回 false）⇒ 回滚为挂起（保留 `chain`），返回 `resume_failed`。
 *
 * @param resume 既有续跑通道（由调用方注入 `ChatManager.resumeSuspendedSession`）；
 *   链类型取 {@link ResumableSuspendChain}（**排除** `'tool-job'` —— 作业挂起不走链通道）
 */
export async function continueSuspendedSession(
  coordinator: BudgetSuspendCoordinator,
  resume: (sessionId: string, chain: ResumableSuspendChain) => Promise<boolean>,
  sessionId: string
): Promise<ContinueOutcome> {
  if (!isGuardSuspendEnabled()) {
    return {
      ok: false,
      code: 'disabled',
      message: 'guard suspend/continue 未启用（FEATURE_GUARD_SUSPEND=false）',
    };
  }
  const entry = coordinator.list().find((e) => e.sessionId === sessionId);
  if (!entry) {
    return { ok: false, code: 'not_suspended', message: '会话未处于挂起态' };
  }
  const entryKind = entry.kind ?? 'budget';
  if (entryKind !== 'guard') {
    return {
      ok: false,
      code: 'budget_kind',
      // 按**实际类别**给出可读原因（tool-job 与 budget 的续跑通道**不同**，不得混为一谈）
      message:
        entryKind === 'tool-job'
          ? '该挂起为侧车作业挂起（无人工放行通道）：由作业完成通知自动续跑'
          : '该挂起为日预算挂起，请使用日预算放行（relief）续跑',
    };
  }
  // 无链续跑通道的挂起（`'tool-job'`）**不**经本继续入口（那是**人工放行**通道）：
  // 作业挂起由侧车完成通知**自动续跑**（`query/toolJobSuspend.ts`）。
  // 注：guard 条目链恒为真实执行链 ⇒ 上面的 kind 判据已排除 tool-job ⇒ 此处实为**类型收窄**。
  if (!isResumableChain(entry.chain)) {
    return {
      ok: false,
      code: 'resume_failed',
      message: '该挂起无链续跑通道（作业挂起由完成通知自动续跑）',
    };
  }

  // U-14 阶段 1.3：续跑通道启动**前**恢复该会话的编排内存态（无快照 ⇒ no-op）
  coordinator.restoreSnapshot(sessionId);
  coordinator.release(sessionId);
  let ok = false;
  try {
    ok = await resume(sessionId, entry.chain);
  } catch {
    ok = false;
  }
  if (ok) return { ok: true, chain: entry.chain };

  // 回滚为挂起（保留 chain/reason；`release` 后重新登记 ⇒ suspendedAt 重置为当前，语义可接受）
  coordinator.suspend({
    sessionId,
    chain: entry.chain,
    checkpointRef: entry.checkpointRef,
    reason: entry.reason,
    kind: 'guard',
  });
  return {
    ok: false,
    code: 'resume_failed',
    message: '续跑未能发起，已保留挂起',
  };
}
