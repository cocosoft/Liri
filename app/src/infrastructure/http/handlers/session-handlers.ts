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
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { Message } from '@modules/chat/types/message';
import { MessageRole } from '@modules/chat/types/message';
import type { LiriEvent, LiriEventType } from '@modules/chat/types/events';
import type { EventLogQuery } from '@modules/session/storage/EventLogStorage';
import {
  tryParseJson,
  sendBadRequest,
  normalizeTimestamp,
} from './session-handlers-utils';

const logger = getLogger('infra:http:session-handlers');

// ========== Session Handlers ==========

export async function handleListSessions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const lite = url.searchParams.get('lite') === 'true';
    const moduleType = url.searchParams.get('moduleType');
    const projectId = url.searchParams.get('projectId');

    let sessions: unknown;
    if (lite) {
      sessions = await coreAPI.listLiteSessions();
    } else {
      let full = await coreAPI.listSessions();
      if (moduleType || projectId) {
        full = full.filter((s) => {
          const md = s.metadata as Record<string, unknown> | undefined;
          if (moduleType && (md?.moduleType || 'chat') !== moduleType)
            return false;
          if (projectId && (md?.projectId as string | undefined) !== projectId)
            return false;
          return true;
        });
      }
      sessions = full;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理创建会话请求
 */
export async function handleCreateSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const { title, model, workspaceId, workspace_path, moduleType, projectId } =
      data;
    // L4-fix: title 类型校验 —— 原实现直接 `title as string | undefined` 硬断言，
    // 传入非 string（对象/数组/数字）会被静默写入，导致前端展示异常。
    if (title !== undefined && typeof title !== 'string') {
      sendBadRequest(res, 'title must be a string');
      return;
    }
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    // 将 model、workspaceId、moduleType、projectId 存入 session metadata
    const metadata: Record<string, unknown> = {};
    if (model) metadata.model = model as string;
    if (workspaceId) metadata.workspaceId = workspaceId as string;
    if (workspace_path) metadata.workspacePath = workspace_path as string;
    if (moduleType) metadata.moduleType = moduleType as string;
    if (projectId) metadata.projectId = projectId as string;

    const session = await coreAPI.createSession({
      title: title as string | undefined,
      metadata,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
    ctx.broadcastEvent('session:created', { id: session?.id });
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取会话详情请求
 */
export async function handleGetSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    const session = await coreAPI.getSession(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Session not found', type: 'not_found' },
        })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取会话消息列表请求
 */
export async function handleGetSessionMessages(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // P1-21：启动后首个请求（前端最常见动作）若命中本 handler，确保会话已加载
    await coreAPI.ensureSessionsLoaded();
    const messages = await coreAPI.getSessionMessages(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(messages));
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理添加会话消息请求（写前持久化：前端发送前先落盘用户消息，断网时失败由前端 outbox 补发）
 * body: { id, role, content, timestamp, session_id, replyToId, metadata }
 * 幂等：按消息 id 查重，已存在则直接返回 idempotent: true
 */
export async function handleAddSessionMessage(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }

    if (!data.id || typeof data.id !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'message id is required',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }
    if (typeof data.content !== 'string' || data.content.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'message content is required',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    const chatManager = coreAPI.getChatManager();
    // 幂等：按消息 id 查重（内存优先；miss 时读盘兜底，覆盖后端重启后 outbox 补发场景）
    const inMemory = chatManager
      .getSessionMessages(sessionId)
      .find((m) => m.id === data.id);
    if (inMemory) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: true, idempotent: true, messageId: data.id })
      );
      return;
    }
    const fromDisk = await coreAPI.getSessionMessages(sessionId);
    const existing = fromDisk.find((m) => m.id === data.id);
    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: true, idempotent: true, messageId: data.id })
      );
      return;
    }

    // P2-23：时间戳单位归一化（秒级 ×1000 转毫秒，防 1970 年错乱）
    const createdAt = new Date(
      (normalizeTimestamp(data.timestamp) as number | undefined) ?? Date.now()
    );
    const message: Message = {
      id: data.id,
      role:
        data.role === 'assistant' ? MessageRole.ASSISTANT : MessageRole.USER,
      content: data.content,
      createdAt,
      updatedAt: createdAt,
      sessionId,
      metadata: {
        ...(data.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {}),
        replyToId: data.replyToId || undefined,
        persistedBy: 'frontend-write-ahead',
      },
    };
    chatManager.addMessage(sessionId, message);
    logger.info('写前落盘用户消息', {
      sessionId,
      messageId: data.id,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ success: true, idempotent: false, messageId: data.id })
    );
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理更新消息 blocks 请求
 */
export async function handleUpdateMessageBlocks(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
  messageId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    // P2-23：blocks 必须为数组，非数组时按空处理（原实现字符串等类型直接透传）
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];

    const coreAPI = getCoreAPI();
    await coreAPI.updateMessageBlocks(sessionId, messageId, blocks);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理删除会话请求
 */
export async function handleDeleteSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.deleteSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:deleted', { id: sessionId });
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理清除所有会话请求
 */
export async function handleClearAllSessions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.clearAllSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:cleared', {});
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取当前会话请求
 */
export async function handleGetCurrentSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const session = await coreAPI.getCurrentSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // P1-4：无当前会话时返回 null 而非 JSON.stringify(undefined) 的空产物
    res.end(JSON.stringify(session ?? null));
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理切换会话请求
 */
export async function handleSwitchSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // P1-21：切换前确保会话已加载（避免命中未加载路径）
    await coreAPI.ensureSessionsLoaded();
    await coreAPI.switchSession(sessionId);
    const session = await coreAPI.getSession(sessionId);
    if (!session) {
      logger.warn('会话切换后 getSession 返回 undefined', { sessionId });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Session not found', type: 'not_found' },
        })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        // P2-3：透传 AppError.statusCode（会话不存在 → 404），与 message-handlers 模式一致
        const statusCode =
          err instanceof Error &&
          (err as unknown as { statusCode?: number }).statusCode
            ? (err as unknown as { statusCode?: number }).statusCode!
            : 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message:
                err instanceof Error ? err.message : 'Internal server error',
              type: statusCode === 404 ? 'not_found' : undefined,
            },
          })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理重命名会话请求
 */
export async function handleRenameSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const { title } = data;
    const coreAPI = getCoreAPI();
    await coreAPI.renameSession(sessionId, title as string);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:renamed', {
      id: sessionId,
      title: title as string,
    });
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理生成会话标题请求
 */
export async function handleGenerateTitle(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const { userMessage, assistantResponse } = data;
    const coreAPI = getCoreAPI();
    // P1-21：启动后首个请求若命中本 handler，确保会话已加载
    await coreAPI.ensureSessionsLoaded();
    const title = await coreAPI.generateSessionTitle(
      sessionId,
      userMessage as string,
      assistantResponse as string
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, title }));
    if (title) {
      // E-3（2026-08-23）：AI 生成标题 → source='ai' → titleStage='final'
      await coreAPI.renameSession(sessionId, title, 'ai');
      ctx.broadcastEvent('session:renamed', { id: sessionId, title });
    }
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理更新会话元数据请求
 * PATCH /v1/sessions/:id/meta
 */
export async function handleUpdateSessionMeta(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const coreAPI = getCoreAPI();

    await coreAPI.updateSessionMeta(sessionId, {
      model: data.model as string | undefined,
      workspaceId: data.workspace_id as string | undefined,
      providerId: data.provider_id as string | undefined,
      tasksOverride: data.tasks_override as Record<string, string> | undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:meta_updated', { id: sessionId, ...data });
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理触发会话压缩请求
 * POST /v1/sessions/:id/compact
 */
export async function handleCompactSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // P2-5 修复：调用 CoreAPIImpl 正式方法（委托 ChatManager.compactSession）。
    // 原实现反射取 coreAPI.sessionGateway（CoreAPIImpl 无此属性）恒 undefined → 恒 501。
    const result = await coreAPI.compactSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, result }));
    ctx.broadcastEvent('session:compacted', { id: sessionId });
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理触发会话修剪请求
 * POST /v1/sessions/prune（全量修剪，P2-22 修复：原 :id 路由与全量实现语义不符）
 */
export async function handlePruneSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // 修剪修复：调用 CoreAPIImpl 正式方法（委托 ChatManager → SessionGateway.pruneNow）。
    // 原实现反射取 coreAPI.sessionGateway（CoreAPIImpl 无此属性）恒 undefined → 恒 501。
    const result = await coreAPI.pruneSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, result }));
    ctx.broadcastEvent('session:pruned', {});
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取会话记忆请求
 * GET /v1/sessions/:id/memory
 */
export async function handleGetSessionMemory(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const { getSessionMemoryManager } =
      await import('../../../session/bootstrap/SessionSystemBootstrap');
    const mm = getSessionMemoryManager();
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const query = url.searchParams.get('q') || undefined;
    const topK = parseInt(url.searchParams.get('topK') || '5', 10);

    let items;
    if (query) {
      items = await mm.searchMemory(sessionId, query, topK);
    } else {
      const memory = mm.loadMemory(sessionId);
      items = memory.items;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items, sessionId }));
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
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * M1 事件溯源：处理获取会话事件流请求
 * GET /v1/sessions/:id/events?fromSeq=X&toSeq=Y&types=a,b&limit=N
 *
 * 查询参数：
 *   - fromSeq: 起始 seq（包含），默认 1
 *   - toSeq: 结束 seq（包含），默认 Infinity
 *   - types: 逗号分隔的事件类型白名单
 *   - limit: 最大返回数，默认 1000，上限 10000
 *
 * 响应：
 *   200: { events: LiriEvent[], tailSeq: number, hasMore: boolean }
 *   400: 参数错误
 *   500: 服务器错误
 *
 * 首次访问时若 events.jsonl 不存在但 messages.jsonl 存在，自动触发迁移。
 */
export async function handleGetSessionEvents(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    // 解析查询参数
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const fromSeqParam = url.searchParams.get('fromSeq');
    const toSeqParam = url.searchParams.get('toSeq');
    const typesParam = url.searchParams.get('types');
    const limitParam = url.searchParams.get('limit');

    const fromSeq = fromSeqParam ? Number(fromSeqParam) : undefined;
    const toSeq = toSeqParam ? Number(toSeqParam) : undefined;
    const types = typesParam
      ? (typesParam.split(',').filter(Boolean) as LiriEventType[])
      : undefined;
    const limit = limitParam ? Math.min(Number(limitParam), 10000) : 1000;

    // 参数校验
    if (fromSeq !== undefined && (!Number.isFinite(fromSeq) || fromSeq < 1)) {
      sendBadRequest(res, 'fromSeq must be a positive number');
      return;
    }
    if (toSeq !== undefined && (!Number.isFinite(toSeq) || toSeq < 1)) {
      sendBadRequest(res, 'toSeq must be a positive number');
      return;
    }
    if (limit < 1) {
      sendBadRequest(res, 'limit must be a positive number');
      return;
    }

    // 获取事件流（coreAPI 内部触发首次迁移）
    const result = await coreAPI.getSessionEvents(sessionId, {
      fromSeq,
      toSeq,
      types,
      limit,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http:session-handlers',
      action: 'getSessionEvents',
      context: { sessionId },
    });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {
        /* res可能已结束, 忽略 */
      }
    }
  }
}
