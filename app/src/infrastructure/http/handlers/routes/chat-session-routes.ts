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
 * chat-session-routes.ts — dispatchChatSessionRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { handleEvents } from '../../LocalHTTPServiceSSE';
import {
  handleChatCompletions,
  handleLatestCheckpoint,
  handleQuestionAnswer,
  handleResumeChat,
  handleSessionStreamingStatus,
} from '../chat-handlers';
import {
  handleClearAllSessions,
  handleCompactSession,
  handleCreateSession,
  handleDeleteSession,
  handleGenerateTitle,
  handleGetCurrentSession,
  handleGetSession,
  handleGetSessionMemory,
  handleGetSessionMessages,
  handleListSessions,
  handlePruneSession,
  handleRenameSession,
  handleSwitchSession,
  handleUpdateMessageBlocks,
  handleUpdateSessionMeta,
} from '../session-handlers';
import {
  handleDeleteMessage,
  handleTruncateMessages,
} from '../message-handlers';
import { handleSteerSession } from '../steer-handlers';

/**
 * dispatchChatSessionRoutes — chat-session-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchChatSessionRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- SSE Event Bus ----
  if (url === '/v1/events') {
    if (req.method === 'GET') {
      await handleEvents(req, res);
      return true;
    }
    // HEAD 用于心跳保活，返回 200 即可
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end();
      return true;
    }
  }

  // ---- Chat ----
  if (method === 'POST' && url === '/v1/chat/completions') {
    await handleChatCompletions(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/chat/question-answer') {
    await handleQuestionAnswer(handlerCtx, req, res);
    return true;
  }

  // ---- Session ----
  if (method === 'GET' && url === '/v1/sessions') {
    await handleListSessions(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/sessions') {
    await handleCreateSession(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/sessions/current') {
    await handleGetCurrentSession(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/messages$/)) {
    await handleGetSessionMessages(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/messages$/)![1]
    );
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/sessions\/(.+)\/messages\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/sessions\/(.+)\/messages\/(.+)$/);
    await handleDeleteMessage(handlerCtx, req, res, match![1], match![2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/sessions\/(.+)\/messages\/truncate$/)
  ) {
    const match = url.match(/^\/v1\/sessions\/(.+)\/messages\/truncate$/);
    await handleTruncateMessages(handlerCtx, req, res, match![1]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/)
  ) {
    const match = url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/);
    await handleUpdateMessageBlocks(handlerCtx, req, res, match![1], match![2]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/streaming$/)) {
    await handleSessionStreamingStatus(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/streaming$/)![1]
    );
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/sessions\/(.+)\/checkpoints\/latest$/)
  ) {
    await handleLatestCheckpoint(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/checkpoints\/latest$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/resume$/)) {
    await handleResumeChat(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    await handleGetSession(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/switch$/)) {
    await handleSwitchSession(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/switch$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    await handleRenameSession(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/title$/)) {
    await handleGenerateTitle(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/title$/)![1]
    );
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/sessions\/(.+)\/meta$/)) {
    await handleUpdateSessionMeta(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/meta$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/compact$/)) {
    await handleCompactSession(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/compact$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/prune$/)) {
    await handlePruneSession(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/prune$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/memory$/)) {
    await handleGetSessionMemory(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)\/memory$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    await handleDeleteSession(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/sessions\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url === '/v1/sessions') {
    await handleClearAllSessions(handlerCtx, req, res);
    return true;
  }

  // ---- Steering (Phase 3) ----
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/steer$/)) {
    const sid = url.match(/^\/v1\/sessions\/(.+)\/steer$/)![1];
    await handleSteerSession(req, res, handlerCtx, sid);
    return true;
  }
  return false;
}
