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
 * S4 事件持久化 — 单一 append 入口 + **单一失败留痕实现**（P2-1c）
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-**S4** / §5（逐阶段拆分，**每阶段一 PR**）。
 *
 * 问题：`runStreamMessage` 内 `host.appendStreamEvent(...)` 有 20+ 处调用，**每处各写一遍**
 * `try/catch` + 失败日志（措辞/级别不一，多数静默）⇒ 失败留痕实现**分散**、口径易漂移。
 *
 * 本模块把「追加 + 失败留痕」收敛为**一个实现**：
 * - **语义不变（CS03）**：事件落盘失败**永不抛错**、**不阻断**主流程（与原各站点的
 *   `catch { // @ignore-catch }` 等价）；
 * - **留痕单一**：失败日志统一格式（`label` + `sessionId` + `reason`），级别由 `onFailure` 指定；
 *   `'silent'` = **保留既有"刻意不记"语义**（不得擅自升级为 `warn` —— 那会改变日志面）。
 *
 * 边界（如实 · 有意不外移的异质站点）：
 * - 追加失败后需**改变控制流**者（如 `turn/start`：失败须保持 `turnStarted === false`）；
 * - 需读**返回结果**并按 `reason` 分支者（如 `metric/timing`）；
 * - 需**向上传播**失败者（如 `emitValidationInjected` 回调）；
 * - 作为**闭包透传**给下游者（如 `startRequest` / `appendOutputGuardAudit` / ReAct 桥接的回调）。
 */

import { getLogger } from '@modules/monitoring';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

const logger = getLogger('chat:streamFlow');

/** 事件对象类型（取自宿主契约，**不本地复制形状**） */
export type StreamEventPayload = Parameters<
  ChatOrchestratorHost['appendStreamEvent']
>[1];

/** 追加结果（宿主契约） */
export type StreamAppendResult = Awaited<
  ReturnType<ChatOrchestratorHost['appendStreamEvent']>
>;

/** 失败留痕级别；`silent` = 保留既有"刻意不记"语义 */
export type EmitFailureTrace = 'warn' | 'debug' | 'silent';

export interface EmitStreamEventOptions {
  /** 统一留痕标签（定位具体事件，如 `system/error` / `assistant/todo`） */
  label: string;
  /** 失败留痕级别（默认 `silent`：与多数既有站点一致——刻意不记） */
  onFailure?: EmitFailureTrace;
}

/**
 * 追加一条流式事件；**永不抛错**（CS03），失败时按 `onFailure` **统一留痕**。
 *
 * @returns 宿主返回的追加结果；若**抛错**则返回 `{ ok: false, reason, tailSeq: 0 }`。
 *   ⚠️ 需要按 `reason` 分支或需要真实 `tailSeq` 的调用点**不得**使用本函数（见头注边界）。
 */
export async function emitStreamEvent(
  host: ChatOrchestratorHost,
  sessionId: string,
  event: StreamEventPayload,
  options: EmitStreamEventOptions
): Promise<StreamAppendResult> {
  try {
    return await host.appendStreamEvent(sessionId, event);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    traceFailure(options, sessionId, reason);
    return { ok: false, reason: `threw:${reason}`, tailSeq: 0 };
  }
}

/**
 * 绑定宿主与会话的**单一 append 入口**（S4 收敛点）。
 *
 * 调用点形如 `await emitEvent({ type: 'assistant/todo', ... })` —— **标签取 `event.type`**，
 * 失败默认 `silent`（保留既有语义）；需要留痕时传第二参 `'warn'` / `'debug'`。
 */
export function makeEventEmitter(
  host: ChatOrchestratorHost,
  sessionId: string
): (
  event: StreamEventPayload,
  onFailure?: EmitFailureTrace
) => Promise<StreamAppendResult> {
  return (event, onFailure = 'silent') =>
    emitStreamEvent(host, sessionId, event, { label: event.type, onFailure });
}

/** **失败留痕唯一实现**（级别 `silent` 时按既有语义不记） */
function traceFailure(
  options: EmitStreamEventOptions,
  sessionId: string,
  reason: string
): void {
  const level = options.onFailure ?? 'silent';
  if (level === 'silent') return;
  const payload = { label: options.label, sessionId, reason };
  if (level === 'debug') {
    logger.debug('streamMessageFlow: 事件落盘失败', payload);
  } else {
    logger.warn('streamMessageFlow: 事件落盘失败', payload);
  }
}
