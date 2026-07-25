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
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'infra:http:message-handlers',
  level: LogLevel.INFO,
});

/**
 * 处理删除单条消息请求
 * DELETE /v1/sessions/:sessionId/messages/:messageId
 */
export async function handleDeleteMessage(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
  messageId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const result = await coreAPI.deleteMessage(sessionId, messageId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    // WebSocket 广播给其他 Tab
    ctx.broadcastEvent('messages:deleted', {
      sessionId,
      messageIds: [messageId],
    });
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'delete_message_error',
    });
    if (!res.headersSent) {
      try {
        const statusCode =
          err instanceof Error && (err as any).statusCode
            ? (err as any).statusCode
            : 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message:
                err instanceof Error ? err.message : 'Failed to delete message',
            },
          })
        );
      } catch {
        /* res 可能已结束 */
      }
    }
  }
}

/**
 * 处理截断消息请求（回退）
 * POST /v1/sessions/:sessionId/messages/truncate
 * Body: { beforeMessageId: string }
 */
export async function handleTruncateMessages(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const beforeMessageId = data.beforeMessageId;

    if (!beforeMessageId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Missing beforeMessageId' },
        })
      );
      return;
    }

    const coreAPI = getCoreAPI();
    const result = await coreAPI.truncateMessages(sessionId, beforeMessageId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    // WebSocket 广播给其他 Tab
    ctx.broadcastEvent('messages:deleted', {
      sessionId,
      messageIds: result.deletedMessageIds ?? [],
    });
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'truncate_messages_error',
    });
    if (!res.headersSent) {
      try {
        const statusCode =
          err instanceof Error && (err as any).statusCode
            ? (err as any).statusCode
            : 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message:
                err instanceof Error
                  ? err.message
                  : 'Failed to truncate messages',
            },
          })
        );
      } catch {
        /* res 可能已结束 */
      }
    }
  }
}
