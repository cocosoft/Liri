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
 * Checkpoint HTTP handlers — Phase 4
 *
 * 暴露 Checkpoint 查询和恢复的 HTTP 端点。
 * 由 TAORLoop 的 FileCheckpointStorage 提供底层支持。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { TAORLoop } from '../../../query/TAORLoop.js';
import type { HandlerCtx } from './handler-utils';
import { createChatManager } from '@modules/chat';

/** 活跃的 TAORLoop 实例注册表（由 ChatManager 和 PDCA 注册） */
const activeLoops = new Map<string, TAORLoop>();

/**
 * 注册 TAORLoop 实例
 */
export function registerTAORLoop(sessionId: string, loop: TAORLoop): void {
  activeLoops.set(sessionId, loop);
}

/**
 * 注销 TAORLoop 实例
 */
export function unregisterTAORLoop(sessionId: string): void {
  activeLoops.delete(sessionId);
}

/** JSON 响应辅助 */
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** 解析 URL 路径参数 */
function parsePathParams(
  url: string,
  pattern: string
): Record<string, string> | null {
  // P3 修复：先剥离 query string（/v1/checkpoints?x=1 → /v1/checkpoints），
  // 原实现把带 ? 的尾段当作路径参数导致 400
  const path = url.split('?')[0];
  const urlParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (urlParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (urlParts[i] !== patternParts[i]) {
      return null;
    }
  }
  return params;
}

/**
 * GET /v1/sessions/:id/checkpoints
 * 获取会话的所有检查点
 */
export async function handleListCheckpoints(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const params = parsePathParams(req.url ?? '', 'v1/sessions/:id/checkpoints');
  if (!params) {
    sendJson(res, { error: 'Invalid path' }, 400);
    return;
  }

  try {
    const loop = activeLoops.get(params.id);
    if (!loop) {
      sendJson(res, { checkpoints: [] });
      return;
    }

    const checkpoints = await loop.getCheckpointsForSession();
    sendJson(res, { checkpoints: checkpoints ?? [] });
  } catch (e) {
    sendJson(res, { error: String(e) }, 500);
  }
}

/**
 * POST /v1/sessions/:id/checkpoints/:checkpointId/resume
 * 从检查点恢复
 */
export async function handleResumeCheckpoint(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const params = parsePathParams(
    req.url ?? '',
    'v1/sessions/:id/checkpoints/:checkpointId/resume'
  );
  if (!params) {
    sendJson(res, { error: 'Invalid path' }, 400);
    return;
  }

  try {
    const loop = activeLoops.get(params.id);
    if (!loop) {
      sendJson(res, { error: 'Session not found' }, 404);
      return;
    }

    const success = await loop.resumeFromCheckpoint(params.checkpointId);
    sendJson(res, { resumed: success, checkpointId: params.checkpointId });
  } catch (e) {
    sendJson(res, { error: String(e) }, 500);
  }
}

// ─── PDCA Checkpoint 端点（Phase 4）────────────────────

/**
 * GET /v1/pdca/:taskId/checkpoints
 * 获取 PDCA 任务的所有检查点
 */
export async function handlePdcaListCheckpoints(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const params = parsePathParams(req.url ?? '', 'v1/pdca/:taskId/checkpoints');
  if (!params) {
    sendJson(res, { error: 'Invalid path' }, 400);
    return;
  }

  try {
    const loop = activeLoops.get(params.taskId);
    if (!loop) {
      sendJson(res, { checkpoints: [] });
      return;
    }

    const checkpoints = await loop.getCheckpointsForSession();
    sendJson(res, { checkpoints: checkpoints ?? [] });
  } catch (e) {
    sendJson(res, { error: String(e) }, 500);
  }
}

/**
 * POST /v1/pdca/:taskId/checkpoints/:checkpointId/resume
 * 从检查点恢复 PDCA 任务
 */
export async function handlePdcaResumeCheckpoint(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const params = parsePathParams(
    req.url ?? '',
    'v1/pdca/:taskId/checkpoints/:checkpointId/resume'
  );
  if (!params) {
    sendJson(res, { error: 'Invalid path' }, 400);
    return;
  }

  try {
    const loop = activeLoops.get(params.taskId);
    if (!loop) {
      sendJson(res, { error: 'PDCA task not found' }, 404);
      return;
    }

    const success = await loop.resumeFromCheckpoint(params.checkpointId);
    sendJson(res, { resumed: success, checkpointId: params.checkpointId });
  } catch (e) {
    sendJson(res, { error: String(e) }, 500);
  }
}

// ─── ChatManager Checkpoint 端点（从 LocalHTTPService.ts 迁移）─────

/**
 * 创建检查点 POST /v1/checkpoints
 * { sessionId, label }
 */
export async function handleCreateCheckpoint(
  ctx: HandlerCtx,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { sessionId, label } = JSON.parse(body);
    const chatManager = createChatManager();
    const cpId = await chatManager.createCheckpoint(sessionId, label);
    sendJson(res, { id: cpId, sessionId, label });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 获取检查点详情 GET /v1/checkpoints/:id
 */
export async function handleGetCheckpoint(
  ctx: HandlerCtx,
  req: IncomingMessage,
  res: ServerResponse,
  cpId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    const allCheckpoints = await chatManager.listCheckpoints('');
    let checkpoint: unknown = allCheckpoints.find((cp) => cp.id === cpId);
    if (!checkpoint) {
      const cp = await (
        chatManager as unknown as {
          getCheckpoint?: (id: string) => Promise<unknown>;
        }
      ).getCheckpoint?.(cpId);
      if (cp) checkpoint = cp;
    }
    if (!checkpoint) {
      sendJson(res, { error: { message: 'Checkpoint not found' } }, 404);
      return;
    }
    sendJson(res, checkpoint);
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 回滚到检查点 POST /v1/checkpoints/:id/rollback
 */
export async function handleRollbackCheckpoint(
  ctx: HandlerCtx,
  req: IncomingMessage,
  res: ServerResponse,
  cpId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    await chatManager.rollbackToCheckpoint(cpId);
    sendJson(res, { success: true, checkpointId: cpId });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 删除检查点 DELETE /v1/checkpoints/:id
 */
export async function handleDeleteCheckpoint(
  ctx: HandlerCtx,
  req: IncomingMessage,
  res: ServerResponse,
  cpId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    await chatManager.deleteCheckpoint(cpId);
    sendJson(res, { success: true, checkpointId: cpId });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 保存最新检查点 POST /v1/sessions/:id/checkpoints/latest
 * P1 修复：前端 stopMessage 中止任务时调用，保存带 abortRecovery 标记的检查点。
 * 此前仅 GET 路由存在，POST 直接 404，abortRecovery 链路第一节即断。
 * Body: { label?, autoCreated?, metadata? }
 */
export async function handleSaveLatestCheckpoint(
  ctx: HandlerCtx,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const parsed = JSON.parse(body) as {
      label?: string;
      autoCreated?: boolean;
      metadata?: Record<string, unknown>;
    };
    const chatManager = createChatManager();
    const cpId = await chatManager.createCheckpoint(
      sessionId,
      parsed.label ?? `abort_${Date.now()}`,
      parsed.metadata
    );
    sendJson(res, { success: true, checkpointId: cpId, sessionId });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 删除最新 abortRecovery 检查点 DELETE /v1/sessions/:id/checkpoints/latest
 * P1 修复：前端 dismissRecovery 放弃恢复时调用，清理 abortRecovery 标记。
 * 此前无 DELETE 路由，请求 404，放弃恢复后标记残留导致每次进会话都弹恢复提示。
 */
export async function handleDeleteLatestCheckpoint(
  ctx: HandlerCtx,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const chatManager = createChatManager();
    const latest = await chatManager.getLatestCheckpoint(sessionId);
    if (latest) {
      const meta = latest.metadata as unknown as Record<string, unknown>;
      if (meta?.abortRecovery) {
        await chatManager.deleteCheckpoint(latest.id);
      }
    }
    sendJson(res, { success: true, sessionId });
  } catch (err) {
    ctx.sendError(res, err);
  }
}
