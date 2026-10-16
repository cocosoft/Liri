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

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { handleError } from '@modules/error';

// ========== Tools Handlers ==========

export async function handleListTools(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const tools = await coreAPI.listTools();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tools));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:tools-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * P1「可解释性」（2026-10-16，方案 `dev_docs/20261016/工具可见性治理方案`）。
 *
 * `GET /v1/tools/visibility?taskType=<t>&extraCategories=<c>&extraCategories=<c2>`
 *
 * 与 `GET /v1/tools` 的区别：后者是**注册表全量**（"装了什么"），本接口是**每轮裁剪后的
 * 可见性解释**（含 `category` / `reasons` / `visibleByDefault`）—— 即"模型这轮为什么看不见它"。
 * **只读**：不改变任何注册/裁剪/执行行为。
 *
 * `extraCategories` 为**可重复**参数；非法类别不在本层校验（本层是 service 层，不引 app 类型），
 * 由 `CoreAPI` 实现侧统一过滤并告警。
 */
export async function handleGetToolVisibility(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // 只取查询串（`dispatchRoute` 传入的 `url` 已剥离 `?…`）—— 不用 `new URL(req.url, base)`：
    // 那会新增一个 `http://internal` 字面量，触发 `lint:consts` 棘轮（同值 host 只减不增）。
    const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const taskType = params.get('taskType') ?? undefined;
    const extraCategories = params.getAll('extraCategories').filter(Boolean);
    const coreAPI = getCoreAPI();
    const report = await coreAPI.getToolVisibilityReport({
      taskType,
      extraCategories,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:tools-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理执行工具请求
 */
export async function handleExecuteTool(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  toolName: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { sessionId, arguments: args } = JSON.parse(body);
    const coreAPI = getCoreAPI();
    const result = await coreAPI.executeTool(sessionId, {
      id: `toolcall-${Date.now()}`,
      name: toolName,
      arguments: args || {},
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:tools-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}
