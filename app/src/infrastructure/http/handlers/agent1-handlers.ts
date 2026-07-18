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
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'infrastructure:http:handlers:agent1-handlers', level: LogLevel.INFO });

// ========== Agent1 Handlers ==========

export async function handleListAgentTasks(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { SqliteTaskStore } =
      await import('@modules/tasks/db/SqliteTaskStore');
    const store = new SqliteTaskStore();
    await store.init();
    const taskStates = await store.loadTaskStates();

    const tasks = taskStates.map((state) => ({
      id: state.id,
      name: state.description || state.id,
      status: state.status,
      priority: (state.metadata?.priority as string) || 'medium',
      progress:
        state.status === 'completed'
          ? 100
          : state.status === 'running'
            ? 50
            : 0,
      result:
        state.status === 'completed'
          ? state.outputFile || undefined
          : undefined,
      error: state.error,
      created_at: state.startTime,
      type: state.type,
      tokenUsed: state.tokenCount,
      description: state.description,
      metadata: state.metadata,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tasks));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {

        logger.debug("Operation skipped", { error: err instanceof Error ? err.message : String(err) });

      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理执行 Agent 任务请求
 */
export async function handleExecuteAgentTask(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const params = JSON.parse(body);
    const coreAPI = getCoreAPI();
    const result = await coreAPI.executeAgentTask({
      description: params.name || params.description || '',
      prompt: params.prompt,
      subagentType: params.type,
      model: params.model,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    ctx.broadcastEvent('agent:task', { taskId: result?.agentId });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {

        logger.debug("Operation skipped", { error: err instanceof Error ? err.message : String(err) });

      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取 Agent 进度请求
 */
export async function handleGetAgentProgress(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const progress = await coreAPI.getAgentProgress(agentId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        progress || { agentId, state: 'unknown', progress: 0, message: '' }
      )
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

        logger.debug("Operation skipped", { error: err instanceof Error ? err.message : String(err) });

      } /* res可能已结束, 忽略 */
    }
  }
}
