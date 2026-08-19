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
 * chat-handlers.ts — 聊天相关 HTTP 处理器（从 LocalHTTPService 提取）
 */

import type http from 'http';
import { randomUUID } from 'crypto';
import type { HandlerCtx } from './handler-utils';
import { getLogger } from '@modules/monitoring';
import { handleError, AppError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '@modules/runtime/api/CoreAPI';
import { eventNotificationService } from '@modules/chat/services/EventNotificationService';
import { DEFAULT_MODEL_SENTINEL } from '@modules/constants/common.js';

const logger = getLogger('http:chat');

// ── 模块级辅助函数 ────────────────────────────────────────────────

/** P1-2: 安全 flush — 检查客户端是否已断开，避免 EPIPE 错误和资源浪费 */
function safeFlush(r: http.ServerResponse): void {
  if (r.destroyed || r.writableEnded) return;
  try {
    (r as unknown as { flush: () => void }).flush?.();
  } catch {
    // 客户端已断开，静默忽略
  }
}

// ── 类型定义 ──────────────────────────────────────────────────────

interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  session_id?: string;
  /** 前端写前落盘的用户消息 id（幂等去重用） */
  message_id?: string;
  /** 前端流式消息 id（P0 根治：后端 createAssistantMessage 复用，使 blocks 落盘命中） */
  assistant_message_id?: string;
  workspace_path?: string;
  images?: Array<{ path: string; url: string; filename: string; size: number }>;
  system_prompt?: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  pending_interaction?: unknown;
}

// ── 公共导出 ──────────────────────────────────────────────────────

/**
 * POST /v1/chat/completions — 聊天完成请求（流式/非流式分发）
 */
export async function handleChatCompletions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = await ctx.readRequestBody(req);

  let request: ChatCompletionRequest;
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'Invalid JSON in request body',
          type: 'invalid_request_error',
        },
      })
    );
    return;
  }

  if (
    !request.messages ||
    !Array.isArray(request.messages) ||
    request.messages.length === 0
  ) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'messages field is required and must be a non-empty array',
          type: 'invalid_request_error',
        },
      })
    );
    return;
  }

  // 方案 C 修正（P2-4 会话上下文化）：不再设置全局 SandboxConfigBuilder.defaultWorkspacePath
  // （跨会话/并发污染源）。项目模块会话的工作区路径由 ChatManager 在工具执行上下文注入
  // （仅项目模块），普通对话不受影响，统一回退 process.cwd()。

  if (request.stream) {
    return handleStreamingChat(res, request);
  }
  return handleNormalChat(res, request);
}

// ── 内部处理函数 ──────────────────────────────────────────────────

/**
 * 处理普通（非流式）聊天完成请求
 */
async function handleNormalChat(
  res: http.ServerResponse,
  request: ChatCompletionRequest
): Promise<void> {
  const userMessage = request.messages[request.messages.length - 1];
  if (!userMessage || userMessage.role !== 'user') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'Last message must be from user',
          type: 'invalid_request_error',
        },
      })
    );
    return;
  }

  try {
    const coreAPI = getCoreAPI();
    const chatStartTime = Date.now();
    const chatRequest: ChatRequest = {
      content: userMessage.content,
      stream: false,
      sessionId: request.session_id,
      messageId: request.message_id,
      assistantMessageId: request.assistant_message_id,
      metadata: request.workspace_path
        ? { workspacePath: request.workspace_path }
        : undefined,
      images: request.images,
      model: request.model,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      systemPrompt: request.system_prompt,
    };

    const response = await coreAPI.chat(chatRequest);
    const chatDurationMs = Date.now() - chatStartTime;

    // 检查是否需要用户交互
    if (
      response.finishReason === 'pending_interaction' &&
      response.pendingInteraction
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          id: `chatcmpl-${randomUUID().slice(0, 8)}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: request.model || DEFAULT_MODEL_SENTINEL,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: response.content },
              finish_reason: 'pending_interaction',
            },
          ],
          pending_interaction: response.pendingInteraction,
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })
      );
      return;
    }

    // 仅 LLM 调用真实失败（finishReason=error）才返回 500。
    // 思考型模型（如 deepseek-v4-flash）在 max_tokens 预算被思考耗尽时 content 为空，
    // 或响应仅为 tool_calls 时 content 也为空——此时并非错误，返回 200 空内容避免误报 500。
    if (response.finishReason === 'error') {
      logger.error('Chat 返回错误 finishReason=error', {
        model: request.model || DEFAULT_MODEL_SENTINEL,
        sessionId: request.session_id,
        durationMs: chatDurationMs,
        contentLength: response.content?.length ?? 0,
      });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: 'AI 服务返回错误，请检查 API 密钥和模型配置',
            type: 'server_error',
          },
        })
      );
      return;
    }

    // 排查 J-1.5：content 为空但 finishReason 非 error（思考耗尽/仅 tool_calls）——正常路径，非 500
    if (!response.content) {
      logger.info(
        'Chat 完成但 content 为空（非错误，思考耗尽或仅 tool_calls）',
        {
          model: request.model || DEFAULT_MODEL_SENTINEL,
          sessionId: request.session_id,
          finishReason: response.finishReason || 'stop',
          toolCallCount: response.toolCalls?.length ?? 0,
        }
      );
    }

    logger.info('Chat completed', {
      model: request.model || DEFAULT_MODEL_SENTINEL,
      durationMs: chatDurationMs,
      contentLength: response.content?.length ?? 0,
      sessionId: request.session_id,
      finishReason: response.finishReason || 'stop',
      toolCallCount: response.toolCalls?.length ?? 0,
    });

    const completionResponse: ChatCompletionResponse = {
      id: `chatcmpl-${randomUUID().slice(0, 8)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model || DEFAULT_MODEL_SENTINEL,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: response.content },
          finish_reason: response.finishReason || 'stop',
        },
      ],
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(completionResponse));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'chat_completion' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: {
          message: 'AI 服务返回错误，请检查 API 密钥和模型配置',
          type: 'server_error',
        },
      })
    );
  }
}

/**
 * 处理流式聊天完成请求
 */
async function handleStreamingChat(
  res: http.ServerResponse,
  request: ChatCompletionRequest
): Promise<void> {
  const userMessage = request.messages[request.messages.length - 1];
  if (!userMessage || userMessage.role !== 'user') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'Last message must be from user',
          type: 'invalid_request_error',
        },
      })
    );
    return;
  }

  const otel = getOTelTracing();
  const streamSpan = otel.startSpan('http:chat.stream', {
    'session.id': request.session_id ?? '',
    model: request.model ?? 'default',
  });
  streamSpan.addEvent('sse.connection.established', {
    'session.id': request.session_id ?? '',
    model: request.model ?? 'default',
    hasImages: !!request.images?.length,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked',
  });

  // 禁用响应缓冲，确保 SSE 数据立即发送
  safeFlush(res);

  // 禁用 TCP Nagle 算法，防止小数据包被合并延迟
  if (res.socket) {
    res.socket.setNoDelay(true);
  }

  // P0-fix: SSE 保活心跳，防止 NAT/代理静默断开 TCP 连接（每 15s 发送 SSE 注释行）
  const keepaliveInterval = setInterval(() => {
    try {
      logger.debug('SSE 保活心跳 tick', { sessionId: request.session_id });
      res.write(': heartbeat\n\n');
      // 2026-08-19：心跳写后必须 safeFlush，确保字节真正冲刷到 socket。
      // 否则心跳可能滞留在响应缓冲中，客户端 idle 计时不被重置，
      // 后端等待智谱 GLM 等长 TTFB 期间被前端误判为"流式响应超时"。
      safeFlush(res);
    } catch {
      logger.warn('SSE 心跳写入失败，停止保活');
      clearInterval(keepaliveInterval);
    }
  }, 15000);

  // AB-25 修复：会话 ID 兜底 — request.session_id 可能缺失（旧协议/异常请求），
  // 流 chunk 的 sessionId（ChatManager 实际会话 ID，_sessionAbortControllers 的键）
  // 到达后回填，保证 close 时能按真实会话 ID 中止流，避免互斥锁泄漏
  let activeSessionId = request.session_id;

  // S1: 客户端断开时通知后端中止工具执行 — 补全 close → AbortController 链路
  res.on('close', () => {
    clearInterval(keepaliveInterval);
    streamSpan.addEvent('sse.client.disconnected');
    if (activeSessionId) {
      try {
        getCoreAPI().chatManager?.abortSessionStream(activeSessionId);
      } catch {
        // 静默处理 — coreAPI 可能尚未初始化
      }
    }
  });

  const responseId = `chatcmpl-${randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = request.model || DEFAULT_MODEL_SENTINEL;

  // 发送 role 和状态事件
  res.write(
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        { index: 0, delta: { role: 'assistant' }, finish_reason: null },
      ],
    })}\n\n`
  );
  safeFlush(res);

  res.write(
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      __pyapp_type: 'status',
      __pyapp_status_type: 'ai_thinking',
      choices: [
        {
          index: 0,
          delta: { content: 'AI is thinking...' },
          finish_reason: null,
        },
      ],
    })}\n\n`
  );
  safeFlush(res);

  /** 生图完成事件 → SSE 转发（含结构化 resultData 用于前端渲染） */
  const onToolCompleted = (evt: { type: string; data: unknown }) => {
    const d = evt.data as {
      toolName: string;
      images?: unknown;
      toolCallId?: string;
      resultData?: unknown;
    };
    const rd = d.resultData as { pendingApproval?: boolean } | undefined;
    const isApprovalPending = rd?.pendingApproval === true;
    if (
      d.toolName === 'image_generate' ||
      d.toolName === 'image_display' ||
      d.toolName === 'video_display' ||
      d.toolName === 'audio_play' ||
      // P2-2: 工具审批等待态信号（ask 决策）→ 前端渲染"⏳ 等待审批"
      isApprovalPending
    ) {
      // P1-2: 检查客户端是否断开，避免 EPIPE
      if (res.destroyed || res.writableEnded) return;
      res.write(
        `data: ${JSON.stringify({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          __pyapp_type: 'tool_completed',
          tool_name: d.toolName,
          tool_call_id: d.toolCallId,
          images: d.images,
          result_data: d.resultData,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
      safeFlush(res);
    }
  };

  // P0 增强：监听自动建项目事件
  let autoCreatedProjectMeta: Record<string, unknown> | null = null;
  const onAutoProjectCreated = (data: unknown) => {
    const d = data as Record<string, unknown>;
    if (d?.projectId) {
      autoCreatedProjectMeta = {
        action: 'suggest_navigate',
        target: `/projects?open=${d.projectId}`,
        label: '查看项目',
      };
    }
  };

  try {
    const coreAPI = getCoreAPI();
    const chatRequest: ChatRequest = {
      content: userMessage.content,
      stream: true,
      sessionId: request.session_id,
      messageId: request.message_id,
      assistantMessageId: request.assistant_message_id,
      metadata: request.workspace_path
        ? { workspacePath: request.workspace_path }
        : undefined,
      images: request.images,
      model: request.model,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      systemPrompt: request.system_prompt,
      /** 上下文水位监测 → SSE context_state 事件桥接 */
      onProgress: (event) => {
        if (event.watermarkState) {
          res.write(
            `data: ${JSON.stringify({
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model,
              __pyapp_type: 'context_state',
              choices: [
                {
                  index: 0,
                  delta: { content: event.message },
                  finish_reason: null,
                },
              ],
              watermarkState: event.watermarkState,
            })}\n\n`
          );
          safeFlush(res);
        }
      },
    };

    const generator = coreAPI.chatStream(chatRequest);
    streamSpan.addEvent('sse.generator.start');

    eventNotificationService.on('tool:completed', onToolCompleted);
    eventNotificationService.on('project:auto_created', onAutoProjectCreated);

    let result = await generator.next();
    let streamUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          estimatedCostUsd?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
        }
      | undefined;
    let chunkFinishReason: string | undefined;

    while (!result.done) {
      // P1-2: 客户端断开时立即停止流式输出，避免后续 res.write() 抛出 EPIPE
      if (res.destroyed || res.writableEnded) {
        logger.info('SSE 客户端已断开，停止流式输出', {
          sessionId: request.session_id,
        });
        // P2-10 修复：客户端断开时必须关闭 async generator + 中止底层 LLM 流，
        // 否则 streamMessage 的会话互斥锁（SimpleMutex）永不释放，
        // 后续同一会话请求会 SimpleMutex: acquire timeout after 30000ms。
        try {
          coreAPI.chatManager?.abortSessionStream(activeSessionId ?? '');
        } catch {
          // @ignore-catch — 中止操作本身不应抛出；即使失败也继续关闭生成器
        }
        await Promise.race([
          generator.return(undefined as never),
          new Promise<void>((r) => setTimeout(r, 5000)),
        ]);
        break;
      }
      const chunk = result.value as ChatStreamChunk;
      // AB-25：用流内真实会话 ID 回填（chunk.sessionId 恒为 ChatManager 会话 ID）
      if (chunk.sessionId) activeSessionId = chunk.sessionId;

      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk.content },
                    finish_reason: null,
                  },
                ],
              })}\n\n`
            );
            safeFlush(res);
          }
          break;
        case 'thinking':
        case 'status':
          if (chunk.content) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                __pyapp_type: chunk.type,
                ...(chunk.statusType
                  ? { __pyapp_status_type: chunk.statusType }
                  : {}),
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk.content },
                    finish_reason: null,
                  },
                ],
              })}\n\n`
            );
            safeFlush(res);
          }
          break;
        case 'error':
          if (chunk.content) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                __pyapp_type: 'error',
                __pyapp_error_code: chunk.errorCode || 'UNKNOWN',
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk.content },
                    finish_reason: 'error',
                  },
                ],
              })}\n\n`
            );
            safeFlush(res);
          }
          break;
        case 'tool_call':
          if (chunk.toolCall) {
            const sseData: Record<string, unknown> = {
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model,
              __pyapp_type: 'tool_call',
              __pyapp_tool_status: chunk.toolCall.status || 'running',
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
            res.write(`data: ${JSON.stringify(sseData)}\n\n`);
            safeFlush(res);
          }
          break;
        case 'question':
          if (chunk.questionData) {
            logger.info('[SSE] Writing question chunk', {
              questionId: chunk.questionData.questionId,
              question: chunk.questionData.question?.slice(0, 40),
              options: chunk.questionData.options?.length,
            });
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                __pyapp_type: 'question',
                __pyapp_question: chunk.questionData,
                choices: [
                  { index: 0, delta: { content: '' }, finish_reason: null },
                ],
              })}\n\n`
            );
            safeFlush(res);
          }
          break;
        case 'todo':
          if (chunk.todoData) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                __pyapp_type: 'todo',
                __pyapp_todo: chunk.todoData,
                choices: [
                  { index: 0, delta: { content: '' }, finish_reason: null },
                ],
              })}\n\n`
            );
            safeFlush(res);
          }
          break;
        case 'done':
          // 从 done chunk 捕获实际的 finishReason，替换后续硬编码
          if (chunk.finishReason) {
            chunkFinishReason = chunk.finishReason;
          }
          if (chunk.usage) {
            streamUsage = chunk.usage;
          }
          break;
        case 'execution_phase':
          // AB-9 修复：ToolLoopRunner 心跳 execution_phase 此前无 SSE 分支被 switch 吞掉，
          // 工具执行进度到不了前端。此处按结构化数据转发（__pyapp_execution_phase）。
          if (chunk.executionPhase) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                __pyapp_type: 'execution_phase',
                __pyapp_execution_phase: chunk.executionPhase,
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk.content || '' },
                    finish_reason: null,
                  },
                ],
              })}\n\n`
            );
            safeFlush(res);
          }
          break;
      }

      result = await generator.next();
    }

    // 发送 usage 和 done（使用捕获的 finishReason 而非硬编码 'stop'）
    const finalFinishReason = chunkFinishReason || 'stop';
    if (res.destroyed || res.writableEnded) {
      eventNotificationService.off('tool:completed', onToolCompleted);
      eventNotificationService.off(
        'project:auto_created',
        onAutoProjectCreated
      );
      otel.endSpan(streamSpan, SpanStatusCode.OK, 'client disconnected');
      return;
    }
    if (streamUsage) {
      const usageData: Record<string, unknown> = {
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        __pyapp_type: 'usage',
        usage: {
          prompt_tokens: streamUsage.inputTokens,
          completion_tokens: streamUsage.outputTokens,
          total_tokens: streamUsage.totalTokens,
          estimated_cost_usd: streamUsage.estimatedCostUsd,
          cache_read_input_tokens: streamUsage.cacheReadInputTokens,
          cache_creation_input_tokens: streamUsage.cacheCreationInputTokens,
        },
        choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason }],
      };
      if (autoCreatedProjectMeta) {
        usageData.__pyapp_meta = autoCreatedProjectMeta;
      }
      res.write(`data: ${JSON.stringify(usageData)}\n\n`);
      safeFlush(res);
    } else {
      const doneData: Record<string, unknown> = {
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason }],
      };
      if (autoCreatedProjectMeta) {
        doneData.__pyapp_meta = autoCreatedProjectMeta;
      }
      res.write(`data: ${JSON.stringify(doneData)}\n\n`);
      safeFlush(res);
    }

    res.write('data: [DONE]\n\n');
    safeFlush(res);
    eventNotificationService.off('tool:completed', onToolCompleted);
    eventNotificationService.off('project:auto_created', onAutoProjectCreated);
    logger.info('Stream chat completed', {
      model,
      sessionId: request.session_id,
    });
    streamSpan.addEvent('sse.stream.completed', {
      finishReason: finalFinishReason,
      'usage.inputTokens': streamUsage?.inputTokens ?? 0,
      'usage.outputTokens': streamUsage?.outputTokens ?? 0,
    });
    otel.endSpan(streamSpan, SpanStatusCode.OK);
    res.end();
  } catch (err) {
    eventNotificationService.off('tool:completed', onToolCompleted);
    eventNotificationService.off('project:auto_created', onAutoProjectCreated);
    otel.recordError(
      streamSpan,
      err instanceof Error ? err : new Error(String(err))
    );
    otel.endSpan(streamSpan, SpanStatusCode.ERROR, String(err));
    await handleError(err, {
      module: 'infra:http',
      action: 'chat_stream_request',
    });
    // P1-2: 若客户端已断开，不尝试写入
    if (res.destroyed || res.writableEnded) return;
    res.write(
      `data: ${JSON.stringify({
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        __pyapp_type: 'error',
        __pyapp_error_code:
          err instanceof AppError && err.category
            ? `APP_${err.category.toUpperCase()}`
            : 'UNKNOWN',
        choices: [
          {
            index: 0,
            delta: {
              content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
            finish_reason: 'error',
          },
        ],
      })}\n\n`
    );
    safeFlush(res);
    res.write('data: [DONE]\n\n');
    safeFlush(res);
    res.end();
  }
}

/**
 * GET /v1/sessions/:id/streaming — P1-5 会话流式状态查询
 * 前端幽灵块检测用：30s 无 chunk 时 ping 此端点确认任务是否仍在执行
 */
export async function handleSessionStreamingStatus(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const streaming =
      coreAPI.chatManager?.isSessionStreaming(sessionId) ?? false;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sessionId, streaming }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'session_streaming_status',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * GET /v1/sessions/:id/checkpoints/latest — P2-1 获取最新检查点
 * 断线重连时前端用此端点恢复任务状态
 */
export async function handleLatestCheckpoint(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const checkpoint =
      await coreAPI.chatManager?.getLatestCheckpoint(sessionId);
    if (checkpoint && checkpoint.messages && checkpoint.messages.length > 0) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          sessionId,
          checkpointAvailable: true,
          checkpointId: checkpoint.id,
          messages: checkpoint.messages,
          // P1 修复：回传 metadata（含 abortRecovery 标记），此前缺失导致前端
          // checkAbortRecoveryImpl 读 data.metadata 恒为 undefined，恢复提示永不弹出
          metadata: checkpoint.metadata,
        })
      );
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({ sessionId, checkpointAvailable: false, messages: [] })
      );
    }
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'latest_checkpoint',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * 序列化 resumeStream 的 chunk 为 OpenAI 兼容 SSE 格式（与 handleStreamingChat 对齐）。
 * P1 修复：此前对象 chunk 平铺发送（无 choices[].delta 包装），前端 parseSseChunk
 * 只识别 OpenAI 兼容格式，导致恢复后 thinking/status/tool_call/error 内容全部丢失。
 * @returns JSON 字符串；无法序列化的 chunk 返回 null（调用方跳过）
 */
function serializeResumeChunk(chunk: string | ChatStreamChunk): string | null {
  const base = {
    object: 'chat.completion.chunk',
  };
  if (typeof chunk === 'string') {
    return JSON.stringify({
      ...base,
      __pyapp_type: 'text',
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    });
  }
  const c = chunk as ChatStreamChunk;
  switch (c.type) {
    case 'text':
      if (!c.content) return null;
      return JSON.stringify({
        ...base,
        __pyapp_type: 'text',
        choices: [
          { index: 0, delta: { content: c.content }, finish_reason: null },
        ],
      });
    case 'thinking':
    case 'status':
      if (!c.content) return null;
      return JSON.stringify({
        ...base,
        __pyapp_type: c.type,
        ...(c.statusType ? { __pyapp_status_type: c.statusType } : {}),
        choices: [
          { index: 0, delta: { content: c.content }, finish_reason: null },
        ],
      });
    case 'error':
      return JSON.stringify({
        ...base,
        __pyapp_type: 'error',
        __pyapp_error_code: c.errorCode || 'UNKNOWN',
        choices: [
          {
            index: 0,
            delta: { content: c.content || 'Unknown error' },
            finish_reason: 'error',
          },
        ],
      });
    case 'tool_call':
      if (!c.toolCall) return null;
      return JSON.stringify({
        ...base,
        __pyapp_type: 'tool_call',
        __pyapp_tool_status: c.toolCall.status || 'running',
        ...(c._meta ? { __pyapp_meta: c._meta } : {}),
        choices: [
          {
            index: 0,
            delta: {
              content: '',
              tool_calls: [
                {
                  id: c.toolCall.id,
                  type: 'function',
                  function: {
                    name: c.toolCall.name,
                    arguments: JSON.stringify(c.toolCall.arguments),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    default:
      // resume 场景不产生 question/todo/execution_phase 等决策块，未知类型跳过
      return null;
  }
}

/**
 * POST /v1/sessions/:id/resume — P2-1 从检查点恢复 SSE 流
 * 前端重连时调用，重建 SSE 流从断点继续执行工具循环
 */
export async function handleResumeChat(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = await ctx.readRequestBody(req);
  let request: { session_id?: string; checkpoint_id?: string };
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
    return;
  }

  const sessionId = request.session_id;
  const checkpointId = request.checkpoint_id;
  if (!sessionId || !checkpointId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'session_id and checkpoint_id are required' },
      })
    );
    return;
  }

  // SSE 头（与 handleStreamingChat 一致）
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked',
  });

  res.on('close', () => {
    try {
      getCoreAPI().chatManager?.abortSessionStream(sessionId);
    } catch {
      /* 静默处理 */
    }
  });

  try {
    const coreAPI = getCoreAPI();
    const generator = coreAPI.chatManager!.resumeStream(
      sessionId,
      checkpointId
    );

    let result = await generator.next();
    while (!result.done) {
      if (res.destroyed || res.writableEnded) break;

      // P1 修复：统一 OpenAI 兼容包装（此前对象 chunk 平铺发送，前端解析丢失内容）
      const data = serializeResumeChunk(
        result.value as string | ChatStreamChunk
      );
      if (data !== null) {
        res.write(`data: ${data}\n\n`);
        safeFlush(res);
      }
      result = await generator.next();
    }

    if (!res.destroyed && !res.writableEnded) {
      res.write('data: [DONE]\n\n');
      safeFlush(res);
    }
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'resume_chat' });
    if (!res.destroyed && !res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({ __pyapp_type: 'error', content: '恢复失败' })}\n\n`
      );
      safeFlush(res);
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
}

/**
 * POST /v1/chat/question-answer — 用户回答 AI 提问
 */
export async function handleQuestionAnswer(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { questionId, answers, sessionId } = JSON.parse(body);

    if (!questionId || !answers || !Array.isArray(answers)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'questionId 和 answers 是必填项' }));
      return;
    }

    const coreAPI = getCoreAPI();

    // P0-1: 传 sessionId 精确定位，多会话并行不串扰
    const resolved = coreAPI.resolveInteraction(questionId, answers, sessionId);
    if (resolved) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 未命中（第五十二次清理：非流式 continueInteraction 已删除，统一走流式 promise 恢复）
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: '未找到匹配的待处理交互', resolved: false })
    );
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * GET /v1/settings/data-directory — 获取数据目录信息
 */
export async function handleGetDataDirectory(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { resolvePyappHome, getUserDataDirOverride, setUserDataDirOverride } =
      await import('@modules/core/paths');

    const currentDir = resolvePyappHome();
    const configuredDir = getUserDataDirOverride();
    // P3 简化：configuredDir 即 override 值，原实现重复读取两次；
    // 临时清除 override 读取默认目录（仅内存级，随后恢复），供前端对比"生效目录"与"默认目录"
    if (configuredDir) setUserDataDirOverride(null);
    const defaultDir = resolvePyappHome();
    if (configuredDir) setUserDataDirOverride(configuredDir);

    // 读取环境变量，判断是否有外部覆盖
    const envLiriHome = process.env['LIRI_HOME']?.trim() || null;
    const envLiriDataDir = process.env['LIRI_DATA_DIR']?.trim() || null;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        currentDirectory: currentDir,
        configuredDirectory: configuredDir || null,
        defaultDirectory: defaultDir,
        envLiriHome,
        envLiriDataDir,
      })
    );
  } catch (error) {
    await handleError(error, {
      module: 'infra:handler:chat',
      action: 'get_data_directory',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
  }
}
