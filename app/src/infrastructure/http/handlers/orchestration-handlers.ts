/**
 * 编排流式 API Handler
 *
 * 提供 SSE 流式端点，推送编排执行过程事件：
 * - DAG 任务执行状态
 * - Rule Check Gate 检查结果
 * - Council 辩论过程
 * - Swarm 群组状态
 * - 三层上下文加载
 */

import type http from 'http';
import { join } from 'path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { createWorkItemStore } from '@modules/workspace/WorkItemStore';
import { createLiriConfigManager } from '@modules/workspace/LiriConfigManager';
import { resolveWorkspacePath } from './workspaces-handlers';
import type { OrchestrationSnapshot } from '@modules/agent/events/OrchestrationEvents';
import { OrchestrationEventType } from '@modules/agent/events/OrchestrationEvents';
import { AgentEventType } from '@modules/agent/events/types';
import { globalEventBus } from '../../../core/events/EventBus.js';
import type { EventSubscription } from '../../../core/events/EventBus.js';
import { getOrchestrationHistoryAdapter } from './OrchestrationHistoryAdapter.js';

const logger = getLogger('http:orchestration');

/** SSE 响应头 */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * 编排流式端点
 * GET /v1/workspaces/:id/items/:itemId/orchestration/stream
 *
 * 建立 SSE 长连接，推送实时编排事件。
 * 客户端通过 EventSource 连接并接收事件流。
 */
export async function handleOrchestrationStream(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  itemId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    const item = store.get(itemId);

    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Work item not found' } }));
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, SSE_HEADERS);

    // 发送初始连接事件
    sendSSE(res, 'connected', {
      workItemId: itemId,
      status: item.status,
      timestamp: new Date().toISOString(),
    });

    // 发送当前编排快照
    const snapshot = buildSnapshot(item);
    sendSSE(res, 'snapshot', snapshot);

    // 保持连接打开，心跳
    const heartbeat = setInterval(() => {
      logger.debug('编排 SSE 心跳 tick', { workItemId: itemId });
      sendSSE(res, 'heartbeat', {
        timestamp: new Date().toISOString(),
      });
    }, 15000);

    // 启动编排历史适配器（首次 SSE 连接时初始化）
    getOrchestrationHistoryAdapter().start(manager.dir);

    // ── 订阅所有编排事件，推模式转发到 SSE ──

    // 所有需要订阅的事件类型列表
    const allEventTypes: string[] = [
      // Council 辩论（7 种）
      OrchestrationEventType.COUNCIL_START,
      OrchestrationEventType.COUNCIL_ROUND_START,
      OrchestrationEventType.COUNCIL_AGENT_SPEAKING,
      OrchestrationEventType.COUNCIL_AGENT_DELTA,
      OrchestrationEventType.COUNCIL_END,
      OrchestrationEventType.COUNCIL_ROUND,
      OrchestrationEventType.COUNCIL_DETAIL,

      // DAG 编排（8 种）
      OrchestrationEventType.ORCH_START,
      OrchestrationEventType.ORCH_TASK_START,
      OrchestrationEventType.ORCH_TASK_PROGRESS,
      OrchestrationEventType.ORCH_TASK_END,
      OrchestrationEventType.ORCH_STEP_START,
      OrchestrationEventType.ORCH_STEP_DELTA,
      OrchestrationEventType.ORCH_STEP_COMPLETED,
      OrchestrationEventType.ORCH_END,

      // Plan 计划执行（5 种）
      OrchestrationEventType.PLAN_START,
      OrchestrationEventType.PLAN_STEP_START,
      OrchestrationEventType.PLAN_STEP_COMPLETED,
      OrchestrationEventType.PLAN_PROGRESS,
      OrchestrationEventType.PLAN_COMPLETED,

      // Agent Chain 链式调用（3 种）
      OrchestrationEventType.CHAIN_START,
      OrchestrationEventType.CHAIN_STEP,
      OrchestrationEventType.CHAIN_END,

      // Swarm 群组（3 种）
      OrchestrationEventType.SWARM_DISPATCH,
      OrchestrationEventType.SWARM_AGENT_STATUS,
      OrchestrationEventType.SWARM_COMPLETE,

      // 并行执行 / 方案 7（4 种）
      OrchestrationEventType.PARALLEL_START,
      OrchestrationEventType.PARALLEL_TASK_START,
      OrchestrationEventType.PARALLEL_TASK_COMPLETE,
      OrchestrationEventType.PARALLEL_END,

      // SubAgent 引擎（6 种，使用 AgentEventType）
      AgentEventType.THINKING_START,
      AgentEventType.THINKING_DELTA,
      AgentEventType.THINKING_END,
      AgentEventType.TOOL_CALL_START,
      AgentEventType.TOOL_CALL_DELTA,
      AgentEventType.TOOL_CALL_END,
    ];
    const subscriptions: EventSubscription[] = [];

    for (const event of allEventTypes) {
      const sub = globalEventBus.subscribe(event, (data: unknown) => {
        // OrchestrationEventType 以 orch: 开头，AgentEventType 以 agent: 开头
        // 统一去掉 orch: 前缀后作为 SSE 事件名
        const sseEvent = event.startsWith('orch:') ? event.slice(5) : event;
        sendSSE(res, sseEvent, {
          event,
          data,
          timestamp: Date.now(),
        });
      });
      subscriptions.push(sub);
    }

    // 监听客户端断开
    req.on('close', () => {
      clearInterval(heartbeat);
      // 清理所有订阅
      for (const sub of subscriptions) {
        sub.unsubscribe();
      }
      logger.debug('编排流式连接关闭', { workItemId: itemId });
    });

    req.on('error', () => {
      clearInterval(heartbeat);
      for (const sub of subscriptions) {
        sub.unsubscribe();
      }
    });
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'orchestration_stream',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to start orchestration stream' },
        })
      );
    }
  }
}

/**
 * 获取编排快照
 * GET /v1/workspaces/:id/items/:itemId/orchestration
 */
export async function handleGetOrchestrationSnapshot(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  itemId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    const item = store.get(itemId);

    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Work item not found' } }));
      return;
    }

    const snapshot = buildSnapshot(item);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshot));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'orchestration_snapshot',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to get orchestration snapshot' },
        })
      );
    }
  }
}

/**
 * 获取 Swarm 群组状态
 * GET /v1/workspaces/:id/swarm
 */
export async function handleGetSwarmStatus(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);

    // 从配置中读取 Swarm 配置
    const config = manager.loadConfig();

    // 构建 Swarm 状态响应
    const swarmStatus = {
      workspaceId,
      agents:
        config.defaultAgents?.map((agent: Record<string, unknown>) => ({
          id: agent.id || `agent_${Math.random().toString(36).slice(2, 8)}`,
          name: agent.name || 'Unnamed Agent',
          role: agent.role || 'worker',
          status: 'idle' as const,
          connections: [] as string[],
        })) || [],
      totalAgents: config.defaultAgents?.length || 0,
      activeAgents: 0,
      updatedAt: new Date().toISOString(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(swarmStatus));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'swarm_status' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get swarm status' } })
      );
    }
  }
}

/**
 * 获取 Agent-Model 绑定配置
 * GET /v1/workspaces/:id/agent-model-bindings
 */
export async function handleGetAgentModelBindings(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const config = manager.loadConfig();

    const bindings = config.agentModelBindings || [
      {
        agentRole: 'default',
        model: config.defaultModel || '',
        maxTokens: 4096,
        temperature: 0.7,
      },
    ];

    // CS04: 禁止 Mock 数据。config.availableModels 为空时返回空列表，
    // 前端自行从 /v1/models 获取真实模型列表。
    const availableModels = config.availableModels || [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bindings, availableModels }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'agent_model_bindings',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to get agent model bindings' },
        })
      );
    }
  }
}

/**
 * 更新 Agent-Model 绑定配置
 * PUT /v1/workspaces/:id/agent-model-bindings
 */
export async function handleUpdateAgentModelBindings(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { bindings } = JSON.parse(body || '{}');

    if (!bindings) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bindings is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    manager.updateConfig({ agentModelBindings: bindings });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, bindings }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'agent_model_bindings_update',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to update agent model bindings' },
        })
      );
    }
  }
}

/**
 * 获取编排历史
 * GET /v1/workspaces/:id/items/:itemId/orchestration/history?since=2026-01-01T00:00:00Z&limit=100
 *
 * 返回持久化的编排事件历史，供前端时间线回放使用。
 * since 参数为 ISO 8601 时间戳，可选，用于增量拉取。
 * limit 参数控制最大返回条数，默认 100。
 */
export async function handleGetOrchestrationHistory(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  itemId: string
): Promise<void> {
  try {
    // 解析查询参数
    const urlObj = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`
    );
    const sinceParam = urlObj.searchParams.get('since');
    const limitParam = urlObj.searchParams.get('limit');

    const sinceMs = sinceParam ? new Date(sinceParam).getTime() : undefined;
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000)
      : 100;

    // 解析工作区路径
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    const item = store.get(itemId);

    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Work item not found' } }));
      return;
    }

    // 查询历史
    const adapter = getOrchestrationHistoryAdapter();
    const itemDir = join(manager.dir, 'workitems');
    const result = adapter.query(itemDir, itemId, sinceMs, limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'orchestration_history',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to get orchestration history' },
        })
      );
    }
  }
}

// ========== 辅助函数 ==========

/**
 * 发送 SSE 事件
 */
function sendSSE(res: http.ServerResponse, event: string, data: unknown): void {
  const payload = JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

/**
 * 从工作项构建编排快照
 */
function buildSnapshot(item: {
  id: string;
  status: string;
  title: string;
  updatedAt: string;
}): OrchestrationSnapshot {
  const statusMap: Record<string, OrchestrationSnapshot['status']> = {
    pending: 'idle',
    running: 'executing',
    review: 'checking',
    done: 'completed',
    failed: 'failed',
    paused: 'idle',
  };

  return {
    workItemId: item.id,
    status: statusMap[item.status] || 'idle',
    tasks: [],
    ruleChecks: [],
    layers: [],
    currentLayer: 0,
    startTime: item.updatedAt,
    updatedAt: new Date().toISOString(),
  };
}
