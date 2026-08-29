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

/**
 * task-handlers.ts — 长程任务中心 HTTP handlers
 *
 * 为 TaskRegistry 提供 REST API：
 * - GET  /v1/tasks                    → 列出所有任务
 * - POST /v1/tasks/:id/cancel         → 取消运行中任务
 * - DELETE /v1/tasks/:id              → 删除已完成任务
 */

import type http from 'http';
import { sendError } from './handler-utils';
import { taskRegistry } from '@modules/tasks';
import { handleError } from '@modules/error';

export async function handleListTasks(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const tasks = taskRegistry.getAllTasks();
    const taskInfos = tasks.map((t) => {
      const s = t.taskState;
      return {
        id: s.id,
        description: s.description,
        status: s.status,
        type: s.type,
        startTime: s.startTime,
        endTime: s.endTime,
        error: s.error,
        toolUseCount: s.toolUseCount,
        tokenCount: s.tokenCount,
        metadata: s.metadata,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tasks: taskInfos, count: taskInfos.length }));
  } catch (e) {
    await handleError(e, { module: 'infra:handler:task', action: 'list' });
    sendError(res, 'Failed to list tasks', 500);
  }
}

export async function handleCancelTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const task = taskRegistry.getTask(taskId);
    if (!task) {
      sendError(res, `Task not found: ${taskId}`, 404);
      return;
    }
    await taskRegistry.kill(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, taskId }));
  } catch (e) {
    await handleError(e, {
      module: 'infra:handler:task',
      action: 'cancel',
      context: { taskId },
    });
    sendError(res, 'Failed to cancel task', 500);
  }
}

export async function handleRemoveTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const task = taskRegistry.getTask(taskId);
    if (!task) {
      sendError(res, `Task not found: ${taskId}`, 404);
      return;
    }
    await taskRegistry.remove(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, taskId }));
  } catch (e) {
    await handleError(e, {
      module: 'infra:handler:task',
      action: 'remove',
      context: { taskId },
    });
    sendError(res, 'Failed to remove task', 500);
  }
}
