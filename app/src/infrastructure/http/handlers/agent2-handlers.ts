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

/**
 * 任务消息**可选能力探测**（duck typing，替代原 `as any`）。
 *
 * ⚠️ 实测（2026-10-06）：当前实现**均未提供**这些方法 ——
 * `sendTaskMessage` 全仓零定义、`Coordinator` 只有 `getTaskStatus()` 而无 `getTask()`
 * ⇒ 两条探测**当前恒失败**，`handleAgentTaskChat` 恒返回 `(Agent未响应)` 兜底。
 * 此处仅按结构类型如实表达"探测意图"，待目标方法补齐后自动生效。
 */
interface TaskMessageSender {
  sendTaskMessage?: (
    taskId: string,
    message: string
  ) => string | undefined | Promise<string | undefined>;
}

interface TaskLookup {
  getTask?: (taskId: string) => unknown;
}

interface MessageEndpoint {
  sendMessage: (message: string) => string | Promise<string>;
}

// ========== Agent2 Handlers ==========

export async function handleCancelAgentTask(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const { coordinator } = await import('@modules/core/Coordinator');
    const success = coordinator.stopTask(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success, taskId }));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleGetAgentTaskState(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const state = await taskOps.getTaskState(taskId);
    if (!state) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleGetAgentTaskAudit(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const logs = await taskOps.queryTaskAuditLogs(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleGetAgentTaskLogs(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const logs: string[] = [];

    // 从 SQLite 加载日志
    try {
      const taskOps = await getCoreAPI().getTaskOpsPort();
      const state = await taskOps.getTaskState(taskId);
      if (state) {
        logs.push(
          `Task: ${state.description || taskId} | Status: ${state.status} | Type: ${state.type}`
        );
        if (state.outputFile) {
          const fs = await import('fs');
          if (fs.existsSync(state.outputFile)) {
            const content = fs.readFileSync(state.outputFile, 'utf-8');
            logs.push(...content.split('\n').filter(Boolean).slice(-100));
          }
        }
        if (state.error) {
          logs.push(`Error: ${state.error}`);
        }
      } else {
        logs.push(`Task ${taskId} not found in store`);
      }
    } catch (e) {
      logs.push(`Failed to load task state: ${String(e)}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleGetAgentTaskOutput(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const fs = await import('fs');
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const state = await taskOps.getTaskState(taskId);

    let output = '';
    if (state?.outputFile && fs.existsSync(state.outputFile)) {
      output = fs.readFileSync(state.outputFile, 'utf-8');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(output));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleRecoverAgentTask(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const recovered = await taskOps.recoverLostTask(taskId);
    if (!recovered) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found or not in LOST state' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, taskId }));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleAgentTaskChat(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { message } = JSON.parse(body);
    let reply = '';
    try {
      const coreAPI = getCoreAPI();
      const sender = coreAPI as unknown as TaskMessageSender;
      reply = (await sender.sendTaskMessage?.(taskId, message)) || '';
    } catch {
      // 降级：通过 executor 直接执行
      const { coordinator } = await import('@modules/core/Coordinator');
      const task = (coordinator as unknown as TaskLookup).getTask?.(taskId);
      if (task && typeof (task as MessageEndpoint).sendMessage === 'function') {
        reply = await (task as MessageEndpoint).sendMessage(message);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply || '(Agent未响应)'));
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
          module: 'infrastructure:http:handlers:agent2-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}
