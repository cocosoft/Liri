/**
 * 规则管理 API 处理器
 *
 * 提供对话式规则管理的 REST API：
 * - GET  /v1/workspaces/:id/rules             列出规则
 * - GET  /v1/workspaces/:id/rules/:spec       读取规则
 * - PUT  /v1/workspaces/:id/rules/:spec       写入/覆盖规则
 * - POST /v1/workspaces/:id/rules/:spec       追加规则
 * - POST /v1/workspaces/:id/rules/load        按工作项加载规则
 * - GET  /v1/workspaces/:id/rules/overview    规则总览
 */

import type http from "node:http";
import { Logger, LogLevel } from "@modules/monitoring";
import type { HandlerCtx } from "./handler-utils";
import { getRuleEngine } from "@modules/workspace/RuleEngine";

const logger = new Logger({ module: "RuleHandlers", level: LogLevel.INFO });

/**
 * GET /v1/workspaces/:id/rules
 * 列出所有规则文件
 */
export function handleListRules(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): void {
  try {
    const engine = getRuleEngine(workspaceId);
    const rules = engine.listRules();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rules));
  } catch (err) {
    logger.error("列出规则失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "列出规则失败" }));
    }
  }
}

/**
 * GET /v1/workspaces/:id/rules/:spec
 * 读取指定专业领域的规则
 */
export function handleGetRule(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  specialization: string
): void {
  try {
    const engine = getRuleEngine();
    const content = engine.readRule(specialization as any);

    if (content === null) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `规则 "${specialization}" 不存在`, exists: false }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ specialization, content, exists: true }));
  } catch (err) {
    logger.error("读取规则失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "读取规则失败" }));
    }
  }
}

/**
 * PUT /v1/workspaces/:id/rules/:spec
 * 写入/覆盖规则
 */
export async function handleWriteRule(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  specialization: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { content } = data;

    if (!content) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必要参数：content" }));
      return;
    }

    const engine = getRuleEngine();
    engine.writeRule(specialization as any, content);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ specialization, message: "规则已保存" }));
  } catch (err) {
    logger.error("写入规则失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "写入规则失败" }));
    }
  }
}

/**
 * POST /v1/workspaces/:id/rules/:spec
 * 追加规则内容
 */
export async function handleAppendRule(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  specialization: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { content } = data;

    if (!content) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必要参数：content" }));
      return;
    }

    const engine = getRuleEngine();
    engine.appendRule(specialization as any, content);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ specialization, message: "规则已追加" }));
  } catch (err) {
    logger.error("追加规则失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "追加规则失败" }));
    }
  }
}

/**
 * POST /v1/workspaces/:id/rules/load
 * 按工作项上下文加载相关规则
 */
export async function handleLoadRulesForWorkItem(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { title, description, changedFiles } = data;

    if (!title) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必要参数：title" }));
      return;
    }

    const engine = getRuleEngine();
    const rules = engine.loadRulesForWorkItem(title, description || "", changedFiles || []);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rules }));
  } catch (err) {
    logger.error("加载规则失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "加载规则失败" }));
    }
  }
}

/**
 * GET /v1/workspaces/:id/rules/overview
 * 规则总览
 */
export function handleRulesOverview(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  try {
    const engine = getRuleEngine();
    const overview = engine.getRulesOverview();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ overview }));
  } catch (err) {
    logger.error("获取规则总览失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "获取规则总览失败" }));
    }
  }
}