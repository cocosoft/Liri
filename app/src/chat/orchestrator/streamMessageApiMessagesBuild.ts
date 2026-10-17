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
 * P2-1o（U-18 收尾切片，2026-10-17）：`runStreamMessage` 的 **apiMessages 构建段**
 * （构建期切窗 + 心跳 + 总超时 + 发送前历史污染清洗）外移为**内层 async generator**。
 *
 * 为什么是 generator 而不是普通函数：本段在构建等待期间要**逐帧下发 3 个 status chunk**
 * （compacting 心跳 / 超时 error / 构建失败 error）⇒ 只能以 `yield` 表达；调用方用
 * `yield*` 委托，**chunk 顺序与拆分前逐帧等价**（不缓冲、不重排）。
 *
 * 不变量（与 spec `stream-message-flow-split.md` §4 对齐）：
 *  1. 三个 status 必须仍在各自 `throw` **之前**被消费；
 *  2. 本段在 mutex/governor 获取与 `turn/start` **之前** ⇒ 不写任何事件、不触终态；
 *  3. 失败（超时/构建失败）仍以 `throw` 上抛，由外层 `finally` 统一收口；
 *  4. 日志 module 复用 `chat:streamFlow` ⇒ 与拆分前逐字一致。
 */
import { getLogger } from '@modules/monitoring';
import type { Message } from '@modules/session/types/message.js';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import { sleep, sanitizeHistoryPollution } from './streamMessageHelpers.js';

const logger = getLogger('chat:streamFlow');

/** 构建总超时上限（原内联常量，逐字保留） */
const BUILD_TIMEOUT_MS = 120_000;

export interface BuildStreamApiMessagesParams {
  sessionId: string;
  messages: Message[];
  /** 本次请求前是否已触发压缩（仅用于日志） */
  preCompacted: boolean;
  /** 构建期切窗预算（调用方按本轮模型解析一次） */
  maxContextTokens: number;
  maxTokens?: number | undefined;
  buildApiMessages: (
    messages: Message[],
    maxContextTokens?: number,
    outputBudgetTokens?: number
  ) => Promise<Record<string, unknown>[]>;
}

/**
 * 构建本轮 API 消息列表：切窗 + 心跳保活 + 总超时守卫 + 发送前污染清洗。
 *
 * @returns 可直接交给 pipeline 的 apiMessages（**唯一出口变量**）
 */
export async function* buildStreamApiMessages(
  params: BuildStreamApiMessagesParams
): AsyncGenerator<ChatStreamChunk, Array<Record<string, unknown>>, unknown> {
  const { sessionId, messages, preCompacted } = params;
  const buildStart = Date.now();
  let buildHeartbeatCount = 0;
  logger.info('compaction:build_start', {
    sessionId,
    messageCount: messages.length,
    preCompacted,
  });
  const buildPromise = params
    .buildApiMessages(messages, params.maxContextTokens, params.maxTokens)
    // P0-1 修复（2026-08-27）：构建失败不再静默中断——原 buildPromise reject →
    // Promise.race reject → 整条流式在压缩占位块后静默中断（模型未被调用）。
    // 现捕获错误 → 产出可见 error 状态块 → 抛明确错误由上层落盘 error/finishReason。
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({
      ok: false as const,
      value: null as never,
      error: error instanceof Error ? error.message : String(error),
    }));
  // P0-2 修复（2026-08-27）：构建总超时守卫——原 Promise.race 循环仅产生心跳，
  // 构建若挂起会无限循环；超过上限后中止并抛错。
  const buildDeadline = Date.now() + BUILD_TIMEOUT_MS;
  let apiMessages: Array<Record<string, unknown>>;
  while (true) {
    if (Date.now() > buildDeadline) {
      yield {
        type: 'status',
        statusType: 'compaction',
        phase: 'error',
        content: '上下文构建超时，已中止本次回复',
        sessionId,
      } as ChatStreamChunk;
      throw new Error(
        `上下文构建超时（>${BUILD_TIMEOUT_MS / 1000}s），已中止本次回复`
      );
    }
    const settled = await Promise.race([
      buildPromise,
      sleep(10_000).then(() => ({
        ok: false as const,
        value: null as never,
        timedOut: true as const,
      })),
    ]);
    if ('timedOut' in settled) {
      buildHeartbeatCount++;
      yield {
        type: 'status',
        statusType: 'compaction',
        phase: 'compacting',
        content: '正在读取上下文...',
        sessionId,
      } as ChatStreamChunk;
      continue;
    }
    if (settled.ok) {
      apiMessages = settled.value;
      break;
    }
    yield {
      type: 'status',
      statusType: 'compaction',
      phase: 'error',
      content: `上下文构建失败：${settled.error}`,
      sessionId,
    } as ChatStreamChunk;
    throw new Error(`上下文构建失败：${settled.error}`);
  }
  // 2026-08-20 QQ 空响应事故防御：发送前清洗历史污染。
  // P2-1g（2026-10-10）：清洗**变换**复用纯函数 `sanitizeHistoryPollution`；
  // 本处保留**写回与留痕**（动作留在本段，与拆分前逐字一致）。
  const beforeSanitize = apiMessages.length;
  const sanitizeResult = sanitizeHistoryPollution(apiMessages);
  if (sanitizeResult.droppedEmpty > 0 || sanitizeResult.mergedRuns > 0) {
    apiMessages = sanitizeResult.messages;
    logger.warn('compaction:历史污染清洗（发送前防御）', {
      sessionId,
      beforeCount: beforeSanitize,
      afterCount: apiMessages.length,
      droppedEmptyAssistant: sanitizeResult.droppedEmpty,
      mergedConsecutiveAssistant: sanitizeResult.mergedRuns,
      hint: '历史含旧版全量重写 bug 落盘的重复/空 assistant，已清洗防止 LLM 空响应',
    });
  }
  logger.info('compaction:build_done', {
    sessionId,
    elapsedMs: Date.now() - buildStart,
    beforeMessageCount: messages.length,
    apiMessageCount: apiMessages.length,
    heartbeatCount: buildHeartbeatCount,
  });
  return apiMessages;
}
