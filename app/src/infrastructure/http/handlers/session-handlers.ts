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
  module: 'infra:http:session-handlers',
  level: LogLevel.INFO,
});

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
          if (
            projectId &&
            (md?.projectId ??
              (s as unknown as Record<string, unknown>).workspaceId) !==
              projectId
          )
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
    const data = JSON.parse(body);
    const { title, model, workspaceId, workspace_path, moduleType, projectId } =
      data;
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    // 将 model、workspaceId、moduleType、projectId 存入 session metadata
    const metadata: Record<string, unknown> = {};
    if (model) metadata.model = model;
    if (workspaceId) metadata.workspaceId = workspaceId;
    if (workspace_path) metadata.workspacePath = workspace_path;
    if (moduleType) metadata.moduleType = moduleType;
    if (projectId) metadata.projectId = projectId;

    const session = await coreAPI.createSession({ title, metadata });
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
    const data = JSON.parse(body);
    const blocks = data.blocks || [];

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
    const { title } = JSON.parse(body);
    const coreAPI = getCoreAPI();
    await coreAPI.renameSession(sessionId, title);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:renamed', { id: sessionId, title });
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
    const { userMessage, assistantResponse } = JSON.parse(body);
    const coreAPI = getCoreAPI();
    const title = await coreAPI.generateSessionTitle(
      sessionId,
      userMessage,
      assistantResponse
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, title }));
    if (title) {
      await coreAPI.renameSession(sessionId, title);
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
    const data = JSON.parse(body);
    const coreAPI = getCoreAPI();

    await coreAPI.updateSessionMeta(sessionId, {
      model: data.model,
      workspaceId: data.workspace_id,
      providerId: data.provider_id,
      tasksOverride: data.tasks_override,
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
    const sessionGateway = (coreAPI as unknown as Record<string, unknown>)
      .sessionGateway as
      | { compactSession: (id: string) => Promise<unknown> }
      | undefined;

    if (!sessionGateway?.compactSession) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Session compaction not available',
            type: 'not_implemented',
          },
        })
      );
      return;
    }

    const result = await sessionGateway.compactSession(sessionId);
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
 * POST /v1/sessions/:id/prune
 */
export async function handlePruneSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const sessionGateway = (coreAPI as unknown as Record<string, unknown>)
      .sessionGateway as
      | {
          pruneNow: () => Promise<unknown>;
          getPruneEstimate: () => Promise<unknown>;
        }
      | undefined;

    if (!sessionGateway?.pruneNow) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Session pruning not available',
            type: 'not_implemented',
          },
        })
      );
      return;
    }

    const result = await sessionGateway.pruneNow();
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
