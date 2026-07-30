/**
 * Council HTTP 处理器
 *
 * 提供 Agent Council 的 REST API 和 SSE 流式推送端点：
 * - POST /v1/workspace/:id/council  创建 Council 会话并开始辩论
 * - GET  /v1/workspace/:id/council/:sessionId  获取会话状态
 * - GET  /v1/workspace/:id/council/:sessionId/stream  SSE 流式订阅辩论过程
 * - GET  /v1/workspace/:id/council 列出所有活跃会话
 * - POST /v1/workspace/:id/council/:sessionId/statement  提交 AI 发言
 */

import type http from 'http';
import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { HandlerCtx } from './handler-utils';
import {
  getCouncilEngine,
  setCouncilEmitter,
} from '@modules/workspace/CouncilEngine';
import type { CouncilStreamEvent } from '@modules/workspace/CouncilTypes';
import { CouncilOrchestrator } from '@modules/workspace/CouncilOrchestrator';

const logger = new Logger({ module: 'CouncilHandlers', level: LogLevel.INFO });

/** SSE 客户端连接池 */
const sseClients = new Map<string, Set<http.ServerResponse>>();

// 初始化：绑定 emit 回调到 SSE 连接池
setCouncilEmitter((event: CouncilStreamEvent) => {
  const clients = sseClients.get(event.sessionId);
  if (clients) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      res.write(data);
    }
  }
});

/** 注册 SSE 客户端 */
function registerSSEClient(sessionId: string, res: http.ServerResponse): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId)!.add(res);
}

/** 注销 SSE 客户端 */
function unregisterSSEClient(
  sessionId: string,
  res: http.ServerResponse
): void {
  const clients = sseClients.get(sessionId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) {
      sseClients.delete(sessionId);
    }
  }
}

/**
 * POST /v1/workspace/:id/council
 * 创建 Council 会话
 */
export async function handleCreateCouncil(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { topic, context, agents, maxRounds } = data;

    if (
      !topic ||
      !context ||
      !agents ||
      !Array.isArray(agents) ||
      agents.length < 2
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: '缺少必要参数：topic, context, agents（至少 2 个 Agent）',
        })
      );
      return;
    }

    const engine = getCouncilEngine();

    const session = engine.createSession(workspaceId, topic, context, agents, {
      maxRounds: maxRounds ?? 3,
    });

    // 第 1 步：立即返回 sessionId（不等待辩论完成）
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        sessionId: session.sessionId,
        status: 'debating',
      })
    );

    // 第 2 步：异步执行辩论（不阻塞 HTTP 响应）
    const orchestrator = new CouncilOrchestrator(engine);
    orchestrator.runDebate(session.sessionId).catch((err) => {
      void handleError(err, {
        module: 'infra:handler:council',
        action: 'debate_execution',
      });
    });
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:council',
      action: 'create_council',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '创建 Council 会话失败' }));
    }
  }
}

/**
 * GET /v1/workspace/:id/council/:sessionId
 * 获取 Council 会话状态
 */
export function handleGetCouncil(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): void {
  try {
    const engine = getCouncilEngine();
    const session = engine.getSession(sessionId);

    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Council 会话不存在' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    void handleError(err, {
      module: 'infra:handler:council',
      action: 'get_council',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '获取 Council 会话失败' }));
    }
  }
}

/**
 * GET /v1/workspace/:id/council/:sessionId/stream
 * SSE 流式订阅辩论过程
 */
export function handleCouncilStream(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): void {
  const engine = getCouncilEngine();
  const session = engine.getSession(sessionId);

  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Council 会话不存在' }));
    return;
  }

  // 设置 SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  registerSSEClient(sessionId, res);

  // 如果会话已有历史发言，回放给客户端
  for (const statement of session.statements) {
    res.write(
      `data: ${JSON.stringify({
        type: 'statement',
        sessionId,
        phase: session.phase,
        round: statement.round,
        statement,
        timestamp: statement.timestamp,
      })}\n\n`
    );
  }

  // 如果会话已完成，发送完成事件
  if (session.phase === 'completed') {
    res.write(
      `data: ${JSON.stringify({
        type: 'council_completed',
        sessionId,
        phase: 'completed',
        finalProposal: session.finalProposal,
        timestamp: Date.now(),
      })}\n\n`
    );
    res.end();
    unregisterSSEClient(sessionId, res);
    return;
  }

  // 客户端断开时清理
  req.on('close', () => {
    unregisterSSEClient(sessionId, res);
  });
}

/**
 * GET /v1/workspace/:id/council
 * 列出所有活跃的 Council 会话
 */
export function handleListCouncils(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): void {
  try {
    const engine = getCouncilEngine();
    const sessions = engine.getActiveSessionsByWorkspace(workspaceId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
  } catch (err) {
    void handleError(err, {
      module: 'infra:handler:council',
      action: 'list_councils',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '列出 Council 会话失败' }));
    }
  }
}

/**
 * POST /v1/workspace/:id/council/:sessionId/statement
 * 提交 AI 发言到 Council 辩论
 */
export async function handleSubmitStatement(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { agentId, agentName, round, type, content, keyPoints } = data;

    if (!agentId || !agentName || !round || !type || !content) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少必要参数' }));
      return;
    }

    const engine = getCouncilEngine();
    const session = engine.getSession(sessionId);

    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Council 会话不存在' }));
      return;
    }

    const statement = {
      id: randomUUID(),
      agentId,
      agentName,
      round,
      type,
      content,
      keyPoints: keyPoints || [],
      timestamp: Date.now(),
    };

    session.statements.push(statement);

    // 发射 SSE 事件，确保前端 SSE 客户端能收到手动注入的发言
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emit = (getCouncilEngine() as any).emit;
    if (typeof emit === 'function') {
      try {
        emit({
          type: 'statement',
          sessionId,
          phase: session.phase,
          round,
          statement,
          timestamp: Date.now(),
        });
      } catch (err) {
        // emit 失败不阻塞请求
      }
    }

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statement));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:council',
      action: 'submit_statement',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '提交 Council 发言失败' }));
    }
  }
}
