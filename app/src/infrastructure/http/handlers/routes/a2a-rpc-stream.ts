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
 * a2a-rpc-stream.ts — A2A v1.0 **SSE 流式**（`SendStreamingMessage` / `SubscribeToTask`）
 *
 * **T4 批次 E 第二拆**：RPC 单入口（`a2a-rpc.ts`）拆出流式后降到 500 行阈值内。
 *
 * **依赖方向**：本文件 → `a2a-rpc.ts`（取 JSON-RPC 帧写出口与共用纯函数）；
 * 反向由 `a2a-rpc.ts` 的**懒加载**（`await import('./a2a-rpc-stream')`）承担
 * ⇒ **无静态环**（同仓既有懒加载断环手法）。
 *
 * 形态（spec §9.4.2）：HTTP 200 + `Content-Type: text/event-stream`；每条 `data:` 是**一个
 * JSON-RPC 响应对象**（`{"jsonrpc":"2.0","id":N,"result":{…StreamResponse…}}`）。
 * 任务型流：**以 `Task` 开始** → 0+ 个 `TaskStatusUpdateEvent` → **任务达终态即关流**
 * （§3.1.2 / §3.1.6）。v1.0 **无 `final` 字段**、**无 `kind`**（按 JSON 成员名判别）。
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { isTerminalState, JsonRpcErrorCode } from '@modules/types/a2a';
import type { A2AStreamResponse, A2ATask } from '@modules/types/a2a';

import { extractTextParts, rpcError, toDeliverables } from './a2a-rpc';
import type { A2APortSlice, A2ARpcDeps } from './a2a-rpc';

/** 一条 SSE 流（写帧 + 终态自动关流） */
interface SseStream {
  /** 写一个 `StreamResponse`；**终态事件后自动关流** */
  send(event: A2AStreamResponse): void;
  /** 主动关流（**幂等**） */
  close(): void;
}

/**
 * 打开 SSE 流并**先订阅、后由调用方发首帧**。
 *
 * "先订阅、后发首帧"的顺序保证 **订阅与首帧之间无 await** ⇒ 不存在漏事件窗口
 * （`SubscribeToTask` 的首帧即调用方刚读到的那份 `Task`）。
 */
function openSseStream(
  res: http.ServerResponse,
  id: unknown,
  port: A2APortSlice,
  taskId: string
): SseStream {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    res.end();
  };

  const write = (event: A2AStreamResponse): void => {
    if (closed) return;
    // 每条 `data:` = 一个 JSON-RPC 响应对象（spec §9.4.2）
    res.write(
      `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: event })}\n\n`
    );
    // §3.1.2 / §3.1.6：任务达终态 ⇒ MUST 关流（v1.0 无 `final` ⇒ 以"终态 + 关流"表达）
    const terminal =
      event.statusUpdate !== undefined &&
      isTerminalState(event.statusUpdate.status.state);
    if (terminal) close();
  };

  unsubscribe = port.subscribeTask(taskId, write);
  return { send: write, close };
}

/**
 * `SendStreamingMessage`（§3.1.2）：发消息并**在同一条流**上推送该任务更新。
 *
 * 与 `SendMessage` 的差别（如实）：流式**不做有界等待**（客户端本就保持连接）⇒ 等到委派结束、
 * 写终态事件后关流。
 */
export async function rpcSendStreamingMessage(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice,
  deps: A2ARpcDeps
): Promise<boolean> {
  if (!deps.hasDelegator()) {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.InternalError,
      'A2A 委派后端未就绪（需装配期注入 A2ADelegator）'
    );
    return true;
  }
  const text = extractTextParts(params);
  if (text === null) {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.InvalidParams,
      'message.parts 至少需一个非空 text part'
    );
    return true;
  }

  const task: A2ATask = port.createTask();
  const stream = openSseStream(res, id, port, task.id);
  stream.send({ task }); // §3.1.2：任务型流以 `Task` 开始

  try {
    const value = await deps.delegate(text, undefined);
    const { artifacts, message: reply } = toDeliverables(value);
    // 状态变更经 `taskStore` 广播 ⇒ 本流写出 `statusUpdate`（终态）⇒ **自动关流**
    port.completeTask(task.id, 'TASK_STATE_COMPLETED', artifacts, reply);
  } catch (error) {
    await handleError(error, {
      module: 'http:a2a',
      action: 'stream-delegate-failed',
      context: { taskId: task.id },
    });
    try {
      port.completeTask(task.id, 'TASK_STATE_FAILED', []);
    } catch (markError) {
      // @ignore-catch — 已是终态（竞态）⇒ 流已/将关，无需再写
      await handleError(markError, {
        module: 'http:a2a',
        action: 'stream-mark-failed',
        context: { taskId: task.id },
      });
    }
  }
  stream.close(); // 幂等：终态已关流时无操作
  return true;
}

/**
 * `SubscribeToTask`（§3.1.6）：订阅**既有**任务的事件流。
 *
 * 首帧 MUST 为**当前** `Task`；对**终态**任务订阅 ⇒ `-32004 UnsupportedOperationError`。
 */
export function rpcSubscribeToTask(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice
): boolean {
  const taskId = typeof params['id'] === 'string' ? params['id'] : '';
  if (!taskId) {
    rpcError(res, id, JsonRpcErrorCode.InvalidParams, 'id 必填');
    return true;
  }
  const task = port.getTask(taskId);
  if (!task) {
    rpcError(res, id, JsonRpcErrorCode.TaskNotFound, `任务不存在：${taskId}`);
    return true;
  }
  if (isTerminalState(task.status.state)) {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.UnsupportedOperation,
      `任务已处于终态（${task.status.state}），不可订阅：${taskId}`
    );
    return true;
  }
  const stream = openSseStream(res, id, port, taskId);
  stream.send({ task }); // 首帧 MUST 为 `Task`（§3.1.6）
  return true;
}
