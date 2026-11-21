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
 * 消息链路追踪的类型（叶子模块，2026-11-21）
 *
 * 独立成文件的原因：`MessageTraceBuffer`（内存环形缓冲）与 `MessageTraceStore`（持久化）
 * 都要用这组类型，而缓冲在 `finish` 时调用存储 ⇒ 若类型留在 Buffer 里，
 * `Buffer → Store → Buffer` 会形成 madge 可见的环（`import type` 也计数，CI 棘轮为 0）。
 * 类型下沉到本文件后两条边都指向叶子，环消失。
 */

/** 链路阶段状态 */
export type TraceStageStatus = 'ok' | 'fail' | 'skip';

/** 单个链路阶段记录 */
export interface MessageTraceStage {
  /** 阶段名（frame_check / dedup / rate_limit / session / llm / outbound） */
  name: string;
  status: TraceStageStatus;
  /** 阶段发生时间戳 */
  atMs: number;
  /** 阶段耗时（毫秒），瞬时阶段可缺省 */
  durationMs?: number;
  /** 附加信息（拒绝原因、目标、内容长度等） */
  detail?: string;
}

/** 消息整体状态 */
export type MessageTraceStatus = 'inflight' | 'ok' | 'fail' | 'rejected';

/** 单条消息的全链路追踪记录 */
export interface MessageTrace {
  traceId: string;
  channelName: string;
  messageId: string;
  sessionId?: string;
  senderId?: string;
  /** 内容预览（前 50 字符，仅用于人工识别消息） */
  contentPreview: string;
  startedAtMs: number;
  finishedAtMs?: number;
  /** 入站→终态总耗时（毫秒） */
  totalMs?: number;
  status: MessageTraceStatus;
  /** 终态错误信息（fail/rejected 时） */
  error?: string;
  stages: MessageTraceStage[];
}

/** 可持久化的终态（`inflight` 不落盘：半成品行会污染历史） */
export type FinishedMessageTrace = Omit<MessageTrace, 'status'> & {
  status: Extract<MessageTraceStatus, 'ok' | 'fail' | 'rejected'>;
};

/** 链路增量事件种类（入站监视 G4：SSE 与订阅共用） */
export type MessageTraceEventKind = 'begin' | 'stage' | 'finish';

/**
 * 链路增量事件。
 *
 * ⚠️ **隐私边界**：`trace.contentPreview` 恒为**空串** —— 事件会经 SSE 推到前端，
 * 只允许携带链路元数据（阶段/状态/耗时），不携带消息正文。
 */
export interface MessageTraceEvent {
  kind: MessageTraceEventKind;
  trace: MessageTrace;
}
