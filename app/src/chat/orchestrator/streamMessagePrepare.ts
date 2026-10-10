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
 * S1「请求准备」阶段 — `runStreamMessage` 阶段管线第一段（P2-1b）
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-**S1** / §5（逐阶段拆分，**每阶段一 PR**）。
 *
 * 职责（单一）：把原先**散落在 `runStreamMessage` 顶部**的准备语句（`_prepareStreamSession`
 * 调用 · 开始时间 · 首轮消息 id · 轻量检查点构造 · `ctx` 字段解构 · 交互父 span 启动）**外移**
 * 为具名阶段 —— 明确 **输入 `(host, content, options)` → 输出 `PreparedStream`**。
 *
 * 收益：`runStreamMessage` 顶部只保留**一次调用 + 一次解构**（去掉散落构造/解构）；
 * 本模块使 `streamMessageFlow.ts` 行数下降（棘轮 `lint:fn-size` 只允许缩小）。
 *
 * 边界（如实 · CS03）：
 * - **不持有 `mutex`/`governor` 状态**：`mutexHeld`/`governorAdmitted` 须跨 `try`/`finally`
 *   共享**可变**状态 ⇒ 仍在编排函数内声明。
 * - **时序逐字不变**：各语句相对顺序与拆分前一致；唯一位移是"交互父 span 启动"提到
 *   `mutexHeld`/`governorAdmitted` 声明之前（二者仅为纯赋值、无副作用 ⇒ 等价）。
 */

import { getSessionTracing } from '@modules/monitoring';
import { randomIdSuffix } from '../../utils/common';
import { PlainTextCheckpoint } from '../services/PlainTextCheckpoint.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { StreamMessageOptions } from '@modules/session/types/message.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

/** S1 阶段输出（阶段边界值） */
export interface PreparedStream {
  ctx: Awaited<ReturnType<ChatOrchestratorHost['_prepareStreamSession']>>;
  session: ChatSession;
  streamStartedAt: Date;
  assistantMessageId: string;
  plainTextCheckpoint: PlainTextCheckpoint;
  interactionTracing: ReturnType<typeof getSessionTracing>;
}

/**
 * S1 请求准备：会话/切片/controller/检查点 + 首轮 assistant 消息 id + 交互父 span 启动。
 */
export async function prepareStream(
  host: ChatOrchestratorHost,
  content: string,
  options?: StreamMessageOptions
): Promise<PreparedStream> {
  // P2-3.5: 流式消息预处理
  const ctx = await host._prepareStreamSession(content, options);
  const session = ctx.session;
  // 1.6：流式开始时间（落盘 startedAt，导出显示开始时间+耗时）
  const streamStartedAt = new Date();

  // P1-2（2026-08-23）：首轮 assistant 消息 id——优先前端透传（options.assistantMessageId），
  // 缺失时预生成兜底 id（N3/A3）。必须在此处（首个 appendStreamEvent 之前）确定，
  // 保证首轮 text/thinking chunk 事件从第一个 chunk 起就带 messageId，
  // 并在流式结束 createAssistantMessage 时复用同一 id（L1019）。
  const assistantMessageId =
    options?.assistantMessageId ??
    `msg-turn-${Date.now().toString(36)}-${randomIdSuffix(6)}`;

  // P2（08-09）：普通对话轻量检查点（try 外声明，finally 可访问）
  const plainTextCheckpoint = new PlainTextCheckpoint(
    host.checkpointService,
    session.id
  );

  // TR-20 续（2026-09-22）：启用 **`interaction` 父 span** —— 使本轮内的 `llm_request`
  // 嵌套在"一次用户交互"之下（`SessionTracing` 经 AsyncLocalStorage 传递父 span，
  // 见 `SessionTracing.ts:196` 的 `enterWith` 与 `:244` 的 `getStore`）。
  // 此前 `startInteractionSpan` / `endInteractionSpan` 与 `llm_request` 一样**全仓无调用方**。
  //
  // **未验证（诚实边界）**：`AsyncLocalStorage.enterWith` 与 async generator 的组合在
  // `yield` 之后上下文是否持续有效，**未做运行时验证** —— OTel 未启用时 span 为 dummy，
  // 单测无法断言嵌套关系。启用 exporter 后应实测确认 `llm_request` 的父 span 是否为
  // `Liri.interaction`；若未嵌套，则改为在调度层（`ChatManager.streamMessage`）创建。
  const interactionTracing = getSessionTracing();
  // 用**原始用户输入**（`content` 参数），而非 `ctx.content`（`_prepareStreamSession` 处理后的
  // 内容，可能含图片/附件标记与本地路径）—— span 属性会导出到 tracing 后端，不应带路径。
  interactionTracing.startInteractionSpan(content);

  return {
    ctx,
    session,
    streamStartedAt,
    assistantMessageId,
    plainTextCheckpoint,
    interactionTracing,
  };
}
