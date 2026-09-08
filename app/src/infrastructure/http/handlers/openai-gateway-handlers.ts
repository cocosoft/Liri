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
 * openai-gateway-handlers.ts — OpenAI 兼容网关（内网私有化接入，方案 B-1）
 *
 * 背景：dawate 智能体平台 v3/chat 为私有协议（appKey 换取 + 自定义 headers），
 * TRAE 等第三方工具仅支持 OpenAI 格式，无法直连。本网关把 OpenAI 形态的
 * `/v1/chat/completions` 请求转发到 providerRegistry 中按 model 解析的 Provider
 * （当前即 DawateProvider），透传完整消息历史，并以 OpenAI SSE 格式返回。
 *
 * 与既有 `POST /v1/chat/completions`（chat-handlers）的区别：
 * - 既有端点只取"最后一条 user 消息"并经 ChatManager 全栈（会话/工具/落盘）；
 * - 本网关是**无状态直连**：完整 messages 直传 Provider，不做会话/持久化/工具，
 *   保证 TRAE 多轮 agentic 对话的消息历史不被裁剪。
 *
 * 鉴权：沿用全局 LIRI_API_SECRET（LocalHTTPService.verifyRequestAuth），无需额外 token。
 */

import type http from 'http';
import { randomUUID } from 'crypto';
import type { HandlerCtx } from './handler-utils';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { providerRegistry } from '@modules/ai/providers/ProviderRegistry';
import type { ChatMessage } from '@modules/ai/models/types';
import type { ChatOptions } from '@modules/ai/providers/AIProvider';

const logger = getLogger('http:openai-gateway');

// ── 安全 flush（复制 chat-handlers 的既有模式，防 EPIPE）─────────────────
function safeFlush(r: http.ServerResponse): void {
  if (r.destroyed || r.writableEnded) return;
  try {
    (r as unknown as { flush: () => void }).flush?.();
  } catch {
    // 客户端已断开，静默忽略
  }
}

// ── 请求/响应类型（按 OpenAI wire 格式裁剪，足够转发用）───────────────────
interface OpenAIChatRequest {
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}

interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
}

interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string | null };
    finish_reason: string | null;
  }>;
}

/**
 * OpenAI messages → 透传给 Provider 的 ChatMessage[]。
 * 仅取文本内容；content 数组（多模态）时拼接其中的 text 片段；
 * role=function/tool 等非常规角色丢弃（dawate 仅纯文本对话）。
 */
function mapMessages(messages: OpenAIChatRequest['messages']): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages ?? []) {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = (m.content as Array<{ type?: string; text?: string }>)
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('\n');
    }
    if (!text.trim()) continue;
    const role =
      m.role === 'user' || m.role === 'assistant' || m.role === 'system'
        ? m.role
        : 'user';
    out.push({ role, content: text });
  }
  return out;
}

function sendJsonError(
  res: http.ServerResponse,
  status: number,
  message: string,
  type = 'invalid_request_error'
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      error: { message, type },
    })
  );
}

/**
 * POST /v1/openai/chat/completions — OpenAI 兼容网关（流式/非流式）
 */
export async function handleOpenAIGatewayChatCompletions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = await ctx.readRequestBody(req);

  let request: OpenAIChatRequest;
  try {
    request = JSON.parse(body);
  } catch {
    sendJsonError(res, 400, 'Invalid JSON in request body');
    return;
  }

  const model = typeof request.model === 'string' ? request.model.trim() : '';
  if (!model) {
    sendJsonError(
      res,
      400,
      'model is required（请填写大瓦特 Agent 的模型 ID，如 246676332）'
    );
    return;
  }
  const messages = mapMessages(request.messages);
  if (messages.length === 0) {
    sendJsonError(
      res,
      400,
      'messages must be a non-empty array of text messages'
    );
    return;
  }

  const provider = providerRegistry.getByModel(model);
  if (!provider) {
    logger.warn('OpenAI 网关：未找到模型对应 Provider', { model });
    sendJsonError(res, 400, `Unknown model: ${model}`);
    return;
  }

  // 客户端断开时中止底层 LLM 请求，避免流悬挂/泄漏
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  const chatOptions: ChatOptions = {
    model,
    signal: controller.signal,
    maxTokens: request.max_tokens,
    temperature: request.temperature,
    top_p: request.top_p,
  };
  const now = () => Math.floor(Date.now() / 1000);
  const completionId = `chatcmpl-${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();

  try {
    if (request.stream) {
      // ── 流式：逐 text 增量 → OpenAI chunk，[DONE] 收尾 ──
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Transfer-Encoding': 'chunked',
      });
      let fullContent = '';
      try {
        for await (const chunk of provider.chatStream(messages, chatOptions)) {
          if (res.destroyed || res.writableEnded) break;
          if (typeof chunk !== 'string' || !chunk) continue; // 忽略 thinking 等非文本增量
          fullContent += chunk;
          const payload: OpenAIChatCompletionChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: now(),
            model,
            choices: [
              { index: 0, delta: { content: chunk }, finish_reason: null },
            ],
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          safeFlush(res);
        }
        if (res.destroyed || res.writableEnded) return;
        const doneChunk: OpenAIChatCompletionChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created: now(),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        safeFlush(res);
        res.end();
        logger.info('OpenAI 网关流式完成', {
          model,
          durationMs: Date.now() - startedAt,
          contentLength: fullContent.length,
        });
      } catch (err) {
        await handleError(err, {
          module: 'http:openai-gateway',
          action: 'chat_completions_stream',
          context: { model },
        });
        if (res.destroyed || res.writableEnded) return;
        res.write(
          `data: ${JSON.stringify({
            error: {
              message: 'AI 服务返回错误，请检查后端日志',
              type: 'server_error',
            },
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        safeFlush(res);
        res.end();
      }
    } else {
      // ── 非流式：汇聚为 chat.completion ──
      const response = await provider.chat(messages, chatOptions);
      const content = response.content ?? '';
      const finishReason =
        response.stop_reason === 'max_tokens' ? 'length' : 'stop';
      const completion: OpenAIChatCompletion = {
        id: completionId,
        object: 'chat.completion',
        created: now(),
        model: response.model || model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: finishReason,
          },
        ],
      };
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(completion));
      logger.info('OpenAI 网关完成', {
        model,
        durationMs: Date.now() - startedAt,
        contentLength: content.length,
      });
    }
  } catch (err) {
    await handleError(err, {
      module: 'http:openai-gateway',
      action: 'chat_completions',
      context: { model, stream: request.stream === true },
    });
    if (res.destroyed || res.writableEnded) return;
    sendJsonError(
      res,
      500,
      'AI 服务返回错误，请检查 API 密钥和模型配置',
      'server_error'
    );
  } finally {
    res.off('close', onClose);
  }
}
