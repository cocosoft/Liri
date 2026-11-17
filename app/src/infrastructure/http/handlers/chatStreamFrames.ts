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
 * 客户端流式（`POST /v1/chat/completions`，stream=true）SSE 数据帧的**唯一构造点**
 * （T3，2026-11-17）。
 *
 * 从 `chat-handlers.handleStreamingChat` 的 `switch (chunk.type)` **原样搬出**（零行为变更）：
 * 每类 chunk → 一帧 `data: {json}\n\n`。`done` 不入帧（只收集终态信息，由调用方处理）。
 * 线格式（字段名 / 顺序 / `__pyapp_*` 约定）逐字保持 ⇒ 前端契约不变。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { TOOL_CALL_INITIAL_STATUS } from '@openliri/service/execution';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI';

const logger = getLogger('http:chat');

/** 帧头字段（`id`/`created`/`model` 三条在所有帧上恒在） */
export interface ChatStreamFrameMeta {
  id: string;
  created: number;
  model: string;
}

/**
 * 单条 chunk → SSE 数据帧；无输出（空内容 / 缺失载荷）⇒ `null`。
 *
 * `done` 类型不在此处理（无帧可写），由调用方捕获终态信息。
 */
export function buildStreamChunkFrame(
  chunk: ChatStreamChunk,
  meta: ChatStreamFrameMeta
): string | null {
  switch (chunk.type) {
    case 'text':
      if (!chunk.content) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        ...(chunk.messageId ? { __pyapp_message_id: chunk.messageId } : {}),
        choices: [
          {
            index: 0,
            delta: { content: chunk.content },
            finish_reason: null,
          },
        ],
      })}\n\n`;
    case 'thinking':
    case 'status':
      if (!chunk.content) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: chunk.type,
        ...(chunk.statusType ? { __pyapp_status_type: chunk.statusType } : {}),
        ...(chunk.phase ? { __pyapp_phase: chunk.phase } : {}),
        ...(chunk.toolCallId ? { __pyapp_tool_call_id: chunk.toolCallId } : {}),
        ...(chunk.messageId ? { __pyapp_message_id: chunk.messageId } : {}),
        choices: [
          {
            index: 0,
            delta: { content: chunk.content },
            finish_reason: null,
          },
        ],
      })}\n\n`;
    case 'error':
      if (!chunk.content) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'error',
        __pyapp_error_code: chunk.errorCode || 'UNKNOWN',
        choices: [
          {
            index: 0,
            delta: { content: chunk.content },
            finish_reason: 'error',
          },
        ],
      })}\n\n`;
    case 'tool_call': {
      if (!chunk.toolCall) return null;
      const sseData: Record<string, unknown> = {
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'tool_call',
        __pyapp_tool_status: chunk.toolCall.status || TOOL_CALL_INITIAL_STATUS,
        choices: [
          {
            index: 0,
            delta: {
              content: '',
              tool_calls: [
                {
                  id: chunk.toolCall.id,
                  type: 'function',
                  function: {
                    name: chunk.toolCall.name,
                    arguments: JSON.stringify(chunk.toolCall.arguments),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      // 转发 _meta（如 create_project 的导航建议）
      if (chunk._meta) {
        sseData.__pyapp_meta = chunk._meta;
      }
      return `data: ${JSON.stringify(sseData)}\n\n`;
    }
    case 'question':
      if (!chunk.questionData) return null;
      logger.info('[SSE] Writing question chunk', {
        questionId: chunk.questionData.questionId,
        question: chunk.questionData.question?.slice(0, 40),
        options: chunk.questionData.options?.length,
      });
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'question',
        __pyapp_question: chunk.questionData,
        choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
      })}\n\n`;
    case 'todo':
      if (!chunk.todoData) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'todo',
        __pyapp_todo: chunk.todoData,
        choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
      })}\n\n`;
    // V-22（2026-09-14）：此前该 chunk 在 SSE 写出侧**既无 case 也无 default**
    // ⇒ 交付物被静默丢弃，前端「进入工作模式」入口因此永不可达
    //（消费侧 EventBasedStreamAggregator / deriveConversationBlocks 早已就绪，
    //  缺的只是这一跳的线格式：__pyapp_type + __pyapp_deliverable）
    case 'deliverable':
      if (!chunk.deliverableData) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'deliverable',
        __pyapp_deliverable: chunk.deliverableData,
        choices: [
          {
            index: 0,
            delta: { content: chunk.content || '' },
            finish_reason: null,
          },
        ],
      })}\n\n`;
    // AB-9 修复：ToolLoopRunner 心跳 execution_phase 此前无 SSE 分支被 switch 吞掉，
    // 工具执行进度到不了前端。此处按结构化数据转发（__pyapp_execution_phase）。
    case 'execution_phase':
      if (!chunk.executionPhase) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'execution_phase',
        __pyapp_execution_phase: chunk.executionPhase,
        choices: [
          {
            index: 0,
            delta: { content: chunk.content || '' },
            finish_reason: null,
          },
        ],
      })}\n\n`;
    case 'doc_workflow':
      if (!chunk.docWorkflowData) return null;
      return `data: ${JSON.stringify({
        id: meta.id,
        object: 'chat.completion.chunk',
        created: meta.created,
        model: meta.model,
        __pyapp_type: 'doc_workflow',
        __pyapp_doc_workflow: chunk.docWorkflowData,
        choices: [
          {
            index: 0,
            delta: { content: chunk.content || '' },
            finish_reason: null,
          },
        ],
      })}\n\n`;
    default:
      return null;
  }
}

/** 流式收尾（usage / done 帧）的输入 */
export interface StreamTailArgs {
  /** 帧写出（已含 flush 语义） */
  write: (frame: string) => void;
  meta: ChatStreamFrameMeta;
  finishReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  /** 自动建项目的导航建议（存在 ⇒ 附 `__pyapp_meta`） */
  autoCreatedProjectMeta?: Record<string, unknown> | null;
  /** 主循环终止判定（存在 ⇒ 附 `__pyapp_termination_reason`） */
  terminationReason?: string;
}

/**
 * 写出 usage 帧（有 usage）或 done 帧（无 usage）—— 原样搬出，字段与判定顺序不变。
 */
export function writeStreamTail(args: StreamTailArgs): void {
  const { write, meta, finishReason, usage, terminationReason } = args;
  if (usage) {
    const usageData: Record<string, unknown> = {
      id: meta.id,
      object: 'chat.completion.chunk',
      created: meta.created,
      model: meta.model,
      __pyapp_type: 'usage',
      usage: {
        prompt_tokens: usage.inputTokens,
        completion_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        estimated_cost_usd: usage.estimatedCostUsd,
        cache_read_input_tokens: usage.cacheReadInputTokens,
        cache_creation_input_tokens: usage.cacheCreationInputTokens,
      },
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    };
    if (args.autoCreatedProjectMeta) {
      usageData.__pyapp_meta = args.autoCreatedProjectMeta;
    }
    // 2026-11-03 P1：终止判定（与 `turn/end.terminationReason` 同源）——
    // 前端据此在当轮消息内显示「为什么停下」，不再只存在于事件日志。
    if (terminationReason) {
      usageData.__pyapp_termination_reason = terminationReason;
    }
    write(`data: ${JSON.stringify(usageData)}\n\n`);
    return;
  }
  const doneData: Record<string, unknown> = {
    id: meta.id,
    object: 'chat.completion.chunk',
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
  if (args.autoCreatedProjectMeta) {
    doneData.__pyapp_meta = args.autoCreatedProjectMeta;
  }
  if (terminationReason) {
    doneData.__pyapp_termination_reason = terminationReason;
  }
  write(`data: ${JSON.stringify(doneData)}\n\n`);
}
