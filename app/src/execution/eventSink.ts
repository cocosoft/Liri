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
 * Execution 生命周期**会话事件**发射器（PR5-S3 / 2026-10-09）
 *
 * 与 `modules/workflow/WorkflowRunEvents.ts` / `tasks/goal/GoalEvents.ts` 同法：
 * 本模块（`execution`，service 层）**不持有会话事件日志**——追加器由宿主（`ChatManager`，
 * 其持有 `EventLogStorage`）经 `setExecutionEventSink` 注入，避免反向依赖。
 * **未注入 ⇒ 如实不落**（不伪造），且不阻断主流程。
 *
 * 见 `.trae/specs/durable-execution.md` §3.6。
 */

import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';

const logger = getLogger('execution:eventSink');

/** 事件追加器：与 `ChatManager.appendStreamEvent` 返回结构一致（此处只依赖其子集） */
export type ExecutionEventAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

/** 本模块负责落盘的 execution 事件类型（与 `LiriEventMap` 同源，不另立联合） */
export type ExecutionEventType =
  | 'execution/status_changed'
  | 'execution/recovery';

let sink: ExecutionEventAppender | null = null;

/** 注入事件追加器（由宿主装配时调用一次；传 `null` 解除，测试用） */
export function setExecutionEventSink(
  appender: ExecutionEventAppender | null
): void {
  sink = appender;
}

/**
 * 落一条 execution 事件（**观测面失败只 warn，不回灌执行** —— CS03）。
 *
 * `seq: 0` ⇒ 由追加器在 mutex 内原子分配（既有约定）。
 */
export function emitExecutionEvent<T extends ExecutionEventType>(
  sessionId: string,
  type: T,
  data: LiriEventMap[T]
): void {
  const target = sink;
  if (!target) return;
  void target(sessionId, {
    type,
    schemaVersion: 1,
    seq: 0,
    time: Date.now(),
    sessionId,
    data,
  }).catch((err: unknown) => {
    logger.warn('execution event append failed（观测面失败仅留痕）', {
      type,
      sessionId,
      error: String(err),
    });
  });
}
