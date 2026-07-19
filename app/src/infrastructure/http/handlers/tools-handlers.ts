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

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure:http:handlers:tools-handlers',
  level: LogLevel.INFO,
});

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
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
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
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      } /* res可能已结束, 忽略 */
    }
  }
}
