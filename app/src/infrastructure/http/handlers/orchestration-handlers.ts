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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { createWorkItemStore } from '@modules/workspace/WorkItemStore';
import { createLiriConfigManager } from '@modules/workspace/LiriConfigManager';
import { resolveWorkspacePath } from './workspaces-handlers';
import type { OrchestrationSnapshot } from '@modules/agent/events/OrchestrationEvents';

const logger = new Logger({ level: LogLevel.INFO });

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
      sendSSE(res, 'heartbeat', {
        timestamp: new Date().toISOString(),
      });
    }, 15000);

    // 监听客户端断开
    req.on('close', () => {
      clearInterval(heartbeat);
      logger.debug('编排流式连接关闭', { workItemId: itemId });
    });

    req.on('error', () => {
      clearInterval(heartbeat);
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
        model: config.defaultModel || 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: 0.7,
      },
    ];

    const availableModels = config.availableModels || [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        provider: 'anthropic',
      },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    ];

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
