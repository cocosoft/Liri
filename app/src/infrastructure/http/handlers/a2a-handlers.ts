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
 * A2A HTTP handler（D3）
 *
 * 两条端点（依据《A2A 协议技术手册》§5.1 / §4.4 / §6.2）：
 *   GET  /.well-known/agent-card.json  → Agent Card（含 ETag + Cache-Control + 条件请求）
 *   POST /a2a                          → JSON-RPC 2.0（`message/send` / `tasks/get` / `tasks/cancel`）
 *
 * 鉴权：沿用 `LocalHTTPService` 既有的统一入站鉴权（共享密钥 / Bearer 会话 token），
 * **不新增豁免**（§12.2「每个入站请求强制认证」；卡片只声明 `securitySchemes`，不内嵌凭证）。
 *
 * 委派：`message/send` → `CoreAPI.executeAgentTask()`（同步执行），返回**终态** Task。
 * 本实现刻意不引入后台任务账本（故不适用 R08-001 的跨重启持久化要求）。
 */

import type http from 'http';
import { randomUUID } from 'node:crypto';
import type { HandlerCtx } from './handler-utils';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import {
  AgentRegistry,
  a2aTaskStore,
  buildAgentCard,
  computeAgentCardEtag,
  computeAgentCardVersion,
  A2A_METHOD_ALIASES,
  A2A_METHODS,
  JsonRpcErrorCode,
  type A2AArtifact,
  type A2AMessage,
  type A2ATask,
  type A2ATaskState,
  type JsonRpcFailure,
  type JsonRpcSuccess,
} from '@modules/agent';

const logger = getLogger('infra:http:a2a');

/** Agent Card 端点的缓存时长（秒，§5.4） */
const CARD_MAX_AGE_SECONDS = 300;

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcSuccess(
  id: string | number | null,
  result: unknown
): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function rpcFailure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

/** 端点 URL：由请求 Host 推导（**禁止**硬编码域名/端口） */
function resolveBaseUrl(req: http.IncomingMessage): string {
  const host = req.headers.host ?? '127.0.0.1';
  return `http://${host}/a2a`;
}

/**
 * GET /.well-known/agent-card.json
 */
export async function handleAgentCard(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const definitions = AgentRegistry.getInstance().listAll();
    const card = buildAgentCard(definitions, {
      baseUrl: resolveBaseUrl(req),
      version: computeAgentCardVersion(definitions),
    });
    const etag = computeAgentCardEtag(card);

    // 条件请求（§5.4）：命中则 304，不重复传卡片正文
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }

    writeJson(res, 200, card, {
      ETag: etag,
      'Cache-Control': `public, max-age=${CARD_MAX_AGE_SECONDS}`,
    });
  } catch (err) {
    await handleError(err, { module: 'infra:http:a2a', action: 'agent_card' });
    if (!res.headersSent) {
      writeJson(res, 500, { error: { message: 'Agent Card 生成失败' } });
    }
  }
}

/** 从 `message/send` 的 params 中取出消息与提示词 */
function extractMessage(params: Record<string, unknown>): {
  message: A2AMessage | undefined;
  prompt: string;
  agentId: string | undefined;
  model: string | undefined;
} {
  const message = params.message as A2AMessage | undefined;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const prompt = parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .filter((t) => t.length > 0)
    .join('\n');
  const metaAgentId = message?.metadata?.agentId;
  const agentId =
    typeof metaAgentId === 'string'
      ? metaAgentId
      : typeof params.agentId === 'string'
        ? params.agentId
        : undefined;
  // 模型可由调用方**显式指定**（`metadata.model`）—— 不硬编码模型名（model-usage 规则）
  const metaModel = message?.metadata?.model;
  const model =
    typeof metaModel === 'string'
      ? metaModel
      : typeof params.model === 'string'
        ? params.model
        : undefined;
  return { message, prompt, agentId, model };
}

/** 内部执行状态 → A2A 任务状态（同步委派下只可能是终态） */
function toTaskState(state: unknown): A2ATaskState {
  if (state === 'completed') return 'completed';
  if (state === 'cancelled' || state === 'canceled') return 'canceled';
  return 'failed';
}

/** `message/send`：同步委派给内部 Agent 执行，返回终态 Task */
async function handleSendMessage(
  id: string | number | null,
  params: Record<string, unknown>
): Promise<JsonRpcSuccess | JsonRpcFailure> {
  const { message, prompt, agentId, model } = extractMessage(params);
  if (!prompt.trim()) {
    return rpcFailure(
      id,
      JsonRpcErrorCode.InvalidParams,
      '需要至少一个 text 类型的 Part（§2.3）'
    );
  }

  const task = a2aTaskStore.create(message?.contextId);
  try {
    const result = await getCoreAPI().executeAgentTask({
      description: prompt.slice(0, 120),
      prompt,
      subagentType: agentId,
      model,
    });

    const succeeded = result.state === 'completed';
    if (!succeeded) {
      // §7.4 数据最小化：内部错误细节**只进日志**，不放进对外 artifact
      logger.warn('a2a:委派未完成', {
        taskId: task.id,
        state: String(result.state),
        detail: String(result.content ?? '').slice(0, 200),
      });
    }
    const artifacts: A2AArtifact[] =
      succeeded && result.content
        ? [
            {
              artifactId: `${task.id}-result`,
              name: 'result',
              parts: [{ text: result.content, mediaType: 'text/plain' }],
            },
          ]
        : [];
    const agentMessage: A2AMessage = {
      messageId: randomUUID(),
      role: 'agent',
      parts: artifacts[0]?.parts ?? [
        { text: succeeded ? '' : '委派未完成（详见服务端日志）' },
      ],
      taskId: task.id,
      contextId: task.contextId,
    };

    const finished = a2aTaskStore.complete(
      task.id,
      toTaskState(result.state),
      artifacts,
      agentMessage
    );
    logger.info('a2a:message_send 完成', {
      taskId: finished.id,
      state: finished.status.state,
      internalAgentId: result.agentId,
    });
    return rpcSuccess(id, finished);
  } catch (err) {
    await handleError(err, {
      module: 'infra:http:a2a',
      action: 'message_send',
    });
    // 委派失败也必须有终态（否则客户端会无限轮询）—— 失败原因不外泄内部堆栈
    const failed: A2ATask = a2aTaskStore.complete(task.id, 'failed', [], {
      messageId: randomUUID(),
      role: 'agent',
      parts: [{ text: '委派执行失败' }],
      taskId: task.id,
      contextId: task.contextId,
    });
    return rpcSuccess(id, failed);
  }
}

/**
 * POST /a2a —— JSON-RPC 2.0 入口
 *
 * 错误映射（§6.2）：解析失败 -32700 / 报文非法 -32600 / 方法不存在 -32601 /
 * 参数非法 -32602 / 任务不存在 -32001 / 任务不可取消 -32002 / 内部错误 -32603。
 */
export async function handleA2aRpc(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(await ctx.readRequestBody(req));
  } catch (err) {
    // 报文不是 JSON：HTTP 层给 400（无法确定 id，故 id 为 null）
    logger.warn('a2a:请求体解析失败', { error: String(err) });
    writeJson(
      res,
      400,
      rpcFailure(null, JsonRpcErrorCode.ParseError, 'JSON 解析失败')
    );
    return;
  }

  const envelope = (payload ?? {}) as Record<string, unknown>;
  const id =
    typeof envelope.id === 'string' || typeof envelope.id === 'number'
      ? envelope.id
      : null;
  const method = typeof envelope.method === 'string' ? envelope.method : '';

  if (envelope.jsonrpc !== '2.0' || !method) {
    writeJson(
      res,
      200,
      rpcFailure(
        id,
        JsonRpcErrorCode.InvalidRequest,
        '需要 jsonrpc:"2.0" 与非空 method'
      )
    );
    return;
  }

  const canonical = A2A_METHOD_ALIASES[method];
  if (!canonical) {
    writeJson(
      res,
      200,
      rpcFailure(id, JsonRpcErrorCode.MethodNotFound, `不支持的方法：${method}`)
    );
    return;
  }

  const params = (envelope.params ?? {}) as Record<string, unknown>;

  try {
    if (canonical === A2A_METHODS.SendMessage) {
      writeJson(res, 200, await handleSendMessage(id, params));
      return;
    }

    if (canonical === A2A_METHODS.GetTask) {
      const taskId = typeof params.id === 'string' ? params.id : '';
      const task = taskId ? a2aTaskStore.get(taskId) : undefined;
      writeJson(
        res,
        200,
        task
          ? rpcSuccess(id, task)
          : rpcFailure(
              id,
              JsonRpcErrorCode.TaskNotFound,
              `任务不存在：${taskId}`
            )
      );
      return;
    }

    // CancelTask：同步模型下任务在响应时已终态 → 不可取消
    const taskId = typeof params.id === 'string' ? params.id : '';
    const task = taskId ? a2aTaskStore.get(taskId) : undefined;
    if (!task) {
      writeJson(
        res,
        200,
        rpcFailure(id, JsonRpcErrorCode.TaskNotFound, `任务不存在：${taskId}`)
      );
      return;
    }
    try {
      writeJson(res, 200, rpcSuccess(id, a2aTaskStore.cancel(task.id)));
    } catch (err) {
      writeJson(
        res,
        200,
        rpcFailure(
          id,
          JsonRpcErrorCode.TaskNotCancelable,
          String((err as Error).message)
        )
      );
    }
  } catch (err) {
    await handleError(err, { module: 'infra:http:a2a', action: method });
    writeJson(
      res,
      200,
      rpcFailure(id, JsonRpcErrorCode.InternalError, '内部错误')
    );
  }
}
