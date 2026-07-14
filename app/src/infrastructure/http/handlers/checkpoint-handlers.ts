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
  const urlParts = url.split('/').filter(Boolean);
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
