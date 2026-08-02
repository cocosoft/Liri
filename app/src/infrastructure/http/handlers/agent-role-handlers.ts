/**
 * Agent 角色配置 CRUD HTTP 处理器
 *
 * 提供 Agent 管理页面的 REST API：
 * - GET    /v1/agent-roles             列出所有 Agent 角色
 * - GET    /v1/agent-roles/:agentId    查询单个 Agent 角色
 * - POST   /v1/agent-roles            创建 Agent 角色
 * - PUT    /v1/agent-roles/:agentId   更新 Agent 角色
 * - DELETE /v1/agent-roles/:agentId   删除 Agent 角色
 */

import type http from 'http';
import { getAgentRoleStore } from '@modules/workspace/AgentRoleStore';
import type { HandlerCtx } from './handler-utils';

/**
 * GET /v1/agent-roles
 * 列出所有 Agent 角色
 */
export async function handleListAgentRoles(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const store = getAgentRoleStore();
    const roles = await store.listAll();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(roles));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * GET /v1/agent-roles/:agentId
 * 查询单个 Agent 角色
 */
export async function handleGetAgentRole(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const store = getAgentRoleStore();
    const role = await store.getByAgentId(agentId);
    if (!role) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent 角色不存在' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(role));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * POST /v1/agent-roles
 * 创建 Agent 角色
 */
export async function handleCreateAgentRole(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);

    if (!data.agentId || !data.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少必要参数：agentId, name' }));
      return;
    }

    const store = getAgentRoleStore();
    const id = await store.insert({
      agentId: data.agentId,
      name: data.name,
      expertise: data.expertise || [],
      weight: data.weight ?? 1.0,
      systemPrompt: data.systemPrompt || '',
      icon: data.icon || '🤖',
      sortOrder: data.sortOrder ?? 0,
      enabled: data.enabled !== false,
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: 'Agent 角色创建成功' }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * PUT /v1/agent-roles/:agentId
 * 更新 Agent 角色
 */
export async function handleUpdateAgentRole(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);

    const store = getAgentRoleStore();
    const existing = await store.getByAgentId(agentId);
    if (!existing) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent 角色不存在' }));
      return;
    }

    await store.update(existing.id!, {
      name: data.name,
      expertise: data.expertise,
      weight: data.weight,
      systemPrompt: data.systemPrompt,
      icon: data.icon,
      sortOrder: data.sortOrder,
      enabled: data.enabled,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Agent 角色更新成功' }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * DELETE /v1/agent-roles/:agentId
 * 删除 Agent 角色
 */
export async function handleDeleteAgentRole(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const store = getAgentRoleStore();
    const existing = await store.getByAgentId(agentId);
    if (!existing) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent 角色不存在' }));
      return;
    }

    await store.delete(existing.id!);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Agent 角色删除成功' }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
