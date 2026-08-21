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
import { isValidSessionIdFormat, sendInvalidSessionId } from '../handler-utils';
import { handleEvents } from '../../LocalHTTPServiceSSE';
import {
  handleChatCompletions,
  handleLatestCheckpoint,
  handleQuestionAnswer,
  handleResumeChat,
  handleSessionStreamingStatus,
} from '../chat-handlers';
import {
  handleAddSessionMessage,
  handleClearAllSessions,
  handleCompactSession,
  handleCreateSession,
  handleDeleteSession,
  handleGenerateTitle,
  handleGetCurrentSession,
  handleGetSession,
  handleGetSessionMemory,
  handleGetSessionMessages,
  handleGetSessionEvents,
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
import {
  handleDeleteLatestCheckpoint,
  handleSaveLatestCheckpoint,
} from '../checkpoint-handlers';

/**
 * 提取并校验 URL 中的 sessionId（P0 路径穿越修复）。
 * 合法返回 sessionId；非法已发送 400 并返回 null。
 */
function requireSessionId(
  url: string,
  pattern: RegExp,
  res: http.ServerResponse
): string | null {
  const sid = url.match(pattern)![1];
  if (!isValidSessionIdFormat(sid)) {
    sendInvalidSessionId(res, sid);
    return null;
  }
  return sid;
}

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
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/messages$/, res);
    if (sid === null) return true;
    await handleGetSessionMessages(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/messages$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/messages$/, res);
    if (sid === null) return true;
    await handleAddSessionMessage(handlerCtx, req, res, sid);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/sessions\/(.+)\/messages\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/sessions\/(.+)\/messages\/(.+)$/);
    const sid = requireSessionId(
      url,
      /^\/v1\/sessions\/(.+)\/messages\/(.+)$/,
      res
    );
    if (sid === null) return true;
    await handleDeleteMessage(handlerCtx, req, res, sid, match![2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/sessions\/(.+)\/messages\/truncate$/)
  ) {
    const sid = requireSessionId(
      url,
      /^\/v1\/sessions\/(.+)\/messages\/truncate$/,
      res
    );
    if (sid === null) return true;
    await handleTruncateMessages(handlerCtx, req, res, sid);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/)
  ) {
    const match = url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/);
    const sid = requireSessionId(
      url,
      /^\/api\/session\/(.+)\/message\/(.+)\/blocks$/,
      res
    );
    if (sid === null) return true;
    await handleUpdateMessageBlocks(handlerCtx, req, res, sid, match![2]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/streaming$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/streaming$/, res);
    if (sid === null) return true;
    await handleSessionStreamingStatus(handlerCtx, req, res, sid);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/sessions\/(.+)\/checkpoints\/latest$/)
  ) {
    const sid = requireSessionId(
      url,
      /^\/v1\/sessions\/(.+)\/checkpoints\/latest$/,
      res
    );
    if (sid === null) return true;
    await handleLatestCheckpoint(handlerCtx, req, res, sid);
    return true;
  }
  // P1 修复：abortRecovery 三段链路补全（此前仅 GET，POST/DELETE 均 404）
  if (
    method === 'POST' &&
    url.match(/^\/v1\/sessions\/(.+)\/checkpoints\/latest$/)
  ) {
    const sid = requireSessionId(
      url,
      /^\/v1\/sessions\/(.+)\/checkpoints\/latest$/,
      res
    );
    if (sid === null) return true;
    await handleSaveLatestCheckpoint(handlerCtx, req, res, sid);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/sessions\/(.+)\/checkpoints\/latest$/)
  ) {
    const sid = requireSessionId(
      url,
      /^\/v1\/sessions\/(.+)\/checkpoints\/latest$/,
      res
    );
    if (sid === null) return true;
    await handleDeleteLatestCheckpoint(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/resume$/)) {
    await handleResumeChat(handlerCtx, req, res);
    return true;
  }
  // BUG-4 修复：泛型路由改为 ([^/]+)，避免贪婪吞掉子路径路由
  // （原 (.+) 会让 /v1/sessions/abc/memory 被此处匹配为 sid=abc/memory，随后被
  // 白名单校验拒绝恒 400，导致 :id/memory 功能不可达。改为单段匹配后，
  // 子路径路由（memory 等）可被其后的具体路由正确命中。）
  if (method === 'GET' && url.match(/^\/v1\/sessions\/([^/]+)$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/([^/]+)$/, res);
    if (sid === null) return true;
    await handleGetSession(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/switch$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/switch$/, res);
    if (sid === null) return true;
    await handleSwitchSession(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)$/, res);
    if (sid === null) return true;
    await handleRenameSession(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/title$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/title$/, res);
    if (sid === null) return true;
    await handleGenerateTitle(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/sessions\/(.+)\/meta$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/meta$/, res);
    if (sid === null) return true;
    await handleUpdateSessionMeta(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/compact$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/compact$/, res);
    if (sid === null) return true;
    await handleCompactSession(handlerCtx, req, res, sid);
    return true;
  }
  // P2-22 修复：后端 pruneNow 为全量修剪（无单会话实现），原路由带 :id 造成
  // "修剪指定会话"的误导语义（实际修剪全部）。改为全量路由 /v1/sessions/prune。
  if (method === 'POST' && url.match(/^\/v1\/sessions\/prune$/)) {
    await handlePruneSession(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/memory$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/memory$/, res);
    if (sid === null) return true;
    await handleGetSessionMemory(handlerCtx, req, res, sid);
    return true;
  }
  // M1 事件溯源：获取会话事件流
  // GET /v1/sessions/:id/events?fromSeq=X&toSeq=Y&types=a,b&limit=N
  if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/events$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/events$/, res);
    if (sid === null) return true;
    await handleGetSessionEvents(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/sessions\/(.+)$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)$/, res);
    if (sid === null) return true;
    await handleDeleteSession(handlerCtx, req, res, sid);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/sessions') {
    await handleClearAllSessions(handlerCtx, req, res);
    return true;
  }

  // ---- Steering (Phase 3) ----
  if (method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/steer$/)) {
    const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/steer$/, res);
    if (sid === null) return true;
    await handleSteerSession(req, res, handlerCtx, sid);
    return true;
  }
  return false;
}
