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

import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '@modules/runtime/api/CoreAPI';

const logger = new Logger({ level: LogLevel.INFO });

// ── 类型定义 ──────────────────────────────────────────────────────

interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  session_id?: string;
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

interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
  __pyapp_type?: string;
  __pyapp_tool_status?: string;
  __pyapp_question?: unknown;
  __pyapp_todo?: unknown;
  usage?: Record<string, unknown>;
}

// ── 公共导出 ──────────────────────────────────────────────────────

/**
 * POST /v1/chat/completions — 聊天完成请求（流式/非流式分发）
 */
export async function handleChatCompletions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await ctx.readRequestBody(req);

  let request: ChatCompletionRequest;
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'Invalid JSON in request body', type: 'invalid_request_error' },
    }));
    return;
  }

  if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'messages field is required and must be a non-empty array', type: 'invalid_request_error' },
    }));
    return;
  }

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
  request: ChatCompletionRequest,
): Promise<void> {
  const userMessage = request.messages[request.messages.length - 1];
  if (!userMessage || userMessage.role !== 'user') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'Last message must be from user', type: 'invalid_request_error' },
    }));
    return;
  }

  try {
    const coreAPI = getCoreAPI();
    const chatStartTime = Date.now();
    const chatRequest: ChatRequest = {
      content: userMessage.content,
      stream: false,
      sessionId: request.session_id,
    };

    const response = await coreAPI.chat(chatRequest);
    const chatDurationMs = Date.now() - chatStartTime;

    // 检查是否需要用户交互
    if (response.finishReason === 'pending_interaction' && response.pendingInteraction) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        id: `chatcmpl-${randomUUID().slice(0, 8)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model || 'pyapp-default',
        choices: [
          { index: 0, message: { role: 'assistant', content: null }, finish_reason: 'pending_interaction' },
        ],
        pending_interaction: response.pendingInteraction,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
      return;
    }

    if (response.finishReason === 'error' || !response.content) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: { message: 'AI 服务返回错误，请检查 API 密钥和模型配置', type: 'server_error' },
      }));
      return;
    }

    logger.info('Chat completed', {
      model: request.model || 'pyapp-default',
      durationMs: chatDurationMs,
      contentLength: response.content?.length ?? 0,
      sessionId: request.session_id,
    });

    const completionResponse: ChatCompletionResponse = {
      id: `chatcmpl-${randomUUID().slice(0, 8)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model || 'pyapp-default',
      choices: [
        { index: 0, message: { role: 'assistant', content: response.content }, finish_reason: response.finishReason || 'stop' },
      ],
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(completionResponse));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'chat_completion' });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: { message: 'AI 服务返回错误，请检查 API 密钥和模型配置', type: 'server_error' },
    }));
  }
}

/**
 * 处理流式聊天完成请求
 */
async function handleStreamingChat(
  res: http.ServerResponse,
  request: ChatCompletionRequest,
): Promise<void> {
  const userMessage = request.messages[request.messages.length - 1];
  if (!userMessage || userMessage.role !== 'user') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'Last message must be from user', type: 'invalid_request_error' },
    }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const responseId = `chatcmpl-${randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = request.model || 'pyapp-default';

  // 发送 role 和状态事件
  res.write(`data: ${JSON.stringify({
    id: responseId, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  })}\n\n`);

  res.write(`data: ${JSON.stringify({
    id: responseId, object: 'chat.completion.chunk', created, model,
    __pyapp_type: 'status',
    choices: [{ index: 0, delta: { content: 'AI is thinking...' }, finish_reason: null }],
  })}\n\n`);

  try {
    const coreAPI = getCoreAPI();
    const chatRequest: ChatRequest = {
      content: userMessage.content,
      stream: true,
      sessionId: request.session_id,
    };

    const generator = coreAPI.chatStream(chatRequest);
    let result = await generator.next();
    let streamUsage: {
      inputTokens: number; outputTokens: number; totalTokens: number;
      estimatedCostUsd?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number;
    } | undefined;

    while (!result.done) {
      const chunk = result.value as ChatStreamChunk;

      switch (chunk.type) {
        case 'done':
          if (chunk.usage) streamUsage = chunk.usage;
          break;
        case 'text':
          if (chunk.content) {
            res.write(`data: ${JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null }],
            })}\n\n`);
          }
          break;
        case 'thinking':
        case 'status':
          if (chunk.content) {
            res.write(`data: ${JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model,
              __pyapp_type: chunk.type,
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null }],
            })}\n\n`);
          }
          break;
        case 'error':
          if (chunk.content) {
            res.write(`data: ${JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model,
              __pyapp_type: 'error',
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: 'error' }],
            })}\n\n`);
          }
          break;
        case 'tool_call':
          if (chunk.toolCall) {
            res.write(`data: ${JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model,
              __pyapp_type: 'tool_call',
              __pyapp_tool_status: chunk.toolCall.status || 'running',
              choices: [{
                index: 0,
                delta: {
                  content: '',
                  tool_calls: [{
                    id: chunk.toolCall.id, type: 'function',
                    function: { name: chunk.toolCall.name, arguments: JSON.stringify(chunk.toolCall.arguments) },
                  }],
                },
                finish_reason: null,
              }],
            })}\n\n`);
          }
          break;
        case 'question':
          if (chunk.questionData) {
            res.write(`data: ${JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model,
              __pyapp_type: 'question', __pyapp_question: chunk.questionData,
              choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
            })}\n\n`);
          }
          break;
        case 'todo':
          if (chunk.todoData) {
            res.write(`data: ${JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model,
              __pyapp_type: 'todo', __pyapp_todo: chunk.todoData,
              choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
            })}\n\n`);
          }
          break;
      }

      result = await generator.next();
    }

    // 发送 usage 和 done
    if (streamUsage) {
      res.write(`data: ${JSON.stringify({
        id: responseId, object: 'chat.completion.chunk', created, model,
        __pyapp_type: 'usage',
        usage: {
          prompt_tokens: streamUsage.inputTokens,
          completion_tokens: streamUsage.outputTokens,
          total_tokens: streamUsage.totalTokens,
          estimated_cost_usd: streamUsage.estimatedCostUsd,
          cache_read_input_tokens: streamUsage.cacheReadInputTokens,
          cache_creation_input_tokens: streamUsage.cacheCreationInputTokens,
        },
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({
        id: responseId, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    logger.info('Stream chat completed', { model, sessionId: request.session_id });
    res.end();
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'chat_stream_request' });
    res.write(`data: ${JSON.stringify({
      id: responseId, object: 'chat.completion.chunk', created, model,
      choices: [{
        index: 0,
        delta: { content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` },
        finish_reason: 'error',
      }],
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * POST /v1/chat/question-answer — 用户回答 AI 提问
 */
export async function handleQuestionAnswer(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
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

    // 先尝试流式路径的交互解析
    const resolved = coreAPI.resolveInteraction(questionId, answers);
    if (resolved) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 流式路径未命中，尝试非流式路径
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '非流式交互需要 sessionId' }));
      return;
    }

    const pendingData = coreAPI.getPendingInteraction(sessionId);
    if (!pendingData || pendingData.questionId !== questionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未找到匹配的待处理交互', resolved: false }));
      return;
    }

    // 恢复非流式路径的工具循环
    const chatResponse = await coreAPI.continueInteraction(sessionId, questionId, answers);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      content: chatResponse.content || '',
      finish_reason: chatResponse.finishReason || 'stop',
      sessionId,
    }));
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
  res: http.ServerResponse,
): Promise<void> {
  try {
    const {
      resolvePyappHome,
      getUserDataDirOverride,
      setUserDataDirOverride,
    } = await import('@modules/core/paths');

    const currentDir = resolvePyappHome();
    const configuredDir = getUserDataDirOverride();
    const savedOverride = getUserDataDirOverride();
    if (savedOverride) setUserDataDirOverride(null);
    const defaultDir = resolvePyappHome();
    if (savedOverride) setUserDataDirOverride(savedOverride);

    // 读取环境变量，判断是否有外部覆盖
    const envLiriHome = process.env['LIRI_HOME']?.trim() || null;
    const envLiriDataDir = process.env['LIRI_DATA_DIR']?.trim() || null;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      currentDirectory: currentDir,
      configuredDirectory: configuredDir || null,
      defaultDirectory: defaultDir,
      envLiriHome,
      envLiriDataDir,
    }));
  } catch (error) {
    // 使用 Logger 记录错误
    logger.error('获取数据目录失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
  }
}