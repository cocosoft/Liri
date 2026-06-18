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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { createChatManager } from '@modules/chat/ChatManager';
import { handleError } from '@modules/error/handleError';

// ========== Checkpoint Handlers ==========

export async function handleCreateCheckpoint(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { sessionId, label } = JSON.parse(body);
    const chatManager = createChatManager();
    const cpId = await chatManager.createCheckpoint(sessionId, label);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: cpId, sessionId, label }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 列出检查点 GET /v1/checkpoints?sessionId=...
 */
export async function handleListCheckpoints(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = urlObj.searchParams.get('sessionId') || '';
    const chatManager = createChatManager();
    const checkpoints = await chatManager.listCheckpoints(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(checkpoints));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 获取检查点详情 GET /v1/checkpoints/:id
 */
export async function handleGetCheckpoint(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cpId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    const allCheckpoints = await chatManager.listCheckpoints('');
    let checkpoint = allCheckpoints.find((cp) => cp.id === cpId);
    if (!checkpoint) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cp = await (chatManager as any).getCheckpoint?.(cpId);
      if (cp) checkpoint = cp;
    }
    if (!checkpoint) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Checkpoint not found' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(checkpoint));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 回滚到检查点 POST /v1/checkpoints/:id/rollback
 */
export async function handleRollbackCheckpoint(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cpId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    await chatManager.rollbackToCheckpoint(cpId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, checkpointId: cpId }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 删除检查点 DELETE /v1/checkpoints/:id
 */
export async function handleDeleteCheckpoint(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cpId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    await chatManager.deleteCheckpoint(cpId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, checkpointId: cpId }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}
