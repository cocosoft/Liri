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

import type http from "node:http";
import { randomUUID } from "node:crypto";
import { Logger, LogLevel } from "@modules/monitoring";
import type { HandlerCtx } from "./handler-utils";
import { createHandlerCtx } from "./handler-utils";
import { CouncilEngine } from "@modules/workspace/CouncilEngine";
import type {
  CouncilSession,
  CouncilStreamEvent,
  CouncilAgentRole,
} from "@modules/workspace/CouncilTypes";

const logger = new Logger({ module: "CouncilHandlers", level: LogLevel.INFO });

/** 全局 CouncilEngine 实例 */
let councilEngine: CouncilEngine | null = null;

/** SSE 客户端连接池 */
const sseClients = new Map<string, Set<http.ServerResponse>>();

/** 获取或创建 CouncilEngine 实例 */
function getCouncilEngine(): CouncilEngine {
  if (!councilEngine) {
    // 全局事件发射器：广播到所有 SSE 客户端
    const emit = (event: CouncilStreamEvent) => {
      const clients = sseClients.get(event.sessionId);
      if (clients) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of clients) {
          res.write(data);
        }
      }
    };
    councilEngine = new CouncilEngine(emit);
  }
  return councilEngine;
}

/** 注册 SSE 客户端 */
function registerSSEClient(sessionId: string, res: http.ServerResponse): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId)!.add(res);
}

/** 注销 SSE 客户端 */
function unregisterSSEClient(sessionId: string, res: http.ServerResponse): void {
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

    if (!topic || !context || !agents || !Array.isArray(agents) || agents.length < 2) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必要参数：topic, context, agents（至少 2 个 Agent）" }));
      return;
    }

    const engine = getCouncilEngine();

    const session = engine.createSession(workspaceId, topic, context, agents, {
      maxRounds: maxRounds ?? 3,
    });

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      sessionId: session.sessionId,
      message: "Council 会话已创建，请通过 SSE 端点订阅辩论过程",
    }));
  } catch (err) {
    logger.error("创建 Council 会话失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "创建 Council 会话失败" }));
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
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Council 会话不存在" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(session));
  } catch (err) {
    logger.error("获取 Council 会话失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "获取 Council 会话失败" }));
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
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Council 会话不存在" }));
    return;
  }

  // 设置 SSE 头
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);

  registerSSEClient(sessionId, res);

  // 如果会话已有历史发言，回放给客户端
  for (const statement of session.statements) {
    res.write(
      `data: ${JSON.stringify({
        type: "statement",
        sessionId,
        phase: session.phase,
        round: statement.round,
        statement,
        timestamp: statement.timestamp,
      })}\n\n`
    );
  }

  // 如果会话已完成，发送完成事件
  if (session.phase === "completed") {
    res.write(
      `data: ${JSON.stringify({
        type: "council_completed",
        sessionId,
        phase: "completed",
        finalProposal: session.finalProposal,
        timestamp: Date.now(),
      })}\n\n`
    );
    res.end();
    unregisterSSEClient(sessionId, res);
    return;
  }

  // 客户端断开时清理
  req.on("close", () => {
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

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessions));
  } catch (err) {
    logger.error("列出 Council 会话失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "列出 Council 会话失败" }));
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
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必要参数" }));
      return;
    }

    const engine = getCouncilEngine();
    const session = engine.getSession(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Council 会话不存在" }));
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

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(statement));
  } catch (err) {
    logger.error("提交 Council 发言失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "提交 Council 发言失败" }));
    }
  }
}