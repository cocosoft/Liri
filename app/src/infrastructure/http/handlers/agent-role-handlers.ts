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
import { getLogger } from '@modules/monitoring';
import { activeModelService, deriveModelType } from '@modules/ai';
import { refreshAvailableSubagentTypeNames } from '@modules/tools';
import type { HandlerCtx } from './handler-utils';

const logger = getLogger('http:agentRoles');

/**
 * 角色可用模型的最小信息（校验用；取自 `model_registry`）
 */
export interface AgentRoleModelInfo {
  modelId: string;
  /** 由能力集合推导的类型（`deriveModelType`） */
  type: string;
  /** 供应商归属（为空 ⇒ 数据不完整） */
  providerId: string;
  capabilities: string[];
}

/** 缺省取数：活跃模型（存在且 `enabled`）→ 投影为校验所需的四元组 */
async function defaultModelLookup(
  modelId: string
): Promise<AgentRoleModelInfo | null> {
  const models = await activeModelService.getActiveModels();
  const hit = models.find((m) => m.modelId === modelId);
  if (!hit) return null;
  const capabilities = hit.capabilities ?? [];
  return {
    modelId: hit.modelId,
    type: deriveModelType(capabilities),
    providerId: hit.providerId ?? '',
    capabilities,
  };
}

/**
 * T5 校验：角色的 `model` 必须是**可用的对话模型**。
 *
 * 三道判据（按序）：
 * 1. **可用性**：必须在活跃模型集内（存在且 `enabled`）；
 * 2. **类型**：必须是**对话模型**（`deriveModelType(caps) === 'chat'`）—— 角色要被"委派去干活的模型"，
 *    选到生图/向量/语音模型只会在运行期失败；另对投影未覆盖的 `TEXT_TO_VIDEO`/`IMAGE_TO_VIDEO`
 *    取 **fail-closed**（见台账 N-40）；
 * 3. **归属**：`providerId` 不得为空（数据不完整 ⇒ 拒绝，避免"能选但用不了"）。
 *
 * 口径为何是"**模型名**"而不是 UUID：下游 `providerRegistry.getByModel(model)` 按
 * `model_registry.modelId`（模型名）做**精确匹配**（`resolveModelRoute` 明确注明
 * "返回 UUID 会导致 `getByModel(UUID)` 匹配失败"），且该字符串会被原样作为
 * `chat({ model })` 的取值发给上游 ⇒ 传 UUID 会 400（与本项目台账 N-27 同类现象）。
 *
 * `lookup` 可注入 ⇒ 纯逻辑可单测（不依赖真实 DB 内容）。
 *
 * @returns 错误文案（校验不通过）或 `null`（通过 / 未指定）
 */
export async function validateAgentRoleModel(
  model: unknown,
  lookup: (
    modelId: string
  ) => Promise<AgentRoleModelInfo | null> = defaultModelLookup
): Promise<string | null> {
  if (model === undefined || model === null) {
    return null; // 未提交该字段（如 PUT 的部分更新）⇒ 不动
  }
  if (typeof model !== 'string') {
    return '字段 model 必须是字符串（模型名）';
  }
  const name = model.trim();
  if (name === '') {
    return null; // 空值合法 = 沿用任务分工默认模型
  }

  const info = await lookup(name);
  if (!info) {
    return (
      `模型 "${name}" 不可用（未在「模型管理」注册，或已停用）。` +
      '请先在模型管理中注册/启用该模型，或留空以沿用任务分工的默认模型。'
    );
  }
  const nonChatVideoCaps = ['text_to_video', 'image_to_video'];
  const hasUnmappedVideoCap = info.capabilities.some((c) =>
    nonChatVideoCaps.includes(c)
  );
  if (info.type !== 'chat' || hasUnmappedVideoCap) {
    return (
      `模型 "${name}" 不是对话模型（类型：${info.type}）⇒ 不能作为 Agent 角色模型。` +
      '请选择对话模型，或留空以沿用任务分工的默认模型。'
    );
  }
  if (!info.providerId || info.providerId.trim() === '') {
    return (
      `模型 "${name}" 缺少供应商归属（providerId 为空）⇒ 数据不完整，无法用于委派。` +
      '请在「模型管理」中修复该模型的供应商后重试。'
    );
  }
  return null;
}

/**
 * O17/O18：角色配置变更后刷新**解析链真正依赖的可见面**。
 *
 * 原实现（O11-3）调用 `agentRegistry.invalidateCache()` —— 清的却是 `discover()` 的
 * 会话缓存，而解析链①走 DB 直查（无缓存）、②直读 `agents` Map（不经该缓存）
 * ⇒ 对目标路径**零作用**（复核认定为空修复）。现改为刷新 `subagent_type` 的
 * **工具 schema 可用清单快照**（模型事前可见的清单），该对象才是会被缓存/被消费的。
 *
 * 失败只记 warn（不回滚已落库的变更）。
 */
async function refreshAgentRoleSchema(): Promise<void> {
  try {
    await refreshAvailableSubagentTypeNames();
  } catch (err) {
    // @ignore-catch — 快照刷新失败不影响已落库的角色变更，仅记录（下一轮写入或重启会重试）
    logger.warn('角色变更后刷新工具 schema 可用清单失败', {
      error: String(err),
    });
  }
}

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

    // T5：`model` 必须是可用模型（模型名口径）；空/未提供 ⇒ 沿用任务分工默认
    const modelError = await validateAgentRoleModel(data.model);
    if (modelError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: modelError }));
      return;
    }

    const store = getAgentRoleStore();
    const id = await store.insert({
      agentId: data.agentId,
      name: data.name,
      expertise: data.expertise || [],
      weight: data.weight ?? 1.0,
      systemPrompt: data.systemPrompt || '',
      // O11-2：推荐模型可空（空 = 沿用默认/任务分工）；T5：入库前 trim
      model:
        typeof data.model === 'string'
          ? data.model.trim() || undefined
          : undefined,
      icon: data.icon || '🤖',
      sortOrder: data.sortOrder ?? 0,
      enabled: data.enabled !== false,
      // T9：策略位（缺省 false = 不可再委派）
      canDelegate: data.canDelegate === true,
    });
    await refreshAgentRoleSchema();

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

    // T5：仅当本次提交了 `model` 才校验（`undefined` ⇒ 不动该字段）
    const modelError = await validateAgentRoleModel(data.model);
    if (modelError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: modelError }));
      return;
    }

    await store.update(existing.id!, {
      name: data.name,
      expertise: data.expertise,
      weight: data.weight,
      systemPrompt: data.systemPrompt,
      model: typeof data.model === 'string' ? data.model.trim() : undefined,
      icon: data.icon,
      sortOrder: data.sortOrder,
      enabled: data.enabled,
      // T9：仅当显式提交布尔值才改（`undefined` ⇒ 不动该字段）
      canDelegate:
        typeof data.canDelegate === 'boolean' ? data.canDelegate : undefined,
    });
    await refreshAgentRoleSchema();

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
    await refreshAgentRoleSchema();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Agent 角色删除成功' }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
