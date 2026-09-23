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
 * requestBoundary.ts —— 请求边界事件（P2-2「turn × request 双边界」）
 *
 * 规格：`.trae/specs/request-boundary-events.md`（v0.2）。
 *
 * **配对键 = 真请求标识**：`requestId` 就是 `request/start` 事件**被分配到的 `seq`**
 * （写入端 append 后从返回值取，本仓既有约定见 TB-19；`append` 不写回 `event.seq`）。
 * 该 seq 天然唯一、单调、与会话内其它事件不冲突，故**载荷内不带 requestId**，也不引入
 * 第二套 ID 空间。
 *
 * **为什么不复用 `callSeq`**（Spec v0.1 的 D2 已被实测推翻）：
 * `EventLogStorage.append` 在调用方未显式指定时，会把 `data.callSeq` 填成**该事件自身的
 * seq**（`session/storage/EventLogStorage.ts` 的 A1 闭环：供 `tool/result ↔ tool_call`
 * 按 callSeq 配对）⇒ `metric/timing.callSeq` 恒等于自身 seq，**不含"属于哪次请求"的信息**，
 * 拿它配对等于什么都没配。故 D2'：另立 `requestId`，且**严禁改写 callSeq 语义**。
 *
 * 本模块**只做两件事**（生产端唯一的请求边界写入实现，普通请求与 compaction 共用）：
 *   1. `startRequest()`：请求发出**前**落 `request/start`，返回其 seq 作 requestId；
 *   2. `finishRequest()`：请求结束后落**请求级** `metric/timing`，带上同一 requestId
 *      （用量分桶复用 `buildRequestTimingData` 唯一实现；字段**能拿才写**，拿不到缺省）。
 *
 * **拿不到 requestId ⇒ 完成侧不写该字段**（不硬凑）—— 读端据此如实视为"无可配对区间"。
 */

import type { LiriEvent } from '../types/events';
import type { LiriEventMap } from '../types/eventPayloads';
import { buildRequestTimingData, type TimingEventData } from './timingEvent';

/**
 * 事件追加器：与 `ChatManager.appendStreamEvent` 的返回结构一致（此处只依赖其子集）。
 *
 * 之所以用**注入**而非直接持有 EventLogStorage：本模块同时服务
 * `chat/orchestrator/streamMessageFlow`（有 host）与 `context/compaction`
 * （跨模块，只拿得到注入的回调，见 `CompactionOrchestrator.setRequestReporter`）。
 */
export type RequestEventAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

/** 请求开始信息 */
export interface RequestStartInfo {
  /** 所属回合（请求发出时 turn 已分配才传；否则缺省） */
  turn?: number;
  /** 模型标识 */
  model?: string;
  /** 请求来源（缺省视为普通对话请求） */
  reason?: 'chat' | 'compaction';
}

/** 请求结束信息（**能拿才传**，缺省即不写对应字段） */
export interface RequestFinishInfo {
  /** provider 返回的原始 usage（可含嵌套对象，如 `prompt_tokens_details`） */
  usage?: Record<string, unknown> | null;
  /** 请求真实墙钟耗时 ms */
  durationMs?: number;
}

/**
 * 请求发出前落 `request/start`（D4：请求失败也保留 —— 区间语义依赖 start 存在）。
 *
 * @returns 本次请求的 `requestId`（= 该事件的 seq）；写入失败 / 异常 ⇒ `undefined`
 *          （调用方据此**不写**完成侧的 requestId，而不是拿别的数字顶替）
 */
export async function startRequest(
  appender: RequestEventAppender,
  sessionId: string,
  info: RequestStartInfo = {}
): Promise<number | undefined> {
  const data: LiriEventMap['request/start'] = {};
  if (typeof info.turn === 'number' && Number.isFinite(info.turn)) {
    data.turn = info.turn;
  }
  if (typeof info.model === 'string' && info.model) {
    data.model = info.model;
  }
  if (info.reason) {
    data.reason = info.reason;
  }
  try {
    // seq: 0 ⇒ 由 append 在 mutex 内原子分配（P3-7a）；requestId 取其返回值 tailSeq。
    const result = await appender(sessionId, {
      type: 'request/start',
      seq: 0,
      time: Date.now(),
      sessionId,
      data,
    });
    return result.ok ? result.tailSeq : undefined;
  } catch {
    // @ignore-catch — 请求边界是**时序元数据**，不能因写入异常影响请求本身（CS03）
    return undefined;
  }
}

/**
 * 请求结束后落**请求级** `metric/timing`（用量/延迟，字段能拿才写）。
 *
 * 与 `streamMessageFlow` 的**延迟条**（`ttfb`/`ttft`）并列：同一次请求可产多条完成事件
 * （延迟条 + 用量条，各自不同 seq），它们**共享同一 `requestId`** ⇒ 读端归并为一个区间。
 *
 * @returns 追加结果；**无任何真实字段可写** ⇒ `null`（不产空壳事件）
 */
export async function finishRequest(
  appender: RequestEventAppender,
  sessionId: string,
  requestId: number | undefined,
  info: RequestFinishInfo = {}
): Promise<{ ok: boolean; reason?: string; tailSeq: number } | null> {
  const usageBuckets = buildRequestTimingData(info.usage ?? null);
  const durationMs =
    typeof info.durationMs === 'number' &&
    Number.isFinite(info.durationMs) &&
    info.durationMs >= 0
      ? info.durationMs
      : undefined;

  // 用量与耗时**都拿不到** ⇒ 不产事件（不用空壳冒充"完成"）
  if (!usageBuckets && durationMs === undefined) return null;

  const data: TimingEventData = usageBuckets ?? { stage: 'request' };
  if (durationMs !== undefined) data.duration = durationMs;
  if (requestId !== undefined) data.requestId = requestId;

  try {
    return await appender(sessionId, {
      type: 'metric/timing',
      seq: 0,
      time: Date.now(),
      sessionId,
      data,
    });
  } catch {
    // @ignore-catch — 用量/延迟是可观测数据，不是渲染依赖（CS03）
    return null;
  }
}
