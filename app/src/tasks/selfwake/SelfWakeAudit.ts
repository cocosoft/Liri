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
 * SelfWakeAudit —— 自唤醒续跑**审计事件的唯一写入实现**（T-⑥12，2026-10-03）
 *
 * 背景：自唤醒（`sleep_for` / `sleep_until` / `wake_on_job` / `wake_on_event` 到点）
 * 会**自动**续跑会话（非用户触发）。修复前该通路的可判定节点**只有 `cg3Log` 日志文本**，
 * 崩溃/重置后"这次自动唤醒到底发生了什么"无法从持久层按序重建 —— 与 `agent/recovery`
 * （B4-1，`chat/yield/YieldRecoveryAudit.ts`）**同一立项理由**，本模块即其对称实现。
 *
 * **通道复用结论（先查后复用，CS01）**：会话级可回放通道是**既有**会话事件日志
 * （`events.jsonl`）——本模块只是其写入方（事件类型 `session/wake`，已按
 * `project_rules.md §1.6` 三处同批登记：`LIRI_EVENT_NAMES` / `LiriEventMap` /
 * `ALL_SESSION_EVENT_TYPES`），**不新造审计通道**，亦不新增 UI（log-only，不入消息 surface）。
 *
 * **注入式装配**（与 `YieldRecoveryAudit.setYieldRecoveryAuditSink` 同法）：本模块位于
 * `tasks/selfwake/`，但追加器由**持有会话事件日志的 `ChatManager`** 注入
 * （`setSelfWakeAuditSink`）⇒ 不在本模块内直接持有存储。未注入（CLI / 单测未装配）
 * ⇒ **如实不落事件**（不伪造、不抛错）；落盘失败只 warn，**不回灌唤醒逻辑**
 * （CS03：观测面失败不得中断续跑）。
 */

import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
import type { WakeKind } from './types';

const logger = getLogger('tasks:selfwake:audit');

/** 本次唤醒走到的节点（与 `session/wake` 载荷的 `outcome` 同源，不另立联合） */
export type SelfWakeAuditOutcome = LiriEventMap['session/wake']['outcome'];

/**
 * 事件追加器：与 `ChatManager.appendStreamEvent` 返回结构一致（此处只依赖其子集）。
 */
export type SelfWakeAuditAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

let auditSink: SelfWakeAuditAppender | null = null;

/** 注入事件追加器（`ChatManager` 构造期调用一次；传 `null` 可解除，测试用） */
export function setSelfWakeAuditSink(sink: SelfWakeAuditAppender | null): void {
  auditSink = sink;
}

/** 当前是否已装配追加器（供测试/巡检判定"能不能落"） */
export function hasSelfWakeAuditSink(): boolean {
  return auditSink !== null;
}

/**
 * 落一条自唤醒续跑审计记录。
 *
 * 顺序语义：调用方在**状态推进之后**逐条 await ⇒ 事件 `seq` 顺序即动作发生的顺序，
 * 读出后可重建轨迹。唤醒是**低频路径**（每次登记一次），故 await 落盘的代价可接受。
 *
 * @param params.sessionId 归属会话（事件信封必填项）
 * @param params.wakeId    唤醒条目 id（`WakeEntry.id`）
 * @param params.kind      唤醒类别（`WakeKind`）
 * @param params.taskId    登记时的任务键（可选）
 * @param params.outcome   本次走到的节点
 * @param params.error     `outcome='resume_failed'` 时的失败原因
 */
export async function recordSelfWake(params: {
  sessionId: string;
  wakeId: string;
  kind: WakeKind;
  taskId?: string;
  outcome: SelfWakeAuditOutcome;
  error?: string;
}): Promise<void> {
  const sink = auditSink;
  // 未装配追加器 ⇒ 如实不落（不伪造），与 `YieldRecoveryAudit` / `GoalEvents` 同口径
  if (!sink) return;

  const data: LiriEventMap['session/wake'] = {
    wakeId: params.wakeId,
    kind: params.kind,
    ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
    outcome: params.outcome,
    ...(params.error !== undefined ? { error: params.error } : {}),
  };

  try {
    const result = await sink(params.sessionId, {
      type: 'session/wake',
      schemaVersion: 1,
      // seq: 0 ⇒ 由 append 在 mutex 内原子分配（既有约定，见 `requestBoundary` 同款注释）
      seq: 0,
      time: Date.now(),
      sessionId: params.sessionId,
      data,
    });
    if (
      !result.ok &&
      result.reason !== 'duplicate-seq' &&
      // TB-14/E1-a：会话已被外部进程删除 ⇒ 主动放弃落盘，非真实写失败
      result.reason !== 'session-dir-missing'
    ) {
      logger.warn('自唤醒审计事件追加失败', {
        sessionId: params.sessionId,
        wakeId: params.wakeId,
        outcome: params.outcome,
        reason: result.reason,
      });
    }
  } catch (err) {
    // @ignore-catch — 审计属观测面，失败不得中断唤醒逻辑（CS03：留 warn 不静默）
    logger.warn('自唤醒审计事件追加异常', {
      sessionId: params.sessionId,
      wakeId: params.wakeId,
      outcome: params.outcome,
      error: String(err),
    });
  }
}
